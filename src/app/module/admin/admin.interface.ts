import { z } from 'zod'
import { StaffType, VerificationStatus } from '../../../generated/prisma/enums'
import { paginationQueryShape } from '../../utils/pagination'
import { atLeastOneField } from '../../utils/validation'
import { passwordSchema } from '../auth/auth.interface'
import { experienceSchema } from '../staff/staff.interface'

const MAX_RATE = 1_000_000 // stays inside the Decimal(10, 2) column

const rateSchema = z
  .number()
  .positive('Rate must be greater than 0')
  .max(MAX_RATE, `Rate must be at most ${MAX_RATE}`)

const staffTypeSchema = z.enum(StaffType, {
  error: `Staff type must be one of: ${Object.values(StaffType).join(', ')}`,
})

// Admin creates the account and sets the first password; the staff member logs in through the
// normal POST /auth/login. Rates required per type are checked in the service.
export const createStaffSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.email('A valid email is required').toLowerCase(),
  password: passwordSchema,
  staffType: staffTypeSchema,
  bio: z.string().trim().min(1).nullable().optional(),
  experience: experienceSchema.default(0),
  hourlyRate: rateSchema.optional(),
  perMinuteRate: rateSchema.optional(),
})

// Email is the login identity and verification has its own workflow, so neither is editable here.
export const updateStaffSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty'),
    staffType: staffTypeSchema,
    bio: z.string().trim().min(1).nullable(),
    experience: experienceSchema,
    hourlyRate: rateSchema.nullable(),
    perMinuteRate: rateSchema.nullable(),
  })
  .partial()
  .refine(...atLeastOneField)

export const listStaffQuerySchema = z.object({
  ...paginationQueryShape,
  staffType: z.enum(StaffType).optional(),
  verificationStatus: z.enum(VerificationStatus).optional(),
  search: z.string().trim().min(1).optional(),
})

export type CreateStaffPayload = z.infer<typeof createStaffSchema>
export type UpdateStaffPayload = z.infer<typeof updateStaffSchema>
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>
