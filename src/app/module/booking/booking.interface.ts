import { z } from 'zod'

export const createBookingSchema = z.object({
  childId: z.uuid('Child id must be a valid UUID'),
  roomId: z.uuid('Room id must be a valid UUID'),
  // The calendar day of the session. A room repeats weekly, so the date picks which occurrence.
  sessionDate: z.coerce.date({ error: 'Session date must be a valid date, e.g. 2026-09-21' }),
})

export type CreateBookingPayload = z.infer<typeof createBookingSchema>
