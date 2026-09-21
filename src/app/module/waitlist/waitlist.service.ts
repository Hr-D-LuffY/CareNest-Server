import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import { Role, type Tier, WaitlistStatus } from '../../../generated/prisma/enums'
import {
  CANCELLATION_WINDOW_DAYS,
  MAX_CANCELLATION_PENALTY,
  TIER_WEIGHTS,
  WAITLIST_WEIGHTS,
} from '../../constants/waitlist.constants'
import { AppError } from '../../errorHelpers/AppError'
import { prisma } from '../../lib/prisma'
import { toIsoDate } from '../../utils/date'
import type { TokenPayload } from '../../utils/jwt'
import { buildMeta, getPagination } from '../../utils/pagination'
import { ROOM_NOT_FOUND_MESSAGE, startOfUtcDay } from '../room/room.service'
import type { ListRoomWaitlistQuery } from './waitlist.interface'

type Caller = Pick<TokenPayload, 'userId' | 'role'>

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

const waitlistEntrySelect = {
  id: true,
  sessionDate: true,
  status: true,
  priorityScore: true,
  joinedAt: true,
  room: { select: { id: true, name: true } },
  child: { select: { id: true, name: true, tier: true } },
} as const

type WaitlistEntryRecord = Prisma.WaitlistEntryGetPayload<{ select: typeof waitlistEntrySelect }>

const toEntryView = (entry: WaitlistEntryRecord) => ({
  ...entry,
  sessionDate: toIsoDate(entry.sessionDate),
})

// The guardian's cancellations inside the last 30 days, capped at 5 (SRS 4.7).
export const countRecentCancellations = async (
  client: Prisma.TransactionClient,
  guardianId: string,
  now = new Date(),
) => {
  const cancellations = await client.booking.count({
    where: {
      guardianId,
      cancelledAt: { gte: new Date(now.getTime() - CANCELLATION_WINDOW_DAYS * MS_PER_DAY) },
    },
  })
  return Math.min(cancellations, MAX_CANCELLATION_PENALTY)
}

// THE one place the priority formula lives: (W1 x waitTimeHours) + (W2 x tierWeight) -
// (W3 x cancellationPenalty). Re-ranking on cancellation reuses it.
export const calculatePriorityScore = ({
  joinedAt,
  tier,
  cancellationPenalty,
  now = new Date(),
}: {
  joinedAt: Date
  tier: Tier
  cancellationPenalty: number
  now?: Date
}) => {
  const waitTimeHours = Math.max(0, now.getTime() - joinedAt.getTime()) / MS_PER_HOUR
  return (
    WAITLIST_WEIGHTS.waitTimeHours * waitTimeHours +
    WAITLIST_WEIGHTS.tier * TIER_WEIGHTS[tier] -
    WAITLIST_WEIGHTS.cancellationPenalty * cancellationPenalty
  )
}

// Queues a child for a full room. Runs inside the caller's booking transaction, so the queue spot
// and the "room is full" check see the same state.
export const joinWaitlist = async (
  tx: Prisma.TransactionClient,
  entry: { roomId: string; childId: string; guardianId: string; sessionDate: Date; tier: Tier },
) => {
  const { roomId, childId, guardianId, sessionDate, tier } = entry

  const alreadyQueued = await tx.waitlistEntry.findFirst({
    where: { roomId, childId, sessionDate, status: WaitlistStatus.PENDING },
    select: { id: true },
  })
  if (alreadyQueued) {
    throw new AppError(httpStatus.CONFLICT, 'The child is already on the waitlist for this session')
  }

  const now = new Date()
  const cancellationPenalty = await countRecentCancellations(tx, guardianId, now)
  const created = await tx.waitlistEntry.create({
    data: {
      roomId,
      childId,
      guardianId,
      sessionDate,
      joinedAt: now,
      priorityScore: calculatePriorityScore({ joinedAt: now, tier, cancellationPenalty, now }),
    },
    select: waitlistEntrySelect,
  })
  return toEntryView(created)
}

// Staff see the queue of the rooms they run; admins see any room's queue. Someone else's room gets
// the same 404 as a missing one.
const listRoomWaitlist = async (caller: Caller, roomId: string, query: ListRoomWaitlistQuery) => {
  const room = await prisma.room.findFirst({
    where: { id: roomId, isDeleted: false },
    select: { staff: { select: { userId: true } } },
  })
  const canView = room && (caller.role === Role.ADMIN || room.staff.userId === caller.userId)
  if (!canView) throw new AppError(httpStatus.NOT_FOUND, ROOM_NOT_FOUND_MESSAGE)

  const where: Prisma.WaitlistEntryWhereInput = {
    roomId,
    status: WaitlistStatus.PENDING,
    ...(query.date && { sessionDate: startOfUtcDay(query.date) }),
  }
  const [items, total] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where,
      select: {
        ...waitlistEntrySelect,
        guardian: { select: { id: true, user: { select: { name: true } } } },
      },
      orderBy: [{ priorityScore: 'desc' }, { joinedAt: 'asc' }],
      ...getPagination(query),
    }),
    prisma.waitlistEntry.count({ where }),
  ])

  return { items: items.map(toEntryView), meta: buildMeta(query, total) }
}

export const WaitlistService = { listRoomWaitlist }
