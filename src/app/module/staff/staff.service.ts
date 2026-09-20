import httpStatus from 'http-status'
import { AppError } from '../../errorHelpers/AppError'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import type { UpdateMyStaffPayload } from './staff.interface'

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

export const StaffService = { getMyProfile, updateMyProfile }
