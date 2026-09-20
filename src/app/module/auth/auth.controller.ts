import type { CookieOptions } from 'express'
import httpStatus from 'http-status'
import { config } from '../../config'
import { catchAsync } from '../../utils/catchAsync'
import { getTokenTtlMs } from '../../utils/jwt'
import { sendResponse } from '../../utils/sendResponse'
import { loginSchema, registerSchema } from './auth.interface'
import { AuthService } from './auth.service'

const ACCESS_TOKEN_COOKIE = 'accessToken'
const REFRESH_TOKEN_COOKIE = 'refreshToken'

const cookieOptions = (token: string): CookieOptions => ({
  httpOnly: true,
  secure: !config.isDevelopment,
  sameSite: config.isDevelopment ? 'lax' : 'none',
  maxAge: getTokenTtlMs(token),
})

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

  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, cookieOptions(accessToken))
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, cookieOptions(refreshToken))

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Logged in successfully',
    data: { accessToken, refreshToken, user },
  })
})

export const AuthController = { register, login }
