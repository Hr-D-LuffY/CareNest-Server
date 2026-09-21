import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import {
  BookingStatus,
  TransportStatus,
  WalletTransactionType,
} from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { ACTIVE_BOOKING_STATUSES, assertNotDoubleBooked, lockRow } from '../../lib/booking-guards'
import { calculateFare, estimateCareFee, hoursElapsed } from '../../lib/fare.service'
import { prisma } from '../../lib/prisma'
import { debitWallet } from '../../lib/wallet.service'
import { toIsoDate } from '../../utils/date'
import type { TokenPayload } from '../../utils/jwt'
import { CHILD_NOT_FOUND_MESSAGE, getGuardianId } from '../child/child.service'
import {
  attachSeatsLeft,
  ROOM_NOT_FOUND_MESSAGE,
  todayUtc,
  toSessionDate,
  WEEKDAYS,
} from '../room/room.service'
import { getMySitterId } from '../staff/staff.service'
import { joinWaitlist, promoteFromWaitlist } from '../waitlist/waitlist.service'
import type { CreateBookingPayload } from './booking.interface'

type Caller = Pick<TokenPayload, 'userId'>

const AUDIT_BOOKING_ENTITY = 'Booking'
const AUDIT_BOOKING_CREATED = 'BOOKING_CREATED'
const AUDIT_BOOKING_CANCELLED = 'BOOKING_CANCELLED'
const AUDIT_BOOKING_CHECKED_IN = 'BOOKING_CHECKED_IN'
const AUDIT_BOOKING_CHECKED_OUT = 'BOOKING_CHECKED_OUT'
const BOOKING_NOT_FOUND_MESSAGE = 'Booking not found'
const CARE_FEE_DESCRIPTION = 'Care fee for'

const bookingSelect = {
  id: true,
  sessionDate: true,
  status: true,
  estimatedFee: true,
  finalFee: true,
  insufficientBalance: true,
  createdAt: true,
  child: { select: { id: true, name: true } },
  room: { select: { id: true, name: true, dayOfWeek: true, startTime: true, endTime: true } },
} as const

type BookingRecord = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>

const toBookingView = (booking: BookingRecord) => ({
  ...booking,
  sessionDate: toIsoDate(booking.sessionDate),
})

const roomForBookingSelect = {
  id: true,
  capacity: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  priceMultiplier: true,
  staff: { select: { hourlyRate: true } },
} as const

const createBooking = async (caller: Caller, payload: CreateBookingPayload) => {
  const { childId, roomId } = payload
  const guardianId = await getGuardianId(caller)

  // Someone else's child gets the same 404 as a missing one, so ids can't be probed.
  const child = await prisma.child.findFirst({
    where: { id: childId, guardianId, isDeleted: false },
    select: { id: true, tier: true },
  })
  if (!child) throw new AppError(httpStatus.NOT_FOUND, CHILD_NOT_FOUND_MESSAGE)

  const room = await prisma.room.findFirst({
    where: { id: roomId, isDeleted: false },
    select: roomForBookingSelect,
  })
  if (!room) throw new AppError(httpStatus.NOT_FOUND, ROOM_NOT_FOUND_MESSAGE)

  const sessionDate = toSessionDate(payload.sessionDate)
  if (WEEKDAYS[sessionDate.getUTCDay()] !== room.dayOfWeek) {
    throw new AppError(httpStatus.BAD_REQUEST, `This room runs on ${room.dayOfWeek}s`)
  }

  const estimatedFee = estimateCareFee(room)
  if (!estimatedFee) {
    throw new AppError(httpStatus.CONFLICT, 'This room has no hourly rate set yet, try again later')
  }

  // A full room queues the child instead of failing (SRS 4.6), so exactly one of `booking` and
  // `waitlistEntry` comes back.
  return prisma.$transaction(async (tx) => {
    await lockRow(tx, 'children', childId)
    await lockRow(tx, 'rooms', roomId)

    await assertNotDoubleBooked(tx, childId, sessionDate, room)

    const { walletBalance } = await tx.guardianProfile.findUniqueOrThrow({
      where: { id: guardianId },
      select: { walletBalance: true },
    })
    if (walletBalance.lt(estimatedFee)) {
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        `Insufficient wallet balance. The estimated fee is ${estimatedFee}, your balance is ${walletBalance}`,
      )
    }

    const [seated] = await attachSeatsLeft([room], sessionDate, tx)
    if (!seated || seated.seatsLeft === 0) {
      const waitlistEntry = await joinWaitlist(tx, {
        roomId,
        childId,
        guardianId,
        sessionDate,
        tier: child.tier,
      })
      return { booking: null, waitlistEntry }
    }

    const created = await tx.booking.create({
      data: {
        childId,
        roomId,
        guardianId,
        sessionDate,
        status: BookingStatus.CONFIRMED,
        estimatedFee,
      },
      select: bookingSelect,
    })
    await tx.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_BOOKING_CREATED,
        entity: AUDIT_BOOKING_ENTITY,
        entityId: created.id,
        metadata: { status: created.status, roomId, childId },
      },
    })
    return { booking: toBookingView(created), waitlistEntry: null }
  })
}

// Cancelling releases the seat (seatsLeft only counts CONFIRMED bookings), stamps `cancelledAt`,
// which feeds the waitlist cancellation penalty, and then hands the freed seat to the top-ranked
// waitlist entry, all in one transaction (SRS 4.7). The status flip is a conditional update, so a
// double-click or a concurrent check-in can't cancel the same booking twice.
const cancelBooking = async (caller: Caller, bookingId: string) => {
  const guardianId = await getGuardianId(caller)

  // Someone else's booking gets the same 404 as a missing one, so ids can't be probed.
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, guardianId },
    select: { id: true, status: true, sessionDate: true, roomId: true, checkinLog: true },
  })
  if (!booking) throw new AppError(httpStatus.NOT_FOUND, BOOKING_NOT_FOUND_MESSAGE)

  if (!ACTIVE_BOOKING_STATUSES.some((status) => status === booking.status)) {
    throw new AppError(httpStatus.CONFLICT, `A ${booking.status} booking cannot be cancelled`)
  }
  if (booking.checkinLog || booking.sessionDate < todayUtc()) {
    throw new AppError(
      httpStatus.CONFLICT,
      'This session has already started or passed and cannot be cancelled',
    )
  }

  const cancelled = await prisma.$transaction(async (tx) => {
    await lockRow(tx, 'rooms', booking.roomId)
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, status: { in: ACTIVE_BOOKING_STATUSES }, checkinLog: null },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    })
    if (count === 0) {
      throw new AppError(httpStatus.CONFLICT, 'This booking can no longer be cancelled')
    }

    // A ride only exists to serve its booking.
    await tx.transportBooking.updateMany({
      where: { bookingId, status: TransportStatus.REQUESTED },
      data: { status: TransportStatus.CANCELLED },
    })
    await tx.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_BOOKING_CANCELLED,
        entity: AUDIT_BOOKING_ENTITY,
        entityId: bookingId,
        metadata: { from: booking.status, to: BookingStatus.CANCELLED, roomId: booking.roomId },
      },
    })

    await promoteFromWaitlist(tx, { roomId: booking.roomId, sessionDate: booking.sessionDate })

    return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: bookingSelect })
  })
  return toBookingView(cancelled)
}

const checkinLogSelect = {
  id: true,
  checkInAt: true,
  checkOutAt: true,
  hoursUsed: true,
  booking: { select: bookingSelect },
} as const

type CheckinLogRecord = Prisma.CheckinLogGetPayload<{ select: typeof checkinLogSelect }>

const toCheckinLogView = ({ booking, ...log }: CheckinLogRecord) => ({
  ...log,
  booking: toBookingView(booking),
})

// Only the sitter running the booking's room may log it. Someone else's booking gets the same 404
// as a missing one, so ids can't be probed.
const findBookingInMyRoom = async (staffId: string, bookingId: string) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, room: { staffId, isDeleted: false } },
    select: {
      id: true,
      status: true,
      sessionDate: true,
      roomId: true,
      guardianId: true,
      room: {
        select: { name: true, priceMultiplier: true, staff: { select: { hourlyRate: true } } },
      },
      checkinLog: { select: { checkInAt: true, checkOutAt: true } },
    },
  })
  if (!booking) throw new AppError(httpStatus.NOT_FOUND, BOOKING_NOT_FOUND_MESSAGE)
  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new AppError(httpStatus.CONFLICT, `A ${booking.status} booking cannot be logged`)
  }
  return booking
}

// Staff logs the actual arrival (SRS 4.8). Only on the session day, once per booking. The room lock
// is the same one cancelBooking takes, so a cancellation and a check-in can't both succeed.
const checkIn = async (caller: Caller, bookingId: string) => {
  const staffId = await getMySitterId(caller)
  const booking = await findBookingInMyRoom(staffId, bookingId)

  if (booking.checkinLog) {
    throw new AppError(httpStatus.CONFLICT, 'The child is already checked in for this booking')
  }
  if (booking.sessionDate.getTime() !== todayUtc().getTime()) {
    throw new AppError(httpStatus.CONFLICT, 'Check-in is only possible on the session date')
  }

  const log = await prisma.$transaction(async (tx) => {
    await lockRow(tx, 'rooms', booking.roomId)
    const stillOpen = await tx.booking.findFirst({
      where: { id: bookingId, status: BookingStatus.CONFIRMED, checkinLog: null },
      select: { id: true },
    })
    if (!stillOpen) {
      throw new AppError(httpStatus.CONFLICT, 'This booking can no longer be checked in')
    }

    const created = await tx.checkinLog.create({
      data: { bookingId, staffId, checkInAt: new Date() },
      select: checkinLogSelect,
    })
    await tx.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_BOOKING_CHECKED_IN,
        entity: AUDIT_BOOKING_ENTITY,
        entityId: bookingId,
        metadata: { roomId: booking.roomId },
      },
    })
    return created
  })
  return toCheckinLogView(log)
}

// Staff logs the actual departure (SRS 4.8): stamps `checkOutAt`, stores `hoursUsed`, prices the
// stay (hoursUsed x hourlyRate x priceMultiplier) and debits the guardian's wallet, completing the
// booking. If the wallet can't cover it, nothing is debited and the booking is flagged
// `insufficientBalance` instead, so staff can still release the child. The conditional update on
// `checkOutAt: null` stops a double-click logging (and charging) it twice.
const checkOut = async (caller: Caller, bookingId: string) => {
  const staffId = await getMySitterId(caller)
  const { checkinLog, roomId, guardianId, room } = await findBookingInMyRoom(staffId, bookingId)

  if (!checkinLog) {
    throw new AppError(httpStatus.CONFLICT, 'The child has not been checked in yet')
  }
  if (checkinLog.checkOutAt) {
    throw new AppError(httpStatus.CONFLICT, 'The child is already checked out for this booking')
  }

  if (room.staff.hourlyRate === null) {
    throw new AppError(
      httpStatus.CONFLICT,
      'This room has no hourly rate set, so it cannot be priced',
    )
  }

  const checkOutAt = new Date()
  const hoursUsed = hoursElapsed(checkinLog.checkInAt, checkOutAt)
  const finalFee = calculateFare({
    units: hoursUsed,
    rate: room.staff.hourlyRate,
    multiplier: room.priceMultiplier,
  })

  const log = await prisma.$transaction(async (tx) => {
    const { count } = await tx.checkinLog.updateMany({
      where: { bookingId, checkOutAt: null },
      data: { checkOutAt, hoursUsed },
    })
    if (count === 0) {
      throw new AppError(httpStatus.CONFLICT, 'This booking can no longer be checked out')
    }

    const charged = await debitWallet(tx, {
      guardianId,
      type: WalletTransactionType.CARE_FEE,
      amount: finalFee,
      description: `${CARE_FEE_DESCRIPTION} ${room.name}`,
      bookingId,
    })
    await tx.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.COMPLETED, finalFee, insufficientBalance: !charged },
    })
    await tx.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_BOOKING_CHECKED_OUT,
        entity: AUDIT_BOOKING_ENTITY,
        entityId: bookingId,
        metadata: {
          roomId,
          hoursUsed: hoursUsed.toString(),
          finalFee: finalFee.toString(),
          charged,
        },
      },
    })
    return tx.checkinLog.findUniqueOrThrow({ where: { bookingId }, select: checkinLogSelect })
  })
  return toCheckinLogView(log)
}

export const BookingService = { createBooking, cancelBooking, checkIn, checkOut }
