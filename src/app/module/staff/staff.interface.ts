import { z } from 'zod'
import { DayOfWeek, TransportStatus } from '../../../generated/prisma/enums'
import { paginationQueryShape } from '../../utils/pagination'
import { atLeastOneField, updateBodySchema } from '../../utils/validation'

export const MAX_EXPERIENCE_YEARS = 60

export const experienceSchema = z
  .number()
  .int('Experience must be a whole number of years')
  .min(0)
  .max(MAX_EXPERIENCE_YEARS)

// Staff edit only their own presentation fields. Type, rates and verification are admin-managed
// because they drive fares and who is allowed to run rooms.
export const updateMyStaffSchema = updateBodySchema(
  {
    name: z.string().trim().min(1, 'Name cannot be empty').optional(),
    bio: z.string().trim().min(1, 'Bio cannot be empty').nullable().optional(),
    experience: experienceSchema.optional(),
  },
  'Staff can only update name, bio and experience. Staff type and rates are set by an admin',
).refine(...atLeastOneField)

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const END_AFTER_START_MESSAGE = 'End time must be after start time'

const timeSchema = (label: string) =>
  z.string().regex(TIME_PATTERN, `${label} must be 24h HH:mm, e.g. 09:30`)

const slotFields = {
  dayOfWeek: z.enum(DayOfWeek, {
    error: `Day of week must be one of: ${Object.values(DayOfWeek).join(', ')}`,
  }),
  startTime: timeSchema('Start time'),
  endTime: timeSchema('End time'),
}

// "HH:mm" strings compare correctly as plain strings, so no date parsing is needed.
export const isEndAfterStart = ({ startTime, endTime }: { startTime: string; endTime: string }) =>
  endTime > startTime

export const createSlotSchema = z
  .object(slotFields)
  .refine(isEndAfterStart, { message: END_AFTER_START_MESSAGE, path: ['endTime'] })

// The start/end order can't be checked here when only one side is sent: the service checks the
// merged result against the stored slot.
export const updateSlotSchema = updateBodySchema(
  slotFields,
  'You can only update dayOfWeek, startTime and endTime',
)
  .partial()
  .refine(...atLeastOneField)

export const listMyBookingsQuerySchema = z.object({
  ...paginationQueryShape,
  // Only bookings on this calendar day (YYYY-MM-DD).
  date: z.coerce.date({ error: 'Date must be a valid date, e.g. 2026-09-21' }).optional(),
})

export const listMyTripsQuerySchema = z.object({
  ...paginationQueryShape,
  status: z.enum(TransportStatus).optional(),
})

export const earningsQuerySchema = z
  .object({
    from: z.coerce.date({ error: 'From must be a valid date' }).optional(),
    to: z.coerce.date({ error: 'To must be a valid date' }).optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    message: 'From must not be after to',
    path: ['from'],
  })

export type UpdateMyStaffPayload = z.infer<typeof updateMyStaffSchema>
export type ListMyBookingsQuery = z.infer<typeof listMyBookingsQuerySchema>
export type ListMyTripsQuery = z.infer<typeof listMyTripsQuerySchema>
export type EarningsQuery = z.infer<typeof earningsQuerySchema>
export type CreateSlotPayload = z.infer<typeof createSlotSchema>
export type UpdateSlotPayload = z.infer<typeof updateSlotSchema>
