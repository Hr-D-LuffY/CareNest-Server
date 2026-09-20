import type { Request } from 'express'
import httpStatus from 'http-status'
import { AppError } from '../errorHelpers/AppError'
import type { TokenPayload } from './jwt'

// req.user is optional on the Request type; auth() always sets it before a guarded handler runs.
// This narrows it once, so controllers never need a non-null assertion.
export const getAuthUser = (req: Request): TokenPayload => {
  if (!req.user) throw new AppError(httpStatus.UNAUTHORIZED, 'You are not authorized')
  return req.user
}
