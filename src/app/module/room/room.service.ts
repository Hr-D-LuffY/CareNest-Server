import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import {
  BookingStatus,
  DayOfWeek,
  StaffType,
  VerificationStatus,
  WaitlistStatus,
} from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import { buildMeta, getPagination } from '../../utils/pagination'
import { END_AFTER_START_MESSAGE, isEndAfterStart } from '../staff/staff.interface'
import { STAFF_NOT_FOUND_MESSAGE } from '../staff/staff.service'
import type {
  CreateRoomPayload,
  ListRoomsQuery,
  ROOM_SORT_FIELDS,
  RoomDetailQuery,
  UpdateRoomPayload,
} from './room.interface'

type Caller = Pick<TokenPayload, 'userId'>
type Schedule = { dayOfWeek: DayOfWeek; startTime: string; endTime: string }

export const ROOM_NOT_FOUND_MESSAGE = 'Room not found'
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

const DAYS_IN_WEEK = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000
const ISO_DATE_LENGTH = 'YYYY-MM-DD'.length

// Index = Date#getUTCDay()
export const WEEKDAYS = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
]

// Session dates are calendar dates (@db.Date), so they are compared as UTC midnights.
const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
const todayUtc = () => startOfUtcDay(new Date())

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

// A room repeats weekly: its next session is the first date from today (inclusive) that falls on
// the room's day of the week.
const nextSessionDate = (dayOfWeek: DayOfWeek) => {
  const today = todayUtc()
  const daysAhead = (WEEKDAYS.indexOf(dayOfWeek) - today.getUTCDay() + DAYS_IN_WEEK) % DAYS_IN_WEEK
  return new Date(today.getTime() + daysAhead * MS_PER_DAY)
}

export const toSessionDate = (date: Date) => {
  const sessionDate = startOfUtcDay(date)
  if (sessionDate < todayUtc()) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Date cannot be in the past')
  }
  return sessionDate
}

const resolveRequestedDate = (date?: Date) => (date ? toSessionDate(date) : undefined)

type RoomRecord = Awaited<ReturnType<typeof findRoomOrThrow>>
type SeatedRoom = Pick<RoomRecord, 'id' | 'capacity' | 'dayOfWeek'>

const seatKey = (roomId: string, sessionDate: Date) => `${roomId}|${sessionDate.getTime()}`

// THE one place seatsLeft is computed (booking validation and waitlist promotion reuse it): seats
// taken are the CONFIRMED bookings for that room on that session date. One grouped query serves
// any number of rooms. Without `date`, each room is checked for its next upcoming session. Pass a
// transaction client to count inside a transaction.
export const attachSeatsLeft = async <T extends SeatedRoom>(
  rooms: T[],
  date?: Date,
  client: Prisma.TransactionClient = prisma,
) => {
  const sessions = rooms.map((room) => ({
    room,
    sessionDate: date ?? nextSessionDate(room.dayOfWeek),
  }))
  const dates = [
    ...new Map(sessions.map(({ sessionDate }) => [sessionDate.getTime(), sessionDate])).values(),
  ]

  const booked =
    rooms.length === 0
      ? []
      : await client.booking.groupBy({
          by: ['roomId', 'sessionDate'],
          where: {
            roomId: { in: rooms.map((room) => room.id) },
            sessionDate: { in: dates },
            status: BookingStatus.CONFIRMED,
          },
          _count: { _all: true },
        })
  const bookedByRoomDate = new Map(
    booked.map((group) => [seatKey(group.roomId, group.sessionDate), group._count._all]),
  )

  return sessions.map(({ room, sessionDate }) => {
    const bookedSeats = bookedByRoomDate.get(seatKey(room.id, sessionDate)) ?? 0
    return {
      ...room,
      sessionDate,
      bookedSeats,
      seatsLeft: Math.max(0, room.capacity - bookedSeats),
    }
  })
}

type RoomWithSeats = Awaited<ReturnType<typeof attachSeatsLeft<RoomRecord>>>[number]

const toRoomView = ({ sessionDate, ...room }: RoomWithSeats) => ({
  ...room,
  sessionDate: sessionDate.toISOString().slice(0, ISO_DATE_LENGTH),
})

const SORT_KEYS: Record<
  (typeof ROOM_SORT_FIELDS)[number],
  (room: RoomWithSeats) => string | number
> = {
  createdAt: (room) => room.createdAt.getTime(),
  name: (room) => room.name.toLowerCase(),
  startTime: (room) => room.startTime,
  capacity: (room) => room.capacity,
  priceMultiplier: (room) => room.priceMultiplier.toNumber(),
  seatsLeft: (room) => room.seatsLeft,
}

// Stable sort, so rooms that tie keep the newest-first order they were fetched in.
const sortRooms = (
  rooms: RoomWithSeats[],
  sortBy: keyof typeof SORT_KEYS,
  sortOrder: 'asc' | 'desc',
) => {
  const key = SORT_KEYS[sortBy]
  const direction = sortOrder === 'asc' ? 1 : -1
  return [...rooms].sort((a, b) => {
    const [left, right] = [key(a), key(b)]
    if (left === right) return 0
    return left < right ? -direction : direction
  })
}

// seatsLeft is computed per room, so filtering and sorting by it happens after the fetch and the
// page is cut from the result. The room catalogue is small and admin-managed, so this stays cheap.
const listRooms = async (query: ListRoomsQuery) => {
  const { tier, status, dayOfWeek, date, q, sortBy, sortOrder } = query
  const sessionDate = resolveRequestedDate(date)
  const dateWeekday = sessionDate && WEEKDAYS[sessionDate.getUTCDay()]
  if (dateWeekday && dayOfWeek && dateWeekday !== dayOfWeek) {
    throw new AppError(httpStatus.BAD_REQUEST, `That date is a ${dateWeekday}, not a ${dayOfWeek}`)
  }
  const runsOn = dateWeekday ?? dayOfWeek

  const where: Prisma.RoomWhereInput = {
    isDeleted: false,
    ...(tier && { tier }),
    ...(runsOn && { dayOfWeek: runsOn }),
    ...(q && {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { staff: { user: { name: { contains: q, mode: 'insensitive' } } } },
      ],
    }),
  }
  const rooms = await prisma.room.findMany({
    where,
    select: roomSelect,
    orderBy: { createdAt: 'desc' },
  })

  const withSeats = await attachSeatsLeft(rooms, sessionDate)
  const matching = status
    ? withSeats.filter((room) => room.seatsLeft > 0 === (status === 'AVAILABLE'))
    : withSeats
  const sorted = sortRooms(matching, sortBy, sortOrder)

  const { skip, take } = getPagination(query)
  return {
    items: sorted.slice(skip, skip + take).map(toRoomView),
    meta: buildMeta(query, sorted.length),
  }
}

const getRoom = async (roomId: string, { date }: RoomDetailQuery) => {
  const room = await findRoomOrThrow(roomId)
  const sessionDate = resolveRequestedDate(date)
  if (sessionDate && WEEKDAYS[sessionDate.getUTCDay()] !== room.dayOfWeek) {
    throw new AppError(httpStatus.BAD_REQUEST, `This room runs on ${room.dayOfWeek}s`)
  }

  const [withSeats] = await attachSeatsLeft([room], sessionDate)
  if (!withSeats) throw new AppError(httpStatus.NOT_FOUND, ROOM_NOT_FOUND_MESSAGE)
  return toRoomView(withSeats)
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

export const RoomService = { createRoom, listRooms, getRoom, updateRoom, deleteRoom }
