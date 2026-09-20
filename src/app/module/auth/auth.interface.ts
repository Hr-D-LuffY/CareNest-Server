import { z } from 'zod'
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 72 // bcrypt ignores bytes past 72

const baseFields = {
  name: z.string().trim().min(1, 'Name is required'),
  email: z.email('A valid email is required').toLowerCase(),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`),
}

// Public registration is Guardian-only. There is no `role` field on purpose: staff accounts
// are created by an Admin (admin module) and admin accounts are seeded.
export const registerSchema = z.object({
  ...baseFields,
  phone: z.string().trim().min(1, 'Phone is required'),
  address: z.string().trim().min(1).optional(),
})

export const loginSchema = z.object({
  email: z.email('A valid email is required').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
})

// The refresh token normally arrives as an httpOnly cookie; the body is the fallback for
// non-browser clients (e.g. Postman, mobile).
export const refreshTokenBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
})

export type RegisterPayload = z.infer<typeof registerSchema>
export type LoginPayload = z.infer<typeof loginSchema>
