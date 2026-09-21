import httpStatus from 'http-status'
import {
  BookingStatus,
  type DayOfWeek,
  StaffType,
  VerificationStatus,
  WaitlistStatus,
} from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import { END_AFTER_START_MESSAGE, isEndAfterStart } from '../staff/staff.interface'
import { STAFF_NOT_FOUND_MESSAGE } from '../staff/staff.service'
import type { CreateRoomPayload, UpdateRoomPayload } from './room.interface'

type Caller = Pick<TokenPayload, 'userId'>
type Schedule = { dayOfWeek: DayOfWeek; startTime: string; endTime: string }

const ROOM_NOT_FOUND_MESSAGE = 'Room not found'
const ACTIVE_BOOKING_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED]

const AUDIT_ROOM_ENTITY = 'Room'
const AUDIT_ROOM_DELETED = 'ROOM_DELETED'

const roomSelect = {
  id: true,
  name: true,
  tier: true,
  capacity: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  priceMultiplier: true,
  createdAt: true,
  updatedAt: true,
  staff: { select: { id: true, staffType: true, user: { select: { name: true } } } },
} as const

// Session dates are calendar dates (@db.Date), so "today" is the UTC midnight of today.
const todayUtc = () => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

const findRoomOrThrow = async (roomId: string) => {
  const room = await prisma.room.findFirst({
    where: { id: roomId, isDeleted: false },
    select: roomSelect,
  })
  if (!room) throw new AppError(httpStatus.NOT_FOUND, ROOM_NOT_FOUND_MESSAGE)
  return room
}

// Only a verified sitter (SITTER or BOTH) may run a care room (SRS 4.1).
const assertStaffCanRun = async (staffId: string) => {
  const staff = await prisma.staffProfile.findFirst({
    where: { id: staffId, isDeleted: false },
    select: { staffType: true, verificationStatus: true },
  })
  if (!staff) throw new AppError(httpStatus.NOT_FOUND, STAFF_NOT_FOUND_MESSAGE)
  if (staff.staffType === StaffType.DRIVER) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Drivers cannot run care rooms. Assign a sitter')
  }
  if (staff.verificationStatus !== VerificationStatus.VERIFIED) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Only verified staff can be assigned to a room')
  }
}

// The room's window must sit inside the staff member's weekly availability (SRS 4.4). Adjacent
// slots (09:00-12:00 + 12:00-14:00) count as one continuous stretch.
const assertWithinAvailability = async (
  staffId: string,
  { dayOfWeek, startTime, endTime }: Schedule,
) => {
  const slots = await prisma.availabilitySlot.findMany({
    where: { staffId, dayOfWeek },
    select: { startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  })

  let coveredUntil = startTime
  for (const slot of slots) {
    if (slot.startTime <= coveredUntil && slot.endTime > coveredUntil) coveredUntil = slot.endTime
  }
  if (coveredUntil < endTime) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `The staff member is not available on ${dayOfWeek} from ${startTime} to ${endTime}`,
    )
  }
}

// One person can't run two rooms at the same time. `excludeRoomId` lets an update ignore itself.
const assertStaffFree = async (
  staffId: string,
  { dayOfWeek, startTime, endTime }: Schedule,
  excludeRoomId?: string,
) => {
  const clash = await prisma.room.findFirst({
    where: {
      staffId,
      isDeleted: false,
      dayOfWeek,
      startTime: { lt: endTime },
      endTime: { gt: startTime },
      ...(excludeRoomId && { id: { not: excludeRoomId } }),
    },
    select: { name: true, startTime: true, endTime: true },
  })
  if (clash) {
    throw new AppError(
      httpStatus.CONFLICT,
      `The staff member already runs "${clash.name}" on ${dayOfWeek} ${clash.startTime}-${clash.endTime}`,
    )
  }
}

const assertRoomAssignable = async (
  staffId: string,
  schedule: Schedule,
  excludeRoomId?: string,
) => {
  await assertStaffCanRun(staffId)
  await assertWithinAvailability(staffId, schedule)
  await assertStaffFree(staffId, schedule, excludeRoomId)
}

const countUpcomingActiveBookings = (roomId: string) =>
  prisma.booking.count({
    where: { roomId, status: { in: ACTIVE_BOOKING_STATUSES }, sessionDate: { gte: todayUtc() } },
  })

// Shrinking a room must not push already-booked children out of their seats.
const assertCapacityFits = async (roomId: string, capacity: number) => {
  const perDate = await prisma.booking.groupBy({
    by: ['sessionDate'],
    where: { roomId, status: { in: ACTIVE_BOOKING_STATUSES }, sessionDate: { gte: todayUtc() } },
    _count: { _all: true },
  })
  const peak = Math.max(0, ...perDate.map((group) => group._count._all))
  if (peak > capacity) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Capacity cannot go below ${peak}, the most seats already booked on one upcoming date`,
    )
  }
}

const createRoom = async (payload: CreateRoomPayload) => {
  const { name, tier, capacity, dayOfWeek, startTime, endTime, priceMultiplier, staffId } = payload
  await assertRoomAssignable(staffId, { dayOfWeek, startTime, endTime })

  return prisma.room.create({
    data: { name, tier, capacity, dayOfWeek, startTime, endTime, priceMultiplier, staffId },
    select: roomSelect,
  })
}

const updateRoom = async (roomId: string, payload: UpdateRoomPayload) => {
  const current = await findRoomOrThrow(roomId)
  const { name, tier, capacity, dayOfWeek, startTime, endTime, priceMultiplier, staffId } = payload

  const schedule: Schedule = {
    dayOfWeek: dayOfWeek ?? current.dayOfWeek,
    startTime: startTime ?? current.startTime,
    endTime: endTime ?? current.endTime,
  }
  if (!isEndAfterStart(schedule)) {
    throw new AppError(httpStatus.BAD_REQUEST, END_AFTER_START_MESSAGE)
  }

  const scheduleChanged =
    schedule.dayOfWeek !== current.dayOfWeek ||
    schedule.startTime !== current.startTime ||
    schedule.endTime !== current.endTime
  const staffChanged = staffId !== undefined && staffId !== current.staff.id

  if (scheduleChanged && (await countUpcomingActiveBookings(roomId)) > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      'Cannot change the schedule while the room has upcoming bookings',
    )
  }
  if (capacity !== undefined && capacity < current.capacity) {
    await assertCapacityFits(roomId, capacity)
  }
  // Validate against the staff member the room will have, not the one it has now.
  if (scheduleChanged || staffChanged) {
    await assertRoomAssignable(staffId ?? current.staff.id, schedule, roomId)
  }

  return prisma.room.update({
    where: { id: roomId },
    data: { name, tier, capacity, dayOfWeek, startTime, endTime, priceMultiplier, staffId },
    select: roomSelect,
  })
}

// Soft delete. Refused while children hold upcoming seats or wait in the queue; the deletion and
// its audit row (SRS 7.4) commit together.
const deleteRoom = async (caller: Caller, roomId: string) => {
  const room = await findRoomOrThrow(roomId)

  const [upcomingBookings, waitingEntries] = await Promise.all([
    countUpcomingActiveBookings(roomId),
    prisma.waitlistEntry.count({ where: { roomId, status: WaitlistStatus.PENDING } }),
  ])
  if (upcomingBookings > 0 || waitingEntries > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      'Cannot delete a room with upcoming bookings or waitlist entries. Cancel them first',
    )
  }

  await prisma.$transaction([
    prisma.room.update({ where: { id: roomId }, data: { isDeleted: true, deletedAt: new Date() } }),
    prisma.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_ROOM_DELETED,
        entity: AUDIT_ROOM_ENTITY,
        entityId: roomId,
        metadata: { name: room.name, staffId: room.staff.id },
      },
    }),
  ])
}

export const RoomService = { createRoom, updateRoom, deleteRoom }
