import { z } from 'zod'

// Email and role are not editable here: email is the login identity and role is admin-managed.
export const updateGuardianSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty').optional(),
    phone: z.string().trim().min(1, 'Phone cannot be empty').optional(),
    address: z.string().trim().min(1, 'Address cannot be empty').nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  })

export type UpdateGuardianPayload = z.infer<typeof updateGuardianSchema>
