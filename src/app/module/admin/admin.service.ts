import bcrypt from 'bcryptjs'
import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import { Role, StaffType, TransportStatus } from '../../../generated/prisma/enums'
import { config } from '../../config'
import { AppError } from '../../errorHelpers/AppError'
import { prisma } from '../../lib/prisma'
import { buildMeta, getPagination } from '../../utils/pagination'
import { STAFF_NOT_FOUND_MESSAGE, staffSelect } from '../staff/staff.service'
import type { CreateStaffPayload, ListStaffQuery, UpdateStaffPayload } from './admin.interface'

const ACTIVE_TRANSPORT_STATUSES = [TransportStatus.REQUESTED, TransportStatus.IN_PROGRESS]

type Rates = {
  hourlyRate?: Prisma.Decimal | number | null
  perMinuteRate?: Prisma.Decimal | number | null
}

// Fares are hourlyRate-based for sitters and perMinuteRate-based for drivers, so the rate(s)
// a type needs must exist. BOTH needs both. Used by create and by update (on the merged state).
const assertRatesMatchType = (staffType: StaffType, { hourlyRate, perMinuteRate }: Rates) => {
  if (staffType !== StaffType.DRIVER && hourlyRate == null) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `hourlyRate is required for staff type ${staffType}`,
      [{ path: 'hourlyRate', message: 'Required for sitters' }],
    )
  }
  if (staffType !== StaffType.SITTER && perMinuteRate == null) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `perMinuteRate is required for staff type ${staffType}`,
      [{ path: 'perMinuteRate', message: 'Required for drivers' }],
    )
  }
}

const findStaffOrThrow = async (staffId: string) => {
  const staff = await prisma.staffProfile.findFirst({
    where: { id: staffId, isDeleted: false },
    select: staffSelect,
  })
  if (!staff) throw new AppError(httpStatus.NOT_FOUND, STAFF_NOT_FOUND_MESSAGE)
  return staff
}

const createStaff = async (payload: CreateStaffPayload) => {
  const { name, email, password, staffType, bio, experience, hourlyRate, perMinuteRate } = payload
  assertRatesMatchType(staffType, { hourlyRate, perMinuteRate })

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw new AppError(httpStatus.CONFLICT, 'An account with this email already exists')
  }

  const passwordHash = await bcrypt.hash(password, config.bcryptSaltRounds)

  // User and staff profile are created together or not at all.
  return prisma.staffProfile.create({
    data: {
      staffType,
      bio,
      experience,
      hourlyRate,
      perMinuteRate,
      user: { create: { name, email, passwordHash, role: Role.STAFF } },
    },
    select: staffSelect,
  })
}

const listStaff = async (query: ListStaffQuery) => {
  const { staffType, verificationStatus, search } = query
  const where: Prisma.StaffProfileWhereInput = {
    isDeleted: false,
    ...(staffType && { staffType }),
    ...(verificationStatus && { verificationStatus }),
    ...(search && {
      user: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
    }),
  }

  const [items, total] = await Promise.all([
    prisma.staffProfile.findMany({
      where,
      select: staffSelect,
      orderBy: { createdAt: 'desc' },
      ...getPagination(query),
    }),
    prisma.staffProfile.count({ where }),
  ])

  return { items, meta: buildMeta(query, total) }
}

const getStaff = (staffId: string) => findStaffOrThrow(staffId)

const updateStaff = async (staffId: string, payload: UpdateStaffPayload) => {
  const current = await findStaffOrThrow(staffId)
  const { name, staffType, bio, experience, hourlyRate, perMinuteRate } = payload

  // undefined keeps the stored value, null clears it: validate what the profile will look like.
  assertRatesMatchType(staffType ?? current.staffType, {
    hourlyRate: hourlyRate === undefined ? current.hourlyRate : hourlyRate,
    perMinuteRate: perMinuteRate === undefined ? current.perMinuteRate : perMinuteRate,
  })

  return prisma.staffProfile.update({
    where: { id: staffId },
    data: {
      staffType,
      bio,
      experience,
      hourlyRate,
      perMinuteRate,
      user: { update: { name } },
    },
    select: staffSelect,
  })
}

// Soft delete of profile and login together (one nested write). Refused while the staff member
// still runs rooms or has open transport bookings, so nothing is left without an owner.
const deleteStaff = async (staffId: string) => {
  await findStaffOrThrow(staffId)

  const [activeRooms, activeTrips] = await Promise.all([
    prisma.room.count({ where: { staffId, isDeleted: false } }),
    prisma.transportBooking.count({
      where: { driverId: staffId, status: { in: ACTIVE_TRANSPORT_STATUSES } },
    }),
  ])
  if (activeRooms > 0 || activeTrips > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      'Cannot delete staff who still have rooms or open transport bookings. Reassign or remove them first',
    )
  }

  const deletedAt = new Date()
  await prisma.staffProfile.update({
    where: { id: staffId },
    data: {
      isDeleted: true,
      deletedAt,
      user: { update: { isDeleted: true, deletedAt, refreshTokenHash: null } },
    },
  })
}

export const AdminService = { createStaff, listStaff, getStaff, updateStaff, deleteStaff }
