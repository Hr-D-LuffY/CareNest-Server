export class AppError extends Error {
  public readonly statusCode: number
  public readonly errors: unknown[]

  constructor(statusCode: number, message: string, errors: unknown[] = []) {
    super(message)
    this.name = 'AppError'
    this.statusCode = statusCode
    this.errors = errors
    Error.captureStackTrace(this, this.constructor)
  }
}
