import { z } from 'zod'
import { paginationQueryShape } from '../../utils/pagination'

export const listRoomWaitlistQuerySchema = z.object({
  ...paginationQueryShape,
  // Only the queue for this session date (YYYY-MM-DD); without it, every date's queue.
  date: z.coerce.date({ error: 'Date must be a valid date, e.g. 2026-09-21' }).optional(),
})

export type ListRoomWaitlistQuery = z.infer<typeof listRoomWaitlistQuerySchema>
