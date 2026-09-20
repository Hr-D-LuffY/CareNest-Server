import bcrypt from 'bcryptjs'
import httpStatus from 'http-status'
import { Role } from '../../../generated/prisma/enums'
import { config } from '../../config'
import { AppError } from '../../errorHelpers/AppError'
import { prisma } from '../../lib/prisma'
import { hashToken, signAccessToken, signRefreshToken } from '../../utils/jwt'
import type { LoginPayload, RegisterPayload } from './auth.interface'

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password'

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

  const tokenPayload = { userId: user.id, email: user.email, role: user.role }
  const accessToken = signAccessToken(tokenPayload)
  const refreshToken = signRefreshToken(tokenPayload)

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

export const AuthService = { registerUser, loginUser }
