import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import { BookingStatus, Role, Tier, WaitlistStatus } from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { findOverlappingBooking } from '../../lib/booking-guards'
import { estimateCareFee } from '../../lib/fare.service'
import { prisma } from '../../lib/prisma'
import { toIsoDate } from '../../utils/date'
import type { TokenPayload } from '../../utils/jwt'
import { buildMeta, getPagination } from '../../utils/pagination'
import { attachSeatsLeft, ROOM_NOT_FOUND_MESSAGE, startOfUtcDay } from '../room/room.service'
import type { ListRoomWaitlistQuery } from './waitlist.interface'

type Caller = Pick<TokenPayload, 'userId' | 'role'>

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

const AUDIT_WAITLIST_ENTITY = 'WaitlistEntry'
const AUDIT_WAITLIST_PROMOTED = 'WAITLIST_PROMOTED'
const AUDIT_WAITLIST_EXPIRED = 'WAITLIST_EXPIRED'

// priorityScore = (W1 x waitTimeHours) + (W2 x tierWeight) - (W3 x cancellationPenalty), SRS 4.7
const WAITLIST_WEIGHTS = {
  waitTimeHours: 0.5,
  tier: 0.3,
  cancellationPenalty: 0.4,
} as const

const TIER_WEIGHTS: Record<Tier, number> = {
  [Tier.MONTHLY]: 3,
  [Tier.WEEKLY]: 2,
  [Tier.DAILY]: 1,
}

// Only this many recent cancellations count against a guardian, over this many days.
const MAX_CANCELLATION_PENALTY = 5
const CANCELLATION_WINDOW_DAYS = 30

const roomForPromotionSelect = {
  id: true,
  isDeleted: true,
  capacity: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  priceMultiplier: true,
  staff: { select: { hourlyRate: true } },
} as const

type RoomForPromotion = Prisma.RoomGetPayload<{ select: typeof roomForPromotionSelect }>

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

// Recomputes the score of every PENDING entry for the room's session, saves it, and returns the
// entries best-first (ties go to whoever joined earlier). A guardian's cancellation penalty is
// counted once per guardian, not once per entry.
const rerankWaitlist = async (tx: Prisma.TransactionClient, roomId: string, sessionDate: Date) => {
  const entries = await tx.waitlistEntry.findMany({
    where: { roomId, sessionDate, status: WaitlistStatus.PENDING },
    select: {
      id: true,
      childId: true,
      guardianId: true,
      joinedAt: true,
      child: { select: { tier: true, isDeleted: true } },
    },
  })

  const now = new Date()
  const guardianIds = [...new Set(entries.map((entry) => entry.guardianId))]
  const penalties = new Map(
    await Promise.all(
      guardianIds.map(
        async (guardianId) =>
          [guardianId, await countRecentCancellations(tx, guardianId, now)] as const,
      ),
    ),
  )

  const ranked = entries
    .map((entry) => ({
      ...entry,
      priorityScore: calculatePriorityScore({
        joinedAt: entry.joinedAt,
        tier: entry.child.tier,
        cancellationPenalty: penalties.get(entry.guardianId) ?? 0,
        now,
      }),
    }))
    .sort(
      (a, b) => b.priorityScore - a.priorityScore || a.joinedAt.getTime() - b.joinedAt.getTime(),
    )

  await Promise.all(
    ranked.map(({ id, priorityScore }) =>
      tx.waitlistEntry.update({ where: { id }, data: { priorityScore } }),
    ),
  )
  return ranked
}

type RankedEntry = Awaited<ReturnType<typeof rerankWaitlist>>[number]

// Why a top-ranked entry can't take the seat any more; it drops off the queue instead of blocking
// everyone behind it. Null means it is still eligible.
const findPromotionBlocker = async (
  tx: Prisma.TransactionClient,
  entry: RankedEntry,
  room: RoomForPromotion,
  sessionDate: Date,
  estimatedFee: Prisma.Decimal,
) => {
  if (entry.child.isDeleted) return 'The child profile was removed'

  const { walletBalance } = await tx.guardianProfile.findUniqueOrThrow({
    where: { id: entry.guardianId },
    select: { walletBalance: true },
  })
  if (walletBalance.lt(estimatedFee)) return 'Insufficient wallet balance'

  const clash = await findOverlappingBooking(tx, entry.childId, sessionDate, room)
  if (clash) return 'The child holds an overlapping booking'
  return null
}

const expireEntry = async (tx: Prisma.TransactionClient, entryId: string, reason: string) => {
  await tx.waitlistEntry.update({
    where: { id: entryId },
    data: { status: WaitlistStatus.EXPIRED },
  })
  await tx.auditLog.create({
    data: {
      action: AUDIT_WAITLIST_EXPIRED,
      entity: AUDIT_WAITLIST_ENTITY,
      entityId: entryId,
      metadata: { reason },
    },
  })
}

const promoteEntry = async (
  tx: Prisma.TransactionClient,
  entry: RankedEntry,
  roomId: string,
  sessionDate: Date,
  estimatedFee: Prisma.Decimal,
) => {
  const booking = await tx.booking.create({
    data: {
      childId: entry.childId,
      roomId,
      guardianId: entry.guardianId,
      sessionDate,
      status: BookingStatus.CONFIRMED,
      estimatedFee,
    },
    select: { id: true },
  })
  await tx.waitlistEntry.update({
    where: { id: entry.id },
    data: { status: WaitlistStatus.PROMOTED, promotedAt: new Date(), bookingId: booking.id },
  })
  // The audit row is the promotion notice for now; the email goes out once notifications exist.
  await tx.auditLog.create({
    data: {
      action: AUDIT_WAITLIST_PROMOTED,
      entity: AUDIT_WAITLIST_ENTITY,
      entityId: entry.id,
      metadata: { bookingId: booking.id, roomId, priorityScore: entry.priorityScore },
    },
  })
}

// Fills the seats a cancellation freed from the room's waitlist (SRS 4.7): re-rank every PENDING
// entry, then walk the ranking best-first, promoting into a CONFIRMED booking until the room is
// full again. Runs inside the caller's transaction, which must already hold the room's row lock so
// two cancellations can't hand out the same seat. Entries that can no longer take the seat expire.
export const promoteFromWaitlist = async (
  tx: Prisma.TransactionClient,
  { roomId, sessionDate }: { roomId: string; sessionDate: Date },
) => {
  const room = await tx.room.findUnique({ where: { id: roomId }, select: roomForPromotionSelect })
  if (!room || room.isDeleted) return

  const [seated] = await attachSeatsLeft([room], sessionDate, tx)
  let seatsLeft = seated?.seatsLeft ?? 0
  const estimatedFee = estimateCareFee(room)
  if (seatsLeft === 0 || !estimatedFee) return

  for (const entry of await rerankWaitlist(tx, roomId, sessionDate)) {
    if (seatsLeft === 0) break

    const blocker = await findPromotionBlocker(tx, entry, room, sessionDate, estimatedFee)
    if (blocker) {
      await expireEntry(tx, entry.id, blocker)
      continue
    }
    await promoteEntry(tx, entry, roomId, sessionDate, estimatedFee)
    seatsLeft -= 1
  }
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
