import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import { BookingStatus } from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { calculateFare, hoursBetween } from '../../lib/fare.service'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import { CHILD_NOT_FOUND_MESSAGE, getGuardianId } from '../child/child.service'
import {
  attachSeatsLeft,
  ROOM_NOT_FOUND_MESSAGE,
  toSessionDate,
  WEEKDAYS,
} from '../room/room.service'
import type { CreateBookingPayload } from './booking.interface'

type Caller = Pick<TokenPayload, 'userId'>
type TimeWindow = { startTime: string; endTime: string }

const ACTIVE_BOOKING_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED]
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length

const AUDIT_BOOKING_ENTITY = 'Booking'
const AUDIT_BOOKING_CREATED = 'BOOKING_CREATED'

const bookingSelect = {
  id: true,
  sessionDate: true,
  status: true,
  estimatedFee: true,
  createdAt: true,
  child: { select: { id: true, name: true } },
  room: { select: { id: true, name: true, dayOfWeek: true, startTime: true, endTime: true } },
} as const

const roomForBookingSelect = {
  id: true,
  capacity: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  priceMultiplier: true,
  staff: { select: { hourlyRate: true } },
} as const

// Locks the row until the transaction ends, so two concurrent requests queue up behind each other
// instead of both passing the same check.
const lockRow = (tx: Prisma.TransactionClient, table: 'rooms' | 'children', id: string) =>
  tx.$queryRawUnsafe(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, id)

// A child can't hold two seats whose time windows overlap on the same date (SRS 4.6).
const assertNotDoubleBooked = async (
  tx: Prisma.TransactionClient,
  childId: string,
  sessionDate: Date,
  { startTime, endTime }: TimeWindow,
) => {
  const clash = await tx.booking.findFirst({
    where: {
      childId,
      sessionDate,
      status: { in: ACTIVE_BOOKING_STATUSES },
      room: { startTime: { lt: endTime }, endTime: { gt: startTime } },
    },
    select: { room: { select: { name: true, startTime: true, endTime: true } } },
  })
  if (clash) {
    throw new AppError(
      httpStatus.CONFLICT,
      `The child already has a booking in "${clash.room.name}" (${clash.room.startTime}-${clash.room.endTime}) at that time`,
    )
  }
}

const createBooking = async (caller: Caller, payload: CreateBookingPayload) => {
  const { childId, roomId } = payload
  const guardianId = await getGuardianId(caller)

  // Someone else's child gets the same 404 as a missing one, so ids can't be probed.
  const child = await prisma.child.findFirst({
    where: { id: childId, guardianId, isDeleted: false },
    select: { id: true },
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

  const { hourlyRate } = room.staff
  if (hourlyRate === null) {
    throw new AppError(httpStatus.CONFLICT, 'This room has no hourly rate set yet, try again later')
  }
  const estimatedFee = calculateFare({
    units: hoursBetween(room.startTime, room.endTime),
    rate: hourlyRate,
    multiplier: room.priceMultiplier,
  })

  const booking = await prisma.$transaction(async (tx) => {
    await lockRow(tx, 'children', childId)
    await lockRow(tx, 'rooms', roomId)

    await assertNotDoubleBooked(tx, childId, sessionDate, room)

    const [seated] = await attachSeatsLeft([room], sessionDate, tx)
    if (!seated || seated.seatsLeft === 0) {
      throw new AppError(httpStatus.CONFLICT, 'This room is full on that date')
    }

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
    return created
  })

  return { ...booking, sessionDate: booking.sessionDate.toISOString().slice(0, ISO_DATE_LENGTH) }
}

export const BookingService = { createBooking }
