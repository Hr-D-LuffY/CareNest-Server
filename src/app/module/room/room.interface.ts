import { z } from 'zod'
import { Tier } from '../../../generated/prisma/enums'
import { paginationQueryShape } from '../../utils/pagination'
import { atLeastOneField, updateBodySchema } from '../../utils/validation'
import {
  dayOfWeekSchema,
  END_AFTER_START_MESSAGE,
  isEndAfterStart,
  timeSchema,
} from '../staff/staff.interface'

export const MAX_ROOM_CAPACITY = 100
export const MAX_PRICE_MULTIPLIER = 99.99 // stays inside the Decimal(5, 2) column
export const DEFAULT_PRICE_MULTIPLIER = 1

const roomFields = {
  name: z.string().trim().min(1, 'Name is required'),
  tier: z.enum(Tier, { error: `Tier must be one of: ${Object.values(Tier).join(', ')}` }),
  capacity: z
    .number({ error: 'Capacity must be a number' })
    .int('Capacity must be a whole number')
    .min(1, 'Capacity must be at least 1')
    .max(MAX_ROOM_CAPACITY, `Capacity must be at most ${MAX_ROOM_CAPACITY}`),
  dayOfWeek: dayOfWeekSchema,
  startTime: timeSchema('Start time'),
  endTime: timeSchema('End time'),
  priceMultiplier: z
    .number({ error: 'Price multiplier must be a number' })
    .positive('Price multiplier must be greater than 0')
    .max(MAX_PRICE_MULTIPLIER, `Price multiplier must be at most ${MAX_PRICE_MULTIPLIER}`),
  staffId: z.uuid('Staff id must be a valid UUID'),
}

export const createRoomSchema = z
  .object({
    ...roomFields,
    priceMultiplier: roomFields.priceMultiplier.default(DEFAULT_PRICE_MULTIPLIER),
  })
  .refine(isEndAfterStart, { message: END_AFTER_START_MESSAGE, path: ['endTime'] })

// Start/end order can't be checked here when only one side is sent: the service checks the
// merged result against the stored room.
export const updateRoomSchema = updateBodySchema(
  roomFields,
  'You can only update name, tier, capacity, dayOfWeek, startTime, endTime, priceMultiplier and staffId',
)
  .partial()
  .refine(...atLeastOneField)

export const ROOM_STATUSES = ['AVAILABLE', 'FULL'] as const
export const ROOM_SORT_FIELDS = [
  'createdAt',
  'name',
  'startTime',
  'capacity',
  'priceMultiplier',
  'seatsLeft',
] as const

// A room repeats weekly, so its seats are counted per session date. `date` picks the day to
// check; without it every room reports its next upcoming session.
const sessionDateSchema = z.coerce.date({ error: 'Date must be a valid date, e.g. 2026-09-21' })

export const listRoomsQuerySchema = z.object({
  ...paginationQueryShape,
  tier: z
    .enum(Tier, { error: `Tier must be one of: ${Object.values(Tier).join(', ')}` })
    .optional(),
  status: z
    .enum(ROOM_STATUSES, { error: `Status must be one of: ${ROOM_STATUSES.join(', ')}` })
    .optional(),
  dayOfWeek: dayOfWeekSchema.optional(),
  date: sessionDateSchema.optional(),
  q: z.string().trim().min(1).optional(),
  sortBy: z
    .enum(ROOM_SORT_FIELDS, { error: `Sort by must be one of: ${ROOM_SORT_FIELDS.join(', ')}` })
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc'], { error: 'Sort order must be asc or desc' }).default('desc'),
})

export const searchRoomsQuerySchema = listRoomsQuerySchema.extend({
  q: z
    .string({ error: 'Search keyword q is required' })
    .trim()
    .min(1, 'Search keyword q is required'),
})

export const roomDetailQuerySchema = z.object({ date: sessionDateSchema.optional() })

export type CreateRoomPayload = z.infer<typeof createRoomSchema>
export type ListRoomsQuery = z.infer<typeof listRoomsQuerySchema>
export type RoomDetailQuery = z.infer<typeof roomDetailQuerySchema>
export type UpdateRoomPayload = z.infer<typeof updateRoomSchema>
