import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import { BookingStatus, TransportStatus } from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { ACTIVE_BOOKING_STATUSES, assertNotDoubleBooked, lockRow } from '../../lib/booking-guards'
import { estimateCareFee } from '../../lib/fare.service'
import { prisma } from '../../lib/prisma'
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
import { joinWaitlist, promoteFromWaitlist } from '../waitlist/waitlist.service'
import type { CreateBookingPayload } from './booking.interface'

type Caller = Pick<TokenPayload, 'userId'>

const AUDIT_BOOKING_ENTITY = 'Booking'
const AUDIT_BOOKING_CREATED = 'BOOKING_CREATED'
const AUDIT_BOOKING_CANCELLED = 'BOOKING_CANCELLED'
const BOOKING_NOT_FOUND_MESSAGE = 'Booking not found'

const bookingSelect = {
  id: true,
  sessionDate: true,
  status: true,
  estimatedFee: true,
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

export const BookingService = { createBooking, cancelBooking }
