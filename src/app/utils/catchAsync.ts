import type { NextFunction, Request, RequestHandler, Response } from 'express'

// Wraps an async route handler so a rejected promise reaches globalErrorHandler.
export const catchAsync = (fn: RequestHandler): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
