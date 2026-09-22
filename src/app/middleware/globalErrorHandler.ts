import type { ErrorRequestHandler } from 'express'
import httpStatus from 'http-status'
import multer from 'multer'
import { z } from 'zod'
import { Prisma } from '../../generated/prisma/client'
import { config } from '../config'
import { AppError } from '../errorHelpers/AppError'

const PRISMA_UNIQUE_VIOLATION = 'P2002'
const PRISMA_RECORD_NOT_FOUND = 'P2025'
const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003'

interface ErrorDetail {
  path?: string
  message: string
}

interface NormalizedError {
  statusCode: number
  message: string
  errors: unknown[]
}

const fromZodError = (error: z.ZodError): NormalizedError => ({
  statusCode: httpStatus.BAD_REQUEST,
  message: 'Validation failed',
  errors: error.issues.map(
    (issue): ErrorDetail => ({ path: issue.path.join('.'), message: issue.message }),
  ),
})

const fromPrismaError = (error: Prisma.PrismaClientKnownRequestError): NormalizedError => {
  switch (error.code) {
    case PRISMA_UNIQUE_VIOLATION:
      return {
        statusCode: httpStatus.CONFLICT,
        message: 'A record with these values already exists',
        errors: [{ fields: error.meta?.target }],
      }
    case PRISMA_RECORD_NOT_FOUND:
      return { statusCode: httpStatus.NOT_FOUND, message: 'Record not found', errors: [] }
    case PRISMA_FOREIGN_KEY_VIOLATION:
      return {
        statusCode: httpStatus.BAD_REQUEST,
        message: 'Related record does not exist',
        errors: [],
      }
    default:
      return {
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: 'Database error',
        errors: [],
      }
  }
}

// Errors raised by Express itself (e.g. malformed JSON from body-parser) carry a 4xx statusCode.
const isClientHttpError = (error: unknown): error is Error & { statusCode: number } =>
  error instanceof Error &&
  'statusCode' in error &&
  typeof error.statusCode === 'number' &&
  error.statusCode >= httpStatus.BAD_REQUEST &&
  error.statusCode < httpStatus.INTERNAL_SERVER_ERROR

const normalizeError = (error: unknown): NormalizedError => {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, message: error.message, errors: error.errors }
  }
  if (error instanceof z.ZodError) {
    return fromZodError(error)
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return fromPrismaError(error)
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return { statusCode: httpStatus.BAD_REQUEST, message: 'Invalid query input', errors: [] }
  }
  if (error instanceof multer.MulterError) {
    return { statusCode: httpStatus.BAD_REQUEST, message: error.message, errors: [] }
  }
  if (isClientHttpError(error)) {
    return { statusCode: error.statusCode, message: error.message, errors: [] }
  }
  return {
    statusCode: httpStatus.INTERNAL_SERVER_ERROR,
    message: error instanceof Error ? error.message : 'Internal server error',
    errors: [],
  }
}

// The only place an error envelope is built: { success, message, errors }
// The status code goes on the HTTP response itself, and stack traces stay in the server log
// so the body always matches the assignment's error shape.
// Express identifies error middleware by its 4-argument signature, so `_next` must stay.
export const globalErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const { statusCode, message, errors } = normalizeError(error)

  if (statusCode >= httpStatus.INTERNAL_SERVER_ERROR || config.isDevelopment) {
    console.error(error)
  }

  res.status(statusCode).json({ success: false, message, errors })
}
