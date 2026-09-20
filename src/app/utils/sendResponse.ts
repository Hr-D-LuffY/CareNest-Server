import type { Response } from 'express'

export interface PaginationMeta {
  page: number
  limit: number
  total: number
}

interface SendResponseOptions<T> {
  statusCode: number
  message: string
  data: T
  meta?: PaginationMeta
}

// The only place a success envelope is built: { success, message, data, meta? }
// The status code goes on the HTTP response itself, not into the body (assignment spec).
export const sendResponse = <T>(res: Response, options: SendResponseOptions<T>) => {
  const { statusCode, message, data, meta } = options

  res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta && { meta }),
  })
}
