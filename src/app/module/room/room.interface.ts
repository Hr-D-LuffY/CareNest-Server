import { z } from 'zod'
import { Tier } from '../../../generated/prisma/enums'
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

export type CreateRoomPayload = z.infer<typeof createRoomSchema>
export type UpdateRoomPayload = z.infer<typeof updateRoomSchema>
