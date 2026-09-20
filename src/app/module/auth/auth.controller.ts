import type { Request } from 'express'
import httpStatus from 'http-status'
import { z } from 'zod'
import { clearAuthCookies, setAuthCookies } from '../../utils/authCookies'
import { catchAsync } from '../../utils/catchAsync'
import { REFRESH_TOKEN_COOKIE } from '../../utils/jwt'
import { sendResponse } from '../../utils/sendResponse'
import {
  googleLoginSchema,
  loginSchema,
  refreshTokenBodySchema,
  registerSchema,
} from './auth.interface'
import { AuthService } from './auth.service'

// Cookie first (browsers), request body second (Postman / mobile clients).
const getRefreshToken = (req: Request): string | undefined => {
  const fromCookie = z.string().optional().parse(req.cookies?.[REFRESH_TOKEN_COOKIE])
  return fromCookie ?? refreshTokenBodySchema.parse(req.body ?? {}).refreshToken
}

const register = catchAsync(async (req, res) => {
  const payload = registerSchema.parse(req.body)
  const user = await AuthService.registerUser(payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Account registered successfully',
    data: user,
  })
})

const login = catchAsync(async (req, res) => {
  const payload = loginSchema.parse(req.body)
  const { accessToken, refreshToken, user } = await AuthService.loginUser(payload)

  setAuthCookies(res, { accessToken, refreshToken })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Logged in successfully',
    data: { accessToken, refreshToken, user },
  })
})

const googleLogin = catchAsync(async (req, res) => {
  const payload = googleLoginSchema.parse(req.body)
  const { accessToken, refreshToken, user } = await AuthService.googleLogin(payload)

  setAuthCookies(res, { accessToken, refreshToken })

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Logged in with Google successfully',
    data: { accessToken, refreshToken, user },
  })
})

const refreshToken = catchAsync(async (req, res) => {
  const tokens = await AuthService.refreshTokens(getRefreshToken(req))

  setAuthCookies(res, tokens)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Token refreshed successfully',
    data: tokens,
  })
})

const logout = catchAsync(async (req, res) => {
  await AuthService.logoutUser(getRefreshToken(req))

  clearAuthCookies(res)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Logged out successfully',
    data: null,
  })
})

export const AuthController = { register, login, googleLogin, refreshToken, logout }
