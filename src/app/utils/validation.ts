import { z } from 'zod'

// For any `/:id` route: parse req.params with this so a malformed id is a 400, not a DB miss.
export const idParamSchema = z.object({ id: z.uuid('Id must be a valid UUID') })

// Body schema for PATCH endpoints. A plain z.object silently drops fields it doesn't know, so a
// request that only sends a field the caller may not edit (e.g. staff sending `hourlyRate`) turns
// into `{}` and fails with a misleading "provide at least one field". Rejecting unknown fields by
// name tells the caller what is wrong. `hint` says what they can edit or where to go instead.
export const updateBodySchema = <T extends z.ZodRawShape>(shape: T, hint?: string) =>
  z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Cannot update: ${issue.keys.join(', ')}${hint ? `. ${hint}` : ''}`
        : undefined,
  })

// For PATCH bodies: `.refine(...atLeastOneField)` rejects an empty update.
export const atLeastOneField = [
  (value: object) => Object.values(value).some((field) => field !== undefined),
  {
    message: 'Provide at least one field to update',
    // Skipped when the body already has a rejected field: that error says what's wrong.
    when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
  },
] as const
