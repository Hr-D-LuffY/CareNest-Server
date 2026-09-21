import httpStatus from 'http-status'
import type { Prisma } from '../../generated/prisma/client'
import { BookingStatus } from '../../generated/prisma/enums'
import { AppError } from '../errorHelpers/AppError'

type TimeWindow = { startTime: string; endTime: string }

export const ACTIVE_BOOKING_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED]

// Locks the row until the transaction ends, so two concurrent requests queue up behind each other
// instead of both passing the same check.
export const lockRow = (
  tx: Prisma.TransactionClient,
  table: 'rooms' | 'children' | 'guardian_profiles',
  id: string,
) => tx.$queryRawUnsafe(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, id)

// The active booking that overlaps this time window for the child on that date, if any (SRS 4.6).
export const findOverlappingBooking = (
  tx: Prisma.TransactionClient,
  childId: string,
  sessionDate: Date,
  { startTime, endTime }: TimeWindow,
) =>
  tx.booking.findFirst({
    where: {
      childId,
      sessionDate,
      status: { in: ACTIVE_BOOKING_STATUSES },
      room: { startTime: { lt: endTime }, endTime: { gt: startTime } },
    },
    select: { room: { select: { name: true, startTime: true, endTime: true } } },
  })

// A child can't hold two seats whose time windows overlap on the same date (SRS 4.6).
export const assertNotDoubleBooked = async (
  tx: Prisma.TransactionClient,
  childId: string,
  sessionDate: Date,
  window: TimeWindow,
) => {
  const clash = await findOverlappingBooking(tx, childId, sessionDate, window)
  if (clash) {
    throw new AppError(
      httpStatus.CONFLICT,
      `The child already has a booking in "${clash.room.name}" (${clash.room.startTime}-${clash.room.endTime}) at that time`,
    )
  }
}
