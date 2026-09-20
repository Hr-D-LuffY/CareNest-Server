import { z } from 'zod'
import type { PaginationMeta } from './sendResponse'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100

// Spread into any list endpoint's query schema: z.object({ ...paginationQueryShape, tier: ... })
export const paginationQueryShape = {
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
}

export const getPagination = ({ page, limit }: { page: number; limit: number }) => ({
  skip: (page - 1) * limit,
  take: limit,
})

export const buildMeta = (
  { page, limit }: { page: number; limit: number },
  total: number,
): PaginationMeta => ({ page, limit, total })
