import { z } from 'zod'
import { Tier } from '../../../generated/prisma/enums'
import { paginationQueryShape } from '../../utils/pagination'

const requiredText = (label: string) => z.string().trim().min(1, `${label} is required`)
const optionalText = z.string().trim().min(1).nullable().optional()

const childFields = {
  name: requiredText('Name'),
  dateOfBirth: z.coerce
    .date({ error: 'A valid date of birth is required' })
    .refine((date) => date <= new Date(), 'Date of birth cannot be in the future'),
  tier: z.enum(Tier, { error: `Tier must be one of: ${Object.values(Tier).join(', ')}` }),
  allergies: optionalText,
  conditions: optionalText,
  emergencyContactName: requiredText('Emergency contact name'),
  emergencyContactPhone: requiredText('Emergency contact phone'),
}

export const createChildSchema = z.object(childFields)

export const updateChildSchema = z
  .object(childFields)
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update',
  })

export const listChildrenQuerySchema = z.object({
  ...paginationQueryShape,
  tier: z.enum(Tier).optional(),
})

export type CreateChildPayload = z.infer<typeof createChildSchema>
export type UpdateChildPayload = z.infer<typeof updateChildSchema>
export type ListChildrenQuery = z.infer<typeof listChildrenQuerySchema>
