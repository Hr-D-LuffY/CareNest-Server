import httpStatus from 'http-status'
import { Prisma } from '../../../generated/prisma/client'
import { BookingStatus, TransportStatus } from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import { buildMeta, getPagination } from '../../utils/pagination'
import { getGuardianId } from '../child/child.service'
import { STAFF_NOT_FOUND_MESSAGE } from '../staff/staff.service'
import type { CreateRatingPayload, ListStaffRatingsQuery } from './rating.interface'

type Caller = Pick<TokenPayload, 'userId'>

const PRISMA_UNIQUE_VIOLATION = 'P2002'
const AUDIT_RATING_ENTITY = 'Rating'
const AUDIT_RATING_CREATED = 'RATING_CREATED'
const BOOKING_NOT_FOUND_MESSAGE = 'Booking not found'
const NOT_RATABLE_MESSAGE =
  'This staff member has no completed session or trip on this booking to rate'
const ALREADY_RATED_MESSAGE = 'You have already rated this staff member for this booking'

const ratingSelect = {
  id: true,
  bookingId: true,
  staffId: true,
  score: true,
  comment: true,
  createdAt: true,
  guardian: { select: { id: true, user: { select: { name: true } } } },
} as const

// Only the sitter who ran the room (booking COMPLETED) or the driver who ran the ride
// (transportBooking COMPLETED) on THIS booking can be rated — never an unrelated staff id.
// Someone else's booking gets the same 404 as a missing one, so ids can't be probed.
const assertRatable = async (guardianId: string, bookingId: string, staffId: string) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, guardianId },
    select: {
      status: true,
      room: { select: { staffId: true } },
      transportBooking: { select: { driverId: true, status: true } },
    },
  })
  if (!booking) throw new AppError(httpStatus.NOT_FOUND, BOOKING_NOT_FOUND_MESSAGE)

  const sitterRatable =
    booking.status === BookingStatus.COMPLETED && booking.room.staffId === staffId
  const driverRatable =
    booking.transportBooking?.status === TransportStatus.COMPLETED &&
    booking.transportBooking.driverId === staffId

  if (!sitterRatable && !driverRatable) {
    throw new AppError(httpStatus.CONFLICT, NOT_RATABLE_MESSAGE)
  }
}

const createRating = async (caller: Caller, payload: CreateRatingPayload) => {
  const guardianId = await getGuardianId(caller)
  const { bookingId, staffId, score, comment } = payload
  await assertRatable(guardianId, bookingId, staffId)

  try {
    return await prisma.$transaction(async (tx) => {
      const rating = await tx.rating.create({
        data: { bookingId, staffId, guardianId, score, comment },
        select: ratingSelect,
      })
      await tx.auditLog.create({
        data: {
          userId: caller.userId,
          action: AUDIT_RATING_CREATED,
          entity: AUDIT_RATING_ENTITY,
          entityId: rating.id,
          metadata: { bookingId, staffId, score },
        },
      })
      return rating
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === PRISMA_UNIQUE_VIOLATION
    ) {
      throw new AppError(httpStatus.CONFLICT, ALREADY_RATED_MESSAGE)
    }
    throw error
  }
}

const getStaffRatings = async (staffId: string, query: ListStaffRatingsQuery) => {
  const staff = await prisma.staffProfile.findFirst({
    where: { id: staffId, isDeleted: false },
    select: { id: true },
  })
  if (!staff) throw new AppError(httpStatus.NOT_FOUND, STAFF_NOT_FOUND_MESSAGE)

  const [aggregate, reviews, total] = await Promise.all([
    prisma.rating.aggregate({ where: { staffId }, _avg: { score: true }, _count: true }),
    prisma.rating.findMany({
      where: { staffId },
      select: ratingSelect,
      orderBy: { createdAt: 'desc' },
      ...getPagination(query),
    }),
    prisma.rating.count({ where: { staffId } }),
  ])

  return {
    average: aggregate._avg.score ?? 0,
    count: aggregate._count,
    reviews,
    meta: buildMeta(query, total),
  }
}

export const RatingService = { createRating, getStaffRatings }
