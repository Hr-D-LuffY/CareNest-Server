import { z } from 'zod'
import { atLeastOneField } from '../../utils/validation'

// Email and role are not editable here: email is the login identity and role is admin-managed.
export const updateGuardianSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty').optional(),
    phone: z.string().trim().min(1, 'Phone cannot be empty').optional(),
    address: z.string().trim().min(1, 'Address cannot be empty').nullable().optional(),
  })
  .refine(...atLeastOneField)

export type UpdateGuardianPayload = z.infer<typeof updateGuardianSchema>
