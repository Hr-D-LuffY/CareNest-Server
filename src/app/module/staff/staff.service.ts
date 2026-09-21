import httpStatus from 'http-status'
import { AppError } from '../../errorHelpers/AppError'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import {
  type CreateSlotPayload,
  isEndAfterStart,
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

export const StaffService = {
  getMyProfile,
  updateMyProfile,
  createMySlot,
  listStaffSlots,
  updateMySlot,
  deleteMySlot,
}
