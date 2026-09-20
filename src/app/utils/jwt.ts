import { createHash } from 'node:crypto'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { z } from 'zod'
import { Role } from '../../generated/prisma/enums'
import { config } from '../config'

const MS_PER_SECOND = 1000

export const tokenPayloadSchema = z.object({
  userId: z.string(),
  email: z.string(),
  role: z.enum(Role),
})

export type TokenPayload = z.infer<typeof tokenPayloadSchema>

const sign = (payload: TokenPayload, secret: string, expiresIn: string) =>
  jwt.sign(payload, secret, { expiresIn: expiresIn as SignOptions['expiresIn'] })

export const signAccessToken = (payload: TokenPayload) =>
  sign(payload, config.jwt.accessSecret, config.jwt.accessExpiresIn)

export const signRefreshToken = (payload: TokenPayload) =>
  sign(payload, config.jwt.refreshSecret, config.jwt.refreshExpiresIn)

export const verifyAccessToken = (token: string): TokenPayload =>
  tokenPayloadSchema.parse(jwt.verify(token, config.jwt.accessSecret))

export const verifyRefreshToken = (token: string): TokenPayload =>
  tokenPayloadSchema.parse(jwt.verify(token, config.jwt.refreshSecret))

// Milliseconds until a signed token expires — used as the cookie maxAge so it always
// matches the configured JWT lifetime instead of duplicating it.
export const getTokenTtlMs = (token: string): number => {
  const decoded = jwt.decode(token)
  if (!decoded || typeof decoded === 'string' || typeof decoded.exp !== 'number') return 0
  return Math.max(decoded.exp * MS_PER_SECOND - Date.now(), 0)
}

// Refresh tokens are stored hashed. SHA-256 (not bcrypt): a JWT is longer than bcrypt's
// 72-byte input limit, so bcrypt would only ever compare the shared header prefix.
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
