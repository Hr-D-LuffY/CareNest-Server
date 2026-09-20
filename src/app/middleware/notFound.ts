import type { NextFunction, Request, Response } from 'express'
import httpStatus from 'http-status'
import { AppError } from '../errorHelpers/AppError'

// Catch-all for unmatched routes; hands a 404 to globalErrorHandler.
export const notFound = (req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(httpStatus.NOT_FOUND, `Route ${req.method} ${req.originalUrl} not found`))
}
