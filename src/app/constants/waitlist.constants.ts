import { Tier } from '../../generated/prisma/enums'

// priorityScore = (W1 x waitTimeHours) + (W2 x tierWeight) - (W3 x cancellationPenalty), SRS 4.7
export const WAITLIST_WEIGHTS = {
  waitTimeHours: 0.5,
  tier: 0.3,
  cancellationPenalty: 0.4,
} as const

export const TIER_WEIGHTS: Record<Tier, number> = {
  [Tier.MONTHLY]: 3,
  [Tier.WEEKLY]: 2,
  [Tier.DAILY]: 1,
}

// Only this many recent cancellations count against a guardian, over this many days.
export const MAX_CANCELLATION_PENALTY = 5
export const CANCELLATION_WINDOW_DAYS = 30
