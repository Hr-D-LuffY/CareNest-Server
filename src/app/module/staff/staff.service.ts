import httpStatus from 'http-status'
import { Prisma } from '../../../generated/prisma/client'
import { BookingStatus, StaffType, TransportStatus } from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import { buildMeta, getPagination } from '../../utils/pagination'
import {
  type CreateSlotPayload,
  type EarningsQuery,
  isEndAfterStart,
  type ListMyBookingsQuery,
  type ListMyTripsQuery,
  type UpdateMyStaffPayload,
  type UpdateSlotPayload,
} from './staff.interface'

type Caller = Pick<TokenPayload, 'userId'>

export const STAFF_NOT_FOUND_MESSAGE = 'Staff profile not found'

// One shape for every staff response, shared with the admin module.
export const staffSelect = {
  id: true,
  staffType: true,
  bio: true,
  experience: true,
  hourlyRate: true,
  perMinuteRate: true,
  verificationStatus: true,
  verifiedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true, profilePhoto: true } },
} as const

const getMyProfile = async ({ userId }: Caller) => {
  const staff = await prisma.staffProfile.findFirst({
    where: { userId, isDeleted: false },
    select: staffSelect,
  })
  if (!staff) throw new AppError(httpStatus.NOT_FOUND, STAFF_NOT_FOUND_MESSAGE)
  return staff
}

// Name lives on User, the rest on StaffProfile: one nested update keeps them atomic.
const updateMyProfile = async (caller: Caller, { name, bio, experience }: UpdateMyStaffPayload) => {
  await getMyProfile(caller)

  return prisma.staffProfile.update({
    where: { userId: caller.userId },
    data: { bio, experience, user: { update: { name } } },
    select: staffSelect,
  })
}

const SLOT_NOT_FOUND_MESSAGE = 'Availability slot not found'

const slotSelect = {
  id: true,
  staffId: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  createdAt: true,
  updatedAt: true,
} as const

// Someone else's slot id gets the same 404 as a missing one, so ids can't be probed.
const findOwnedSlot = async (staffId: string, slotId: string) => {
  const slot = await prisma.availabilitySlot.findFirst({
    where: { id: slotId, staffId },
    select: slotSelect,
  })
  if (!slot) throw new AppError(httpStatus.NOT_FOUND, SLOT_NOT_FOUND_MESSAGE)
  return slot
}

// Slots on one day must not overlap, or "is this staff free at X" would have two answers.
// `excludeSlotId` lets an update ignore the slot being edited.
const assertNoOverlap = async (
  staffId: string,
  { dayOfWeek, startTime, endTime }: CreateSlotPayload,
  excludeSlotId?: string,
) => {
  const overlapping = await prisma.availabilitySlot.findFirst({
    where: {
      staffId,
      dayOfWeek,
      startTime: { lt: endTime },
      endTime: { gt: startTime },
      ...(excludeSlotId && { id: { not: excludeSlotId } }),
    },
    select: { startTime: true, endTime: true },
  })
  if (overlapping) {
    throw new AppError(
      httpStatus.CONFLICT,
      `This overlaps your existing ${dayOfWeek} slot ${overlapping.startTime}-${overlapping.endTime}`,
    )
  }
}

const createMySlot = async (caller: Caller, payload: CreateSlotPayload) => {
  const { id: staffId } = await getMyProfile(caller)
  const { dayOfWeek, startTime, endTime } = payload
  await assertNoOverlap(staffId, payload)

  return prisma.availabilitySlot.create({
    data: { staffId, dayOfWeek, startTime, endTime },
    select: slotSelect,
  })
}

// Read by guardians/admins too (any logged-in user), so it takes the staff profile id, not the caller.
const listStaffSlots = async (staffId: string) => {
  const staff = await prisma.staffProfile.findFirst({
    where: { id: staffId, isDeleted: false },
    select: { id: true },
  })
  if (!staff) throw new AppError(httpStatus.NOT_FOUND, STAFF_NOT_FOUND_MESSAGE)

  return prisma.availabilitySlot.findMany({
    where: { staffId },
    select: slotSelect,
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  })
}

const updateMySlot = async (caller: Caller, slotId: string, payload: UpdateSlotPayload) => {
  const { id: staffId } = await getMyProfile(caller)
  const current = await findOwnedSlot(staffId, slotId)

  const { dayOfWeek, startTime, endTime } = payload
  const merged = {
    dayOfWeek: dayOfWeek ?? current.dayOfWeek,
    startTime: startTime ?? current.startTime,
    endTime: endTime ?? current.endTime,
  }
  if (!isEndAfterStart(merged)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'End time must be after start time')
  }
  await assertNoOverlap(staffId, merged, slotId)

  return prisma.availabilitySlot.update({
    where: { id: slotId },
    data: { dayOfWeek, startTime, endTime },
    select: slotSelect,
  })
}

// Hard delete: a slot is plain schedule data, nothing else references it.
const deleteMySlot = async (caller: Caller, slotId: string) => {
  const { id: staffId } = await getMyProfile(caller)
  await findOwnedSlot(staffId, slotId)

  await prisma.availabilitySlot.delete({ where: { id: slotId } })
}

const SITTER_TYPES: StaffType[] = [StaffType.SITTER, StaffType.BOTH]
const DRIVER_TYPES: StaffType[] = [StaffType.DRIVER, StaffType.BOTH]

// Care rooms are run by sitters and rides by drivers, so a staff type outside the allowed set
// gets a clear 403 instead of a confusingly empty list.
const getMyProfileOfType = async (caller: Caller, allowed: StaffType[], duty: string) => {
  const staff = await getMyProfile(caller)
  if (!allowed.includes(staff.staffType)) {
    throw new AppError(httpStatus.FORBIDDEN, `Only ${duty} staff can access this resource`)
  }
  return staff
}

// The caller's staff profile id, for modules that act on the rooms a sitter runs (check-in/out).
export const getMySitterId = async (caller: Caller) =>
  (await getMyProfileOfType(caller, SITTER_TYPES, 'sitter')).id

// The caller's staff profile id, for modules that act on the rides a driver runs (vehicles).
export const getMyDriverId = async (caller: Caller) =>
  (await getMyProfileOfType(caller, DRIVER_TYPES, 'driver')).id

const bookingSelect = {
  id: true,
  sessionDate: true,
  status: true,
  child: {
    select: {
      id: true,
      name: true,
      tier: true,
      allergies: true,
      conditions: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
    },
  },
  room: { select: { id: true, name: true, dayOfWeek: true, startTime: true, endTime: true } },
  checkinLog: { select: { checkInAt: true, checkOutAt: true } },
} as const

// Confirmed bookings in this staff member's rooms that still need a check-in or a check-out.
const listMyBookings = async (caller: Caller, query: ListMyBookingsQuery) => {
  const staffId = await getMySitterId(caller)
  const where: Prisma.BookingWhereInput = {
    room: { staffId, isDeleted: false },
    status: BookingStatus.CONFIRMED,
    OR: [{ checkinLog: null }, { checkinLog: { checkOutAt: null } }],
    ...(query.date && { sessionDate: query.date }),
  }

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      select: bookingSelect,
      orderBy: [{ sessionDate: 'asc' }, { createdAt: 'asc' }],
      ...getPagination(query),
    }),
    prisma.booking.count({ where }),
  ])

  return { items, meta: buildMeta(query, total) }
}

const tripSelect = {
  id: true,
  status: true,
  pickupAddress: true,
  dropoffAddress: true,
  baseFare: true,
  booking: {
    select: { id: true, sessionDate: true, child: { select: { id: true, name: true } } },
  },
  vehicle: { select: { id: true, plateNumber: true, vehicleType: true } },
  tripLog: { select: { tripStart: true, tripEnd: true, durationMinutes: true, fare: true } },
} as const

const listMyTrips = async (caller: Caller, query: ListMyTripsQuery) => {
  const { id: driverId } = await getMyProfileOfType(caller, DRIVER_TYPES, 'driver')
  const where: Prisma.TransportBookingWhereInput = {
    driverId,
    ...(query.status && { status: query.status }),
  }

  const [items, total] = await Promise.all([
    prisma.transportBooking.findMany({
      where,
      select: tripSelect,
      orderBy: { createdAt: 'desc' },
      ...getPagination(query),
    }),
    prisma.transportBooking.count({ where }),
  ])

  return { items, meta: buildMeta(query, total) }
}

// Earnings are counted when the work finished (check-out / trip end), inside the optional
// from–to window. A care fee the wallet couldn't cover was never collected, so it is left out.
const getMyEarnings = async (caller: Caller, { from, to }: EarningsQuery) => {
  const { id: staffId, staffType } = await getMyProfile(caller)
  const finishedBetween = { ...(from && { gte: from }), ...(to && { lte: to }) }
  const hasWindow = from !== undefined || to !== undefined
  const zero = new Prisma.Decimal(0)

  const [care, trips] = await Promise.all([
    SITTER_TYPES.includes(staffType)
      ? prisma.booking.aggregate({
          where: {
            room: { staffId },
            status: BookingStatus.COMPLETED,
            insufficientBalance: false,
            ...(hasWindow && { checkinLog: { checkOutAt: finishedBetween } }),
          },
          _sum: { finalFee: true },
          _count: true,
        })
      : null,
    DRIVER_TYPES.includes(staffType)
      ? prisma.tripLog.aggregate({
          where: {
            transportBooking: { driverId: staffId, status: TransportStatus.COMPLETED },
            ...(hasWindow && { tripEnd: finishedBetween }),
          },
          _sum: { fare: true },
          _count: true,
        })
      : null,
  ])

  const careTotal = care?._sum.finalFee ?? zero
  const tripTotal = trips?._sum.fare ?? zero

  return {
    from: from ?? null,
    to: to ?? null,
    careFees: { total: careTotal, count: care?._count ?? 0 },
    tripFares: { total: tripTotal, count: trips?._count ?? 0 },
    total: careTotal.plus(tripTotal),
  }
}

export const StaffService = {
  getMyProfile,
  updateMyProfile,
  listMyBookings,
  listMyTrips,
  getMyEarnings,
  createMySlot,
  listStaffSlots,
  updateMySlot,
  deleteMySlot,
}
