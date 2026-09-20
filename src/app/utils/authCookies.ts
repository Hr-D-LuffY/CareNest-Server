import type { CookieOptions, Response } from 'express'
import { config } from '../config'
import { ACCESS_TOKEN_COOKIE, getTokenTtlMs, REFRESH_TOKEN_COOKIE } from './jwt'

const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: !config.isDevelopment,
  sameSite: config.isDevelopment ? 'lax' : 'none',
}

export const setAuthCookies = (
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
) => {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...baseCookieOptions,
    maxAge: getTokenTtlMs(tokens.accessToken),
  })
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseCookieOptions,
    maxAge: getTokenTtlMs(tokens.refreshToken),
  })
}

// Options must match the ones used when setting, or browsers won't remove the cookie.
export const clearAuthCookies = (res: Response) => {
  res.clearCookie(ACCESS_TOKEN_COOKIE, baseCookieOptions)
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions)
}
