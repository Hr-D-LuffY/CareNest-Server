import { z } from 'zod'
import { StaffType, VerificationStatus } from '../../../generated/prisma/enums'
import { paginationQueryShape } from '../../utils/pagination'
import { atLeastOneField, updateBodySchema } from '../../utils/validation'
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
export const updateStaffSchema = updateBodySchema(
  {
    name: z.string().trim().min(1, 'Name cannot be empty'),
    staffType: staffTypeSchema,
    bio: z.string().trim().min(1).nullable(),
    experience: experienceSchema,
    hourlyRate: rateSchema.nullable(),
    perMinuteRate: rateSchema.nullable(),
  },
  'Email cannot be changed and verification has its own endpoint',
)
  .partial()
  .refine(...atLeastOneField)

// Approve, or reject with a reason the staff member can act on. Each variant is strict so a
// stray field (e.g. a reason on an approval) is reported instead of silently dropped.
export const verifyStaffSchema = z.discriminatedUnion(
  'status',
  [
    updateBodySchema(
      { status: z.literal(VerificationStatus.VERIFIED) },
      'Only status is accepted when verifying',
    ),
    updateBodySchema(
      {
        status: z.literal(VerificationStatus.REJECTED),
        rejectionReason: z
          .string({ error: 'A rejection reason is required' })
          .trim()
          .min(1, 'A rejection reason is required'),
      },
      'Only status and rejectionReason are accepted when rejecting',
    ),
  ],
  { error: 'Status must be one of: VERIFIED, REJECTED' },
)

export const listStaffQuerySchema = z.object({
  ...paginationQueryShape,
  staffType: z.enum(StaffType).optional(),
  verificationStatus: z.enum(VerificationStatus).optional(),
  search: z.string().trim().min(1).optional(),
})

// AuditLog.entity is a free-form string (e.g. "Booking", "StaffProfile"), not an enum, so this
// filters by exact match rather than a fixed list.
export const listAuditLogsQuerySchema = z.object({
  ...paginationQueryShape,
  entity: z.string().trim().min(1).optional(),
})

export type CreateStaffPayload = z.infer<typeof createStaffSchema>
export type UpdateStaffPayload = z.infer<typeof updateStaffSchema>
export type VerifyStaffPayload = z.infer<typeof verifyStaffSchema>
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>
