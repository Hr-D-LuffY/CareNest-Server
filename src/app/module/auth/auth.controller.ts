import type { CookieOptions, Request, Response } from 'express'
import httpStatus from 'http-status'
import { z } from 'zod'
import { config } from '../../config'
import { catchAsync } from '../../utils/catchAsync'
import { ACCESS_TOKEN_COOKIE, getTokenTtlMs, REFRESH_TOKEN_COOKIE } from '../../utils/jwt'
import { sendResponse } from '../../utils/sendResponse'
import { loginSchema, refreshTokenBodySchema, registerSchema } from './auth.interface'
import { AuthService } from './auth.service'

const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: !config.isDevelopment,
  sameSite: config.isDevelopment ? 'lax' : 'none',
}

const setAuthCookies = (res: Response, tokens: { accessToken: string; refreshToken: string }) => {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...baseCookieOptions,
    maxAge: getTokenTtlMs(tokens.accessToken),
  })
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseCookieOptions,
    maxAge: getTokenTtlMs(tokens.refreshToken),
  })
}

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

  res.clearCookie(ACCESS_TOKEN_COOKIE, baseCookieOptions)
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Logged out successfully',
    data: null,
  })
})

export const AuthController = { register, login, refreshToken, logout }
