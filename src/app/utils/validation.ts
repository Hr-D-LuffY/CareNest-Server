import { z } from 'zod'

// For any `/:id` route: parse req.params with this so a malformed id is a 400, not a DB miss.
export const idParamSchema = z.object({ id: z.uuid('Id must be a valid UUID') })
