import httpStatus from 'http-status'
import { Prisma } from '../../../generated/prisma/client'
import { BookingStatus, WaitlistStatus } from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { deleteImage, uploadImageBuffer } from '../../lib/cloudinary'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import { buildMeta, getPagination } from '../../utils/pagination'
import type { CreateChildPayload, ListChildrenQuery, UpdateChildPayload } from './child.interface'

type Caller = Pick<TokenPayload, 'userId'>

const ACTIVE_BOOKING_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED]

const childSelect = {
  id: true,
  name: true,
  dateOfBirth: true,
  tier: true,
  allergies: true,
  conditions: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  profilePhoto: true,
  createdAt: true,
  updatedAt: true,
} as const

export const CHILD_NOT_FOUND_MESSAGE = 'Child not found'
export const getGuardianId = async ({ userId }: Caller) => {
  const profile = await prisma.guardianProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!profile) throw new AppError(httpStatus.NOT_FOUND, 'Guardian profile not found')
  return profile.id
}

// A guardian only ever sees their own, non-deleted children. Someone else's child id gets the
// same 404 as a missing one, so ids can't be probed.
const findOwnedChild = async (guardianId: string, childId: string) => {
  const child = await prisma.child.findFirst({
    where: { id: childId, guardianId, isDeleted: false },
    select: childSelect,
  })
  if (!child) throw new AppError(httpStatus.NOT_FOUND, CHILD_NOT_FOUND_MESSAGE)
  return child
}

const createChild = async (caller: Caller, payload: CreateChildPayload) => {
  const guardianId = await getGuardianId(caller)
  const {
    name,
    dateOfBirth,
    tier,
    allergies,
    conditions,
    emergencyContactName,
    emergencyContactPhone,
  } = payload

  return prisma.child.create({
    data: {
      guardianId,
      name,
      dateOfBirth,
      tier,
      allergies,
      conditions,
      emergencyContactName,
      emergencyContactPhone,
    },
    select: childSelect,
  })
}

// The database collation is C, so a plain `orderBy: { name }` puts every capital letter before
// every lowercase one ("Zoya" < "aarav"). Prisma's orderBy has no `mode: 'insensitive'`, so the
// name sort asks Postgres for the page's ids ordered by LOWER(name), then loads those rows.
// Same filter, same tie-breakers, same skip/take as the Prisma path below.
const findChildrenPageByName = async (
  guardianId: string,
  query: ListChildrenQuery,
  { skip, take }: ReturnType<typeof getPagination>,
) => {
  const tierFilter = query.tier ? Prisma.sql`AND "tier" = ${query.tier}::"Tier"` : Prisma.empty
  const direction = query.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "children"
    WHERE "guardianId" = ${guardianId} AND "isDeleted" = false ${tierFilter}
    ORDER BY LOWER("name") ${direction}, "name" ASC, "id" ASC
    LIMIT ${take} OFFSET ${skip}`

  const ids = rows.map(({ id }) => id)
  const children = await prisma.child.findMany({ where: { id: { in: ids } }, select: childSelect })
  const byId = new Map(children.map((child) => [child.id, child]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

// `id` is always the last sort key so children sharing a date of birth or name keep a stable
// position across pages.
const listMyChildren = async (caller: Caller, query: ListChildrenQuery) => {
  const guardianId = await getGuardianId(caller)
  const where = { guardianId, isDeleted: false, ...(query.tier && { tier: query.tier }) }
  const pagination = getPagination(query)

  const findPage = () =>
    query.sortBy === 'name'
      ? findChildrenPageByName(guardianId, query, pagination)
      : prisma.child.findMany({
          where,
          select: childSelect,
          orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
          ...pagination,
        })

  const [items, total] = await Promise.all([findPage(), prisma.child.count({ where })])

  return { items, meta: buildMeta(query, total) }
}

const getMyChild = async (caller: Caller, childId: string) =>
  findOwnedChild(await getGuardianId(caller), childId)

const updateMyChild = async (caller: Caller, childId: string, payload: UpdateChildPayload) => {
  const guardianId = await getGuardianId(caller)
  await findOwnedChild(guardianId, childId)

  const {
    name,
    dateOfBirth,
    tier,
    allergies,
    conditions,
    emergencyContactName,
    emergencyContactPhone,
  } = payload

  return prisma.child.update({
    where: { id: childId },
    data: {
      name,
      dateOfBirth,
      tier,
      allergies,
      conditions,
      emergencyContactName,
      emergencyContactPhone,
    },
    select: childSelect,
  })
}

// Soft delete. Refused while the child still has live bookings or a waitlist spot, so a
// deleted child can never be checked in or promoted into a seat.
const deleteMyChild = async (caller: Caller, childId: string) => {
  const guardianId = await getGuardianId(caller)
  await findOwnedChild(guardianId, childId)

  const [activeBookings, activeWaitlist] = await Promise.all([
    prisma.booking.count({ where: { childId, status: { in: ACTIVE_BOOKING_STATUSES } } }),
    prisma.waitlistEntry.count({ where: { childId, status: WaitlistStatus.PENDING } }),
  ])
  if (activeBookings > 0 || activeWaitlist > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      'Cannot delete a child with active bookings or waitlist entries. Cancel them first',
    )
  }

  await prisma.child.update({
    where: { id: childId },
    data: { isDeleted: true, deletedAt: new Date() },
  })
}

// publicId isn't part of childSelect (it's an internal Cloudinary detail, not a public field), so
// it's fetched separately here, just for cleaning up the image it's about to replace.
const uploadChildPhoto = async (caller: Caller, childId: string, file: Express.Multer.File) => {
  const guardianId = await getGuardianId(caller)
  const child = await prisma.child.findFirst({
    where: { id: childId, guardianId, isDeleted: false },
    select: { profilePhotoPublicId: true },
  })
  if (!child) throw new AppError(httpStatus.NOT_FOUND, CHILD_NOT_FOUND_MESSAGE)

  const { url, publicId } = await uploadImageBuffer(file.buffer, `carenest/children/${childId}`)
  const updated = await prisma.child.update({
    where: { id: childId },
    data: { profilePhoto: url, profilePhotoPublicId: publicId },
    select: childSelect,
  })

  // Only clean up the old image once the new one is safely saved.
  if (child.profilePhotoPublicId) await deleteImage(child.profilePhotoPublicId)
  return updated
}

export const ChildService = {
  createChild,
  listMyChildren,
  getMyChild,
  updateMyChild,
  deleteMyChild,
  uploadChildPhoto,
}
