import type { Request, RequestHandler } from 'express'
import httpStatus from 'http-status'
import type { Role } from '../../generated/prisma/enums'
import { AppError } from '../errorHelpers/AppError'
import { prisma } from '../lib/prisma'
import { catchAsync } from '../utils/catchAsync'
import { ACCESS_TOKEN_COOKIE, verifyAccessToken } from '../utils/jwt'

const BEARER_PREFIX = 'Bearer '
const UNAUTHORIZED_MESSAGE = 'You are not authorized. Please log in again'
const FORBIDDEN_MESSAGE = 'You do not have permission to access this resource'

// Authorization header first (API clients), httpOnly cookie second (browsers).
const extractAccessToken = (req: Request): string | undefined => {
  const header = req.headers.authorization
  if (header?.startsWith(BEARER_PREFIX)) {
    return header.slice(BEARER_PREFIX.length).trim() || undefined
  }
  const fromCookie: unknown = req.cookies?.[ACCESS_TOKEN_COOKIE]
  return typeof fromCookie === 'string' && fromCookie ? fromCookie : undefined
}

// JWT + role guard. Pass the allowed roles; pass none to allow any logged-in user.
//   router.get('/x', auth(Role.ADMIN), Controller.x)
export const auth = (...roles: Role[]): RequestHandler =>
  catchAsync(async (req, _res, next) => {
    const token = extractAccessToken(req)
    if (!token) throw new AppError(httpStatus.UNAUTHORIZED, UNAUTHORIZED_MESSAGE)

    let userId: string
    try {
      userId = verifyAccessToken(token).userId
    } catch {
      throw new AppError(httpStatus.UNAUTHORIZED, UNAUTHORIZED_MESSAGE)
    }

    // Always re-read the user: a soft-deleted account or a changed role must take effect
    // immediately, not when the (still validly signed) token expires.
    const user = await prisma.user.findFirst({
      where: { id: userId, isDeleted: false },
      select: { id: true, email: true, role: true },
    })
    if (!user) throw new AppError(httpStatus.UNAUTHORIZED, UNAUTHORIZED_MESSAGE)

    if (roles.length > 0 && !roles.includes(user.role)) {
      throw new AppError(httpStatus.FORBIDDEN, FORBIDDEN_MESSAGE)
    }

    req.user = { userId: user.id, email: user.email, role: user.role }
    next()
  })
