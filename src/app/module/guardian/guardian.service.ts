import httpStatus from 'http-status'
import { AppError } from '../../errorHelpers/AppError'
import { deleteImage, uploadImageBuffer } from '../../lib/cloudinary'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import type { UpdateGuardianPayload } from './guardian.interface'

const GUARDIAN_NOT_FOUND_MESSAGE = 'Guardian profile not found'

const guardianSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  profilePhoto: true,
  createdAt: true,
  updatedAt: true,
  guardianProfile: {
    select: { id: true, phone: true, address: true, walletBalance: true },
  },
} as const

const getMyProfile = async ({ userId }: Pick<TokenPayload, 'userId'>) => {
  const guardian = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false, guardianProfile: { isNot: null } },
    select: guardianSelect,
  })
  if (!guardian) throw new AppError(httpStatus.NOT_FOUND, GUARDIAN_NOT_FOUND_MESSAGE)
  return guardian
}

// Name lives on User, phone/address on GuardianProfile: one nested update keeps them atomic.
const updateMyProfile = async (
  { userId }: Pick<TokenPayload, 'userId'>,
  { name, phone, address }: UpdateGuardianPayload,
) => {
  await getMyProfile({ userId })

  return prisma.user.update({
    where: { id: userId },
    data: {
      name,
      guardianProfile: { update: { phone, address } },
    },
    select: guardianSelect,
  })
}

// Soft delete: the row stays for booking/payment history. Clearing refreshTokenHash ends the
// session; auth() already rejects deleted users, so existing access tokens stop working too.
const deleteMyAccount = async ({ userId }: Pick<TokenPayload, 'userId'>) => {
  await getMyProfile({ userId })

  await prisma.user.update({
    where: { id: userId },
    data: { isDeleted: true, deletedAt: new Date(), refreshTokenHash: null },
  })
}

// publicId isn't part of guardianSelect (it's an internal Cloudinary detail, not a public field),
// so it's fetched separately here, just for cleaning up the image it's about to replace.
const uploadMyPhoto = async (
  { userId }: Pick<TokenPayload, 'userId'>,
  file: Express.Multer.File,
) => {
  const current = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false, guardianProfile: { isNot: null } },
    select: { profilePhotoPublicId: true },
  })
  if (!current) throw new AppError(httpStatus.NOT_FOUND, GUARDIAN_NOT_FOUND_MESSAGE)

  const { url, publicId } = await uploadImageBuffer(file.buffer, `carenest/users/${userId}`)
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { profilePhoto: url, profilePhotoPublicId: publicId },
    select: guardianSelect,
  })

  // Only clean up the old image once the new one is safely saved.
  if (current.profilePhotoPublicId) await deleteImage(current.profilePhotoPublicId)
  return updated
}

export const GuardianService = { getMyProfile, updateMyProfile, deleteMyAccount, uploadMyPhoto }
