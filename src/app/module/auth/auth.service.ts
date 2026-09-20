import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import httpStatus from 'http-status'
import { Role } from '../../../generated/prisma/enums'
import { config } from '../../config'
import { AppError } from '../../errorHelpers/AppError'
import { prisma } from '../../lib/prisma'
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  type TokenPayload,
  verifyRefreshToken,
} from '../../utils/jwt'
import type { GoogleLoginPayload, LoginPayload, RegisterPayload } from './auth.interface'

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password'
const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid or expired refresh token'
const INVALID_GOOGLE_TOKEN_MESSAGE = 'Invalid Google token'

const googleClient = new OAuth2Client()

type SessionUser = {
  id: string
  name: string
  email: string
  role: TokenPayload['role']
  profilePhoto: string | null
}

const signTokenPair = (user: { id: string; email: string; role: TokenPayload['role'] }) => {
  const payload: TokenPayload = { userId: user.id, email: user.email, role: user.role }
  return { accessToken: signAccessToken(payload), refreshToken: signRefreshToken(payload) }
}

// verifyRefreshToken throws jsonwebtoken / Zod errors; surface any of them as a clean 401.
const verifyRefreshTokenOrThrow = (token: string) => {
  try {
    return verifyRefreshToken(token)
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE)
  }
}

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  profilePhoto: true,
  createdAt: true,
} as const

const registerUser = async (payload: RegisterPayload) => {
  const existing = await prisma.user.findUnique({
    where: { email: payload.email },
    select: { id: true },
  })
  if (existing) {
    throw new AppError(httpStatus.CONFLICT, 'An account with this email already exists')
  }

  const passwordHash = await bcrypt.hash(payload.password, config.bcryptSaltRounds)
  const { name, email, phone, address } = payload

  // User and its guardian profile are created together or not at all.
  return prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: Role.GUARDIAN,
      guardianProfile: { create: { phone, address } },
    },
    select: publicUserSelect,
  })
}

const loginUser = async ({ email, password }: LoginPayload) => {
  const user = await prisma.user.findUnique({ where: { email } })

  // Same message for unknown email, wrong password, Google-only and deleted accounts,
  // so the response never reveals which emails are registered.
  const passwordMatches =
    user?.passwordHash && !user.isDeleted
      ? await bcrypt.compare(password, user.passwordHash)
      : false
  if (!user || !passwordMatches) {
    throw new AppError(httpStatus.UNAUTHORIZED, INVALID_CREDENTIALS_MESSAGE)
  }

  return startSession(user)
}

// Shared by password and Google login: issue a token pair and store the refresh-token hash.
const startSession = async (user: SessionUser) => {
  const { accessToken, refreshToken } = signTokenPair(user)

  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash: hashToken(refreshToken) },
  })

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      profilePhoto: user.profilePhoto,
    },
  }
}

const verifyGoogleIdToken = async (idToken: string) => {
  const { clientId } = config.google
  if (!clientId) {
    throw new AppError(httpStatus.SERVICE_UNAVAILABLE, 'Google login is not configured')
  }

  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: clientId })
    const claims = ticket.getPayload()
    if (claims?.sub && claims.email) {
      return {
        googleId: claims.sub,
        email: claims.email.toLowerCase(),
        emailVerified: claims.email_verified === true,
        name: claims.name ?? claims.email,
        picture: claims.picture ?? null,
      }
    }
  } catch {
    // fall through: any verification failure is the same 401 to the caller
  }
  throw new AppError(httpStatus.UNAUTHORIZED, INVALID_GOOGLE_TOKEN_MESSAGE)
}

// Sign in with Google. Returning Google users match on googleId; an existing password account
// with the same (Google-verified) email gets the Google identity linked; anyone else becomes a
// new GUARDIAN — Google login never creates staff or admin accounts.
const googleLogin = async ({ idToken, phone, address }: GoogleLoginPayload) => {
  const google = await verifyGoogleIdToken(idToken)
  if (!google.emailVerified) {
    throw new AppError(httpStatus.UNAUTHORIZED, 'Google account email is not verified')
  }

  const byGoogleId = await prisma.user.findUnique({ where: { googleId: google.googleId } })
  const user = byGoogleId ?? (await findOrCreateByEmail(google, { phone, address }))

  if (user.isDeleted) {
    throw new AppError(httpStatus.UNAUTHORIZED, INVALID_GOOGLE_TOKEN_MESSAGE)
  }

  return startSession(user)
}

const findOrCreateByEmail = async (
  google: Awaited<ReturnType<typeof verifyGoogleIdToken>>,
  { phone, address }: Pick<GoogleLoginPayload, 'phone' | 'address'>,
) => {
  const existing = await prisma.user.findUnique({ where: { email: google.email } })
  if (existing) {
    if (existing.googleId && existing.googleId !== google.googleId) {
      throw new AppError(httpStatus.CONFLICT, 'This email is linked to a different Google account')
    }
    if (existing.isDeleted || existing.googleId) return existing
    return prisma.user.update({
      where: { id: existing.id },
      data: { googleId: google.googleId, profilePhoto: existing.profilePhoto ?? google.picture },
    })
  }

  // GuardianProfile.phone is required, so a brand-new Google user must supply it.
  if (!phone) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Phone is required to create a new account', [
      { path: 'phone', message: 'Phone is required for first-time Google sign-in' },
    ])
  }

  return prisma.user.create({
    data: {
      name: google.name,
      email: google.email,
      googleId: google.googleId,
      role: Role.GUARDIAN,
      profilePhoto: google.picture,
      guardianProfile: { create: { phone, address } },
    },
  })
}

// Rotation: every refresh issues a brand-new pair and invalidates the old refresh token.
const refreshTokens = async (token: string | undefined) => {
  if (!token) throw new AppError(httpStatus.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE)

  const payload = verifyRefreshTokenOrThrow(token)
  const user = await prisma.user.findUnique({ where: { id: payload.userId } })
  if (!user || user.isDeleted || !user.refreshTokenHash) {
    throw new AppError(httpStatus.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE)
  }

  const presentedHash = hashToken(token)
  if (user.refreshTokenHash !== presentedHash) {
    // A validly signed token that is no longer the current one was already rotated:
    // treat it as possible theft and end the session so both parties must log in again.
    await prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: null } })
    throw new AppError(httpStatus.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE)
  }

  const { accessToken, refreshToken } = signTokenPair(user)

  // Compare-and-swap on the old hash so two concurrent refreshes can't both succeed.
  const rotated = await prisma.user.updateMany({
    where: { id: user.id, refreshTokenHash: presentedHash },
    data: { refreshTokenHash: hashToken(refreshToken) },
  })
  if (rotated.count === 0) {
    throw new AppError(httpStatus.UNAUTHORIZED, INVALID_REFRESH_TOKEN_MESSAGE)
  }

  return { accessToken, refreshToken }
}

// Idempotent: a missing, expired or already-rotated token has nothing left to revoke, so
// logout still succeeds and the controller clears the cookies either way.
const logoutUser = async (token: string | undefined) => {
  if (!token) return

  let userId: string
  try {
    userId = verifyRefreshToken(token).userId
  } catch {
    return // unverifiable token cannot match a stored hash
  }

  // Only clears the session if this is still the current token, so a stale token from
  // an old device can't log out the newer session.
  await prisma.user.updateMany({
    where: { id: userId, refreshTokenHash: hashToken(token) },
    data: { refreshTokenHash: null },
  })
}

export const AuthService = { registerUser, loginUser, googleLogin, refreshTokens, logoutUser }
