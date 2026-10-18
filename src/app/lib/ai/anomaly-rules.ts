// Statistics find the anomalies; the LLM only explains them. Everything here is a pure function of
// plain numbers: no Prisma, no LLM, no clock (the caller passes `asOf` inside the metrics). That is
// what keeps the insights card working when every AI provider is down, and what makes the rules
// easy to test.

export type AnomalySeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export type AnomalyType =
  | 'CANCELLATION_SPIKE'
  | 'REPEAT_CANCELLER'
  | 'STAFF_RATING_DROP'
  | 'REVENUE_DROP'
  | 'WALLET_SHORTFALLS'
  | 'ROOM_HIGH_DEMAND'
  | 'ROOM_LOW_OCCUPANCY'
  | 'STALE_VERIFICATION'

export type AnomalyEntityType = 'PLATFORM' | 'GUARDIAN' | 'STAFF' | 'ROOM'

export interface Anomaly {
  // Stable for the same finding (type + entity), so the UI can key on it.
  id: string
  type: AnomalyType
  severity: AnomalySeverity
  title: string
  // Plain-language description written by the rules themselves, so it is correct with or without an LLM.
  detail: string
  // What was measured and what it is compared with: the previous period or the normal level, and
  // for rules with no history to compare (wallet shortfalls, occupancy) the alert threshold.
  metric: { value: number; baseline: number }
  // The admin page for the thing concerned. Always built here, never by the model.
  entity: { type: AnomalyEntityType; id: string; href: string }
}

// ---- Metrics (what the collector hands to the rules) ----------------------------------------------

export interface PeriodComparison {
  current: number
  previous: number
}

export interface StaffRatingWindow {
  staffId: string
  name: string
  currentAverage: number
  currentCount: number
  previousAverage: number
  previousCount: number
}

export interface RoomDemand {
  id: string
  name: string
  capacity: number
  // Days since the room was created; a room younger than the window has no history to judge.
  ageDays: number
  // The room's last four sessions (oldest first) and how many seats were taken in each.
  sessions: { date: string; booked: number }[]
  // Guardians queued for the room's upcoming sessions.
  waitlistPending: number
}

export interface InsightMetrics {
  asOf: string
  // The last 28 days against the 28 before, for the narrative and the card's headline numbers.
  overview: {
    bookings: PeriodComparison
    cancellations: PeriodComparison
    revenue: PeriodComparison
    completedCheckouts: number
    insufficientBalanceCheckouts: number
  }
  // The last 28 complete days, oldest first.
  dailyCancellations: { date: string; count: number }[]
  // The last 7 complete days against the 7 before.
  weeklyCancellations: PeriodComparison
  weeklyRevenue: PeriodComparison
  // Guardians with many cancellations in the last 30 days. Ids only: names never go near a provider.
  repeatCancellers: { userId: string; cancellations: number }[]
  staffRatings: StaffRatingWindow[]
  rooms: RoomDemand[]
  pendingVerifications: { staffId: string; name: string; waitingDays: number }[]
}

// ---- Thresholds (AGENTS.md "AI Features" table) -----------------------------------------------------

const SPIKE_SIGMA = 2
const SPIKE_RECENT_DAYS = 7
// A "spike" of one or two cancellations is noise on a small platform.
const SPIKE_MIN_DAILY_COUNT = 3
const WEEKLY_SPIKE_RATIO = 1.5
const WEEKLY_SPIKE_MIN_COUNT = 5

export const REPEAT_CANCELLER_MIN = 5

const RATING_DROP_MIN = 0.7
const RATING_DROP_CRITICAL = 1.2
const RATING_MIN_COUNT = 3

const REVENUE_DROP_RATIO = 0.3
const REVENUE_DROP_CRITICAL_RATIO = 0.5

const SHORTFALL_MIN_CHECKOUTS = 5
const SHORTFALL_RATE = 0.2
const SHORTFALL_CRITICAL_RATE = 0.4

const ROOM_HISTORY_SESSIONS = 4
const ROOM_FULL_OCCUPANCY = 0.9
const ROOM_FULL_MIN_WAITLIST = 3
const ROOM_LOW_OCCUPANCY = 0.3

const STALE_VERIFICATION_DAYS = 7
const STALE_VERIFICATION_WARNING_DAYS = 14

const PERCENT = 100
const ONE_DECIMAL = 10

const SEVERITY_ORDER: Record<AnomalySeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }

const ADMIN_HOME = '/admin'
const platform = { type: 'PLATFORM', id: 'platform', href: ADMIN_HOME } as const

const round1 = (value: number) => Math.round(value * ONE_DECIMAL) / ONE_DECIMAL
const percent = (fraction: number) => Math.round(fraction * PERCENT)
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

// ---- Rules ---------------------------------------------------------------------------------------

// Either one recent day well above the 28-day pattern (more than 2 standard deviations over the
// mean), or the last week at least 1.5x the week before. Reported once, weekly first.
const detectCancellationSpike = ({
  dailyCancellations,
  weeklyCancellations,
}: InsightMetrics): Anomaly[] => {
  const { current, previous } = weeklyCancellations
  if (
    current >= WEEKLY_SPIKE_MIN_COUNT &&
    previous > 0 &&
    current >= previous * WEEKLY_SPIKE_RATIO
  ) {
    return [
      {
        id: 'CANCELLATION_SPIKE:week',
        type: 'CANCELLATION_SPIKE',
        severity: 'WARNING',
        title: 'Cancellations are up week over week',
        detail: `${plural(current, 'booking')} were cancelled in the last 7 days, against ${previous} the week before.`,
        metric: { value: current, baseline: previous },
        entity: platform,
      },
    ]
  }

  const counts = dailyCancellations.map(({ count }) => count)
  if (counts.length === 0) return []
  const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length
  const deviation = Math.sqrt(
    counts.reduce((sum, count) => sum + (count - mean) ** 2, 0) / counts.length,
  )
  const limit = mean + SPIKE_SIGMA * deviation

  const spike = dailyCancellations
    .slice(-SPIKE_RECENT_DAYS)
    .filter(({ count }) => count > limit && count >= SPIKE_MIN_DAILY_COUNT)
    .sort((a, b) => b.count - a.count || b.date.localeCompare(a.date))[0]
  if (!spike) return []

  return [
    {
      id: `CANCELLATION_SPIKE:${spike.date}`,
      type: 'CANCELLATION_SPIKE',
      severity: 'WARNING',
      title: 'Unusually many cancellations in one day',
      detail: `${plural(spike.count, 'booking')} were cancelled on ${spike.date}; a normal day in the last 28 has ${round1(mean)}.`,
      metric: { value: spike.count, baseline: round1(mean) },
      entity: platform,
    },
  ]
}

const detectRepeatCancellers = ({ repeatCancellers }: InsightMetrics): Anomaly[] =>
  repeatCancellers
    .filter(({ cancellations }) => cancellations >= REPEAT_CANCELLER_MIN)
    .map(({ userId, cancellations }) => ({
      id: `REPEAT_CANCELLER:${userId}`,
      type: 'REPEAT_CANCELLER',
      severity: 'WARNING',
      title: 'A guardian keeps cancelling',
      // Deliberately no name: the admin follows the link, and nothing personal is written into text
      // that may be sent to a provider.
      detail: `A guardian cancelled ${cancellations} bookings in the last 30 days.`,
      metric: { value: cancellations, baseline: REPEAT_CANCELLER_MIN },
      entity: { type: 'GUARDIAN', id: userId, href: `/admin/users/${userId}` },
    }))

const detectStaffRatingDrops = ({ staffRatings }: InsightMetrics): Anomaly[] =>
  staffRatings.flatMap((staff) => {
    if (staff.currentCount < RATING_MIN_COUNT || staff.previousCount < RATING_MIN_COUNT) return []
    const drop = staff.previousAverage - staff.currentAverage
    if (drop < RATING_DROP_MIN) return []
    return [
      {
        id: `STAFF_RATING_DROP:${staff.staffId}`,
        type: 'STAFF_RATING_DROP',
        severity: drop >= RATING_DROP_CRITICAL ? 'CRITICAL' : 'WARNING',
        title: `${staff.name}'s rating dropped`,
        detail: `${staff.name} averaged ${round1(staff.currentAverage)} over ${plural(staff.currentCount, 'rating')} in the last 28 days, down from ${round1(staff.previousAverage)}.`,
        metric: { value: round1(staff.currentAverage), baseline: round1(staff.previousAverage) },
        entity: { type: 'STAFF', id: staff.staffId, href: `/admin/staff/${staff.staffId}` },
      } satisfies Anomaly,
    ]
  })

const detectRevenueDrop = ({ weeklyRevenue }: InsightMetrics): Anomaly[] => {
  const { current, previous } = weeklyRevenue
  if (previous <= 0) return []
  const drop = (previous - current) / previous
  if (drop <= REVENUE_DROP_RATIO) return []
  return [
    {
      id: 'REVENUE_DROP:week',
      type: 'REVENUE_DROP',
      severity: drop >= REVENUE_DROP_CRITICAL_RATIO ? 'CRITICAL' : 'WARNING',
      title: 'Revenue fell week over week',
      detail: `Revenue was ${Math.round(current)} in the last 7 days, down ${percent(drop)}% from ${Math.round(previous)} the week before.`,
      metric: { value: Math.round(current), baseline: Math.round(previous) },
      entity: platform,
    },
  ]
}

const detectWalletShortfalls = ({ overview }: InsightMetrics): Anomaly[] => {
  const { completedCheckouts, insufficientBalanceCheckouts } = overview
  if (completedCheckouts < SHORTFALL_MIN_CHECKOUTS) return []
  const rate = insufficientBalanceCheckouts / completedCheckouts
  if (rate < SHORTFALL_RATE) return []
  return [
    {
      id: 'WALLET_SHORTFALLS:window',
      type: 'WALLET_SHORTFALLS',
      severity: rate >= SHORTFALL_CRITICAL_RATE ? 'CRITICAL' : 'WARNING',
      title: 'Many guardians cannot cover their fees',
      detail: `${insufficientBalanceCheckouts} of ${completedCheckouts} check-outs in the last 28 days (${percent(rate)}%) found the wallet short.`,
      metric: { value: percent(rate), baseline: percent(SHORTFALL_RATE) },
      entity: platform,
    },
  ]
}

const detectRoomDemand = ({ rooms }: InsightMetrics): Anomaly[] =>
  rooms.flatMap((room): Anomaly[] => {
    if (room.capacity <= 0 || room.sessions.length < ROOM_HISTORY_SESSIONS) return []
    const occupancy = room.sessions.map(({ booked }) => booked / room.capacity)
    const average = occupancy.reduce((sum, value) => sum + value, 0) / occupancy.length
    const entity = { type: 'ROOM', id: room.id, href: `/admin/rooms/${room.id}` } as const

    if (average >= ROOM_FULL_OCCUPANCY && room.waitlistPending >= ROOM_FULL_MIN_WAITLIST) {
      return [
        {
          id: `ROOM_HIGH_DEMAND:${room.id}`,
          type: 'ROOM_HIGH_DEMAND',
          severity: 'INFO',
          title: `${room.name} is always full`,
          detail: `${room.name} averaged ${percent(average)}% full over its last ${ROOM_HISTORY_SESSIONS} sessions and has ${plural(room.waitlistPending, 'guardian')} waiting.`,
          metric: { value: percent(average), baseline: percent(ROOM_FULL_OCCUPANCY) },
          entity,
        } satisfies Anomaly,
      ]
    }

    // Judged only when the room is old enough to have run all of its recent sessions.
    const lowForWholeWindow = occupancy.every((value) => value < ROOM_LOW_OCCUPANCY)
    if (lowForWholeWindow && room.ageDays >= ROOM_HISTORY_SESSIONS * 7) {
      return [
        {
          id: `ROOM_LOW_OCCUPANCY:${room.id}`,
          type: 'ROOM_LOW_OCCUPANCY',
          severity: 'WARNING',
          title: `${room.name} is mostly empty`,
          detail: `${room.name} stayed under ${percent(ROOM_LOW_OCCUPANCY)}% full for its last ${ROOM_HISTORY_SESSIONS} sessions (${percent(average)}% on average).`,
          metric: { value: percent(average), baseline: percent(ROOM_LOW_OCCUPANCY) },
          entity,
        } satisfies Anomaly,
      ]
    }
    return []
  })

const detectStaleVerifications = ({ pendingVerifications }: InsightMetrics): Anomaly[] =>
  pendingVerifications
    .filter(({ waitingDays }) => waitingDays > STALE_VERIFICATION_DAYS)
    .map((staff) => ({
      id: `STALE_VERIFICATION:${staff.staffId}`,
      type: 'STALE_VERIFICATION',
      severity: staff.waitingDays > STALE_VERIFICATION_WARNING_DAYS ? 'WARNING' : 'INFO',
      title: `${staff.name} is still waiting for verification`,
      detail: `${staff.name} has been waiting ${plural(staff.waitingDays, 'day')} for an admin to review their documents.`,
      metric: { value: staff.waitingDays, baseline: STALE_VERIFICATION_DAYS },
      entity: { type: 'STAFF', id: staff.staffId, href: `/admin/staff/${staff.staffId}` },
    }))

// Most severe first; within a severity the id keeps the order stable between runs.
export const detectAnomalies = (metrics: InsightMetrics): Anomaly[] =>
  [
    ...detectCancellationSpike(metrics),
    ...detectRepeatCancellers(metrics),
    ...detectStaffRatingDrops(metrics),
    ...detectRevenueDrop(metrics),
    ...detectWalletShortfalls(metrics),
    ...detectRoomDemand(metrics),
    ...detectStaleVerifications(metrics),
  ].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  )
