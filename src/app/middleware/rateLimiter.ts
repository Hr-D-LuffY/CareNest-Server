import type { NextFunction, Request, RequestHandler, Response } from 'express'
import httpStatus from 'http-status'
import { AppError } from '../errorHelpers/AppError'
import { redisIncrWithExpiry } from '../lib/redis'
import { catchAsync } from '../utils/catchAsync'

interface RateLimitOptions {
  windowSeconds: number
  max: number
  keyPrefix: string
}

const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests. Please try again later.'

// Fixed-window counter per client IP, backed by the same Redis client as the seatsLeft cache.
// Fails open when REDIS_URL isn't set or Redis is unreachable, so local dev/tests never need
// Redis running just to hit the API — same tradeoff `lib/redis.ts` already makes for caching.
//   router.use(rateLimiter(AUTH_RATE_LIMIT))
export const rateLimiter = ({ windowSeconds, max, keyPrefix }: RateLimitOptions): RequestHandler =>
  catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const key = `ratelimit:${keyPrefix}:${req.ip ?? 'unknown'}`
    const count = await redisIncrWithExpiry(key, windowSeconds)

    if (count === null) {
      next()
      return
    }

    res.setHeader('RateLimit-Limit', max)
    res.setHeader('RateLimit-Remaining', Math.max(0, max - count))

    if (count > max) {
      throw new AppError(httpStatus.TOO_MANY_REQUESTS, TOO_MANY_REQUESTS_MESSAGE)
    }

    next()
  })
