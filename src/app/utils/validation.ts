import { z } from 'zod'

// For any `/:id` route: parse req.params with this so a malformed id is a 400, not a DB miss.
export const idParamSchema = z.object({ id: z.uuid('Id must be a valid UUID') })

// For PATCH bodies: `.refine(...atLeastOneField)` rejects an empty update.
export const atLeastOneField = [
  (value: object) => Object.values(value).some((field) => field !== undefined),
  { message: 'Provide at least one field to update' },
] as const
