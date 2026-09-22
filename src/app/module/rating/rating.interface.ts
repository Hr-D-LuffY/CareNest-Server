import { z } from 'zod'
import { paginationQueryShape } from '../../utils/pagination'

export const RATING_MIN_SCORE = 1
export const RATING_MAX_SCORE = 5
export const RATING_COMMENT_MAX_LENGTH = 500

export const createRatingSchema = z.object({
  bookingId: z.uuid('Booking id must be a valid UUID'),
  staffId: z.uuid('Staff id must be a valid UUID'),
  score: z
    .number()
    .int('Score must be a whole number')
    .min(RATING_MIN_SCORE, `Score must be at least ${RATING_MIN_SCORE}`)
    .max(RATING_MAX_SCORE, `Score must be at most ${RATING_MAX_SCORE}`),
  comment: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(
      RATING_COMMENT_MAX_LENGTH,
      `Comment must be at most ${RATING_COMMENT_MAX_LENGTH} characters`,
    )
    .optional(),
})

export const listStaffRatingsQuerySchema = z.object({ ...paginationQueryShape })

export type CreateRatingPayload = z.infer<typeof createRatingSchema>
export type ListStaffRatingsQuery = z.infer<typeof listStaffRatingsQuerySchema>
