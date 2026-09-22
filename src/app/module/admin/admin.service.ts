import bcrypt from 'bcryptjs'
import httpStatus from 'http-status'
import { Prisma } from '../../../generated/prisma/client'
import {
  Role,
  StaffType,
  TransportStatus,
  VerificationStatus,
  WaitlistStatus,
  WalletTransactionType,
} from '../../../generated/prisma/enums'
import { config } from '../../config'
import { AppError } from '../../errorHelpers/AppError'
import { ACTIVE_BOOKING_STATUSES } from '../../lib/booking-guards'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import { buildMeta, getPagination } from '../../utils/pagination'
import { attachSeatsLeft } from '../room/room.service'
import { STAFF_NOT_FOUND_MESSAGE, staffSelect } from '../staff/staff.service'
import type {
  CreateStaffPayload,
  ListAuditLogsQuery,
  ListStaffQuery,
  ListUsersQuery,
  UpdateStaffPayload,
  UpdateUserRolePayload,
  VerifyStaffPayload,
} from './admin.interface'

type Caller = Pick<TokenPayload, 'userId'>

const AUDIT_STAFF_ENTITY = 'StaffProfile'
const AUDIT_STAFF_VERIFIED = 'STAFF_VERIFIED'
const AUDIT_STAFF_REJECTED = 'STAFF_REJECTED'
const AUDIT_USER_ENTITY = 'User'
const AUDIT_USER_ROLE_CHANGED = 'USER_ROLE_CHANGED'
const USER_NOT_FOUND_MESSAGE = 'User not found'

const ACTIVE_TRANSPORT_STATUSES = [TransportStatus.REQUESTED, TransportStatus.IN_PROGRESS]
const REVENUE_TRANSACTION_TYPES = [
  WalletTransactionType.CARE_FEE,
  WalletTransactionType.TRANSPORT_FARE,
]
const TOP_RATED_STAFF_LIMIT = 5

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

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })
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

const verifyStaff = async (caller: Caller, staffId: string, payload: VerifyStaffPayload) => {
  const current = await findStaffOrThrow(staffId)
  const { status } = payload

  if (current.verificationStatus === status) {
    throw new AppError(httpStatus.CONFLICT, `Staff is already ${status.toLowerCase()}`)
  }

  const isApproval = payload.status === VerificationStatus.VERIFIED
  const rejectionReason =
    payload.status === VerificationStatus.REJECTED ? payload.rejectionReason : null

  const [staff] = await prisma.$transaction([
    prisma.staffProfile.update({
      where: { id: staffId },
      data: {
        verificationStatus: status,
        verifiedAt: isApproval ? new Date() : null,
        rejectionReason,
      },
      select: staffSelect,
    }),
    prisma.auditLog.create({
      data: {
        userId: caller.userId,
        action: isApproval ? AUDIT_STAFF_VERIFIED : AUDIT_STAFF_REJECTED,
        entity: AUDIT_STAFF_ENTITY,
        entityId: staffId,
        metadata: {
          from: current.verificationStatus,
          to: status,
          rejectionReason,
        },
      },
    }),
  ])

  return staff
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

const getRoomOccupancyRate = async () => {
  const rooms = await prisma.room.findMany({
    where: { isDeleted: false },
    select: { id: true, capacity: true, dayOfWeek: true },
  })
  const seated = await attachSeatsLeft(rooms)
  const totalCapacity = seated.reduce((sum, room) => sum + room.capacity, 0)
  const totalBooked = seated.reduce((sum, room) => sum + room.bookedSeats, 0)
  return totalCapacity === 0 ? 0 : totalBooked / totalCapacity
}

const getTopRatedStaff = async () => {
  const grouped = await prisma.rating.groupBy({
    by: ['staffId'],
    _avg: { score: true },
    _count: { _all: true },
    orderBy: { _avg: { score: 'desc' } },
    take: TOP_RATED_STAFF_LIMIT,
  })
  if (grouped.length === 0) return []

  const staff = await prisma.staffProfile.findMany({
    where: { id: { in: grouped.map((row) => row.staffId) } },
    select: { id: true, user: { select: { name: true } } },
  })
  const nameById = new Map(staff.map((member) => [member.id, member.user.name]))

  return grouped.map((row) => ({
    staffId: row.staffId,
    name: nameById.get(row.staffId) ?? null,
    averageScore: row._avg.score ?? 0,
    ratingCount: row._count._all,
  }))
}

const getDashboardStats = async () => {
  const [
    revenue,
    activeBookings,
    totalWaitlisted,
    promotedWaitlisted,
    roomOccupancyRate,
    topRatedStaff,
  ] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: { type: { in: REVENUE_TRANSACTION_TYPES } },
      _sum: { amount: true },
    }),
    prisma.booking.count({
      where: { status: { in: ACTIVE_BOOKING_STATUSES } },
    }),
    prisma.waitlistEntry.count(),
    prisma.waitlistEntry.count({ where: { status: WaitlistStatus.PROMOTED } }),
    getRoomOccupancyRate(),
    getTopRatedStaff(),
  ])

  return {
    totalRevenue: revenue._sum.amount ?? new Prisma.Decimal(0),
    activeBookings,
    roomOccupancyRate,
    waitlistConversionRate: totalWaitlisted === 0 ? 0 : promotedWaitlisted / totalWaitlisted,
    topRatedStaff,
  }
}

const auditLogSelect = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, role: true } },
} as const

const listAuditLogs = async (query: ListAuditLogsQuery) => {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.entity && { entity: query.entity }),
  }

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: auditLogSelect,
      orderBy: { createdAt: 'desc' },
      ...getPagination(query),
    }),
    prisma.auditLog.count({ where }),
  ])

  return { items, meta: buildMeta(query, total) }
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  profilePhoto: true,
  createdAt: true,
  updatedAt: true,
} as const

const listUsers = async (query: ListUsersQuery) => {
  const where: Prisma.UserWhereInput = {
    isDeleted: false,
    ...(query.role && { role: query.role }),
  }

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: 'desc' },
      ...getPagination(query),
    }),
    prisma.user.count({ where }),
  ])

  return { items, meta: buildMeta(query, total) }
}

// Corrective role changes only, logged to the audit trail.
// ADMIN is off-limits in both directions — it's seed-only (AGENTS.md) — and the destination
// profile (GuardianProfile/StaffProfile) must already exist, so this can never leave a user with
// a role that has no matching profile, and never substitutes for POST /admin/staff.
const updateUserRole = async (caller: Caller, userId: string, { role }: UpdateUserRolePayload) => {
  if (userId === caller.userId) {
    throw new AppError(httpStatus.CONFLICT, 'You cannot change your own role')
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false },
    select: {
      role: true,
      guardianProfile: { select: { id: true } },
      staffProfile: { select: { id: true } },
    },
  })
  if (!user) throw new AppError(httpStatus.NOT_FOUND, USER_NOT_FOUND_MESSAGE)
  if (user.role === Role.ADMIN) {
    throw new AppError(httpStatus.CONFLICT, "An ADMIN account's role cannot be changed here")
  }
  if (user.role === role) {
    throw new AppError(httpStatus.CONFLICT, `This user already has the role ${role}`)
  }

  const hasDestinationProfile =
    role === Role.GUARDIAN ? !!user.guardianProfile : !!user.staffProfile
  if (!hasDestinationProfile) {
    throw new AppError(
      httpStatus.CONFLICT,
      `This user has no ${role.toLowerCase()} profile to switch to. Role changes are corrective only`,
    )
  }

  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { role }, select: userSelect }),
    prisma.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_USER_ROLE_CHANGED,
        entity: AUDIT_USER_ENTITY,
        entityId: userId,
        metadata: { from: user.role, to: role },
      },
    }),
  ])
  return updated
}

export const AdminService = {
  createStaff,
  listStaff,
  getStaff,
  updateStaff,
  verifyStaff,
  deleteStaff,
  getDashboardStats,
  listAuditLogs,
  listUsers,
  updateUserRole,
}
