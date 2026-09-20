import { z } from 'zod'
import { atLeastOneField } from '../../utils/validation'

export const MAX_EXPERIENCE_YEARS = 60

export const experienceSchema = z
  .number()
  .int('Experience must be a whole number of years')
  .min(0)
  .max(MAX_EXPERIENCE_YEARS)

// Staff edit only their own presentation fields. Type, rates and verification are admin-managed
// because they drive fares and who is allowed to run rooms.
export const updateMyStaffSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty').optional(),
    bio: z.string().trim().min(1, 'Bio cannot be empty').nullable().optional(),
    experience: experienceSchema.optional(),
  })
  .refine(...atLeastOneField)

export type UpdateMyStaffPayload = z.infer<typeof updateMyStaffSchema>
