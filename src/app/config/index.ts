import 'dotenv/config'
import { z } from 'zod'

const DEFAULT_PORT = 5000
const DEFAULT_BCRYPT_SALT_ROUNDS = 10
const MIN_SECRET_LENGTH = 32

const secret = (name: string) =>
  z.string().min(MIN_SECRET_LENGTH, `${name} must be at least ${MIN_SECRET_LENGTH} characters`)

const BKASH_VARS = [
  'BKASH_BASE_URL',
  'BKASH_APP_KEY',
  'BKASH_APP_SECRET',
  'BKASH_USERNAME',
  'BKASH_PASSWORD',
  'BKASH_CALLBACK_URL',
] as const

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().positive().default(DEFAULT_BCRYPT_SALT_ROUNDS),
    FRONTEND_URL: z.url('FRONTEND_URL must be a valid URL'),
    REDIS_URL: z.string().optional(),
    BKASH_BASE_URL: z.url('BKASH_BASE_URL must be a valid URL').optional(),
    BKASH_APP_KEY: z.string().min(1).optional(),
    BKASH_APP_SECRET: z.string().min(1).optional(),
    BKASH_USERNAME: z.string().min(1).optional(),
    BKASH_PASSWORD: z.string().min(1).optional(),
    BKASH_CALLBACK_URL: z.url('BKASH_CALLBACK_URL must be a valid URL').optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    CLOUDINARY_URL: z.string().url('CLOUDINARY_URL must be a valid URL'),
  })
  .superRefine((env, ctx) => {
    // bKash is all-or-nothing: a half-filled set fails at boot, not at the first top-up. Only
    // production insists on it, so local work without a sandbox account still starts.
    const missing = BKASH_VARS.filter((name) => !env[name])
    const partlySet = missing.length > 0 && missing.length < BKASH_VARS.length
    const requiredHere = env.NODE_ENV === 'production' && missing.length > 0
    if (!partlySet && !requiredHere) return
    for (const name of missing) {
      ctx.addIssue({ code: 'custom', path: [name], message: `${name} is required for bKash` })
    }
  })

// A blank `KEY=` line in .env means "not set", so optional vars can stay empty in .env.example.
const rawEnv = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''))
const parsed = envSchema.safeParse(rawEnv)

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  console.error(`Invalid environment configuration:\n${problems}`)
  process.exit(1)
}

const env = parsed.data

export const config = {
  nodeEnv: env.NODE_ENV,
  isDevelopment: env.NODE_ENV === 'development',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },
  bcryptSaltRounds: env.BCRYPT_SALT_ROUNDS,
  frontendUrl: env.FRONTEND_URL,
  redisUrl: env.REDIS_URL,
  // undefined until every BKASH_* var is set; the bKash client turns that into a 503
  bkash:
    env.BKASH_BASE_URL &&
    env.BKASH_APP_KEY &&
    env.BKASH_APP_SECRET &&
    env.BKASH_USERNAME &&
    env.BKASH_PASSWORD &&
    env.BKASH_CALLBACK_URL
      ? {
          baseUrl: env.BKASH_BASE_URL.replace(/\/$/, ''),
          appKey: env.BKASH_APP_KEY,
          appSecret: env.BKASH_APP_SECRET,
          username: env.BKASH_USERNAME,
          password: env.BKASH_PASSWORD,
          callbackUrl: env.BKASH_CALLBACK_URL,
        }
      : undefined,
  google: {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  },
  cloudinaryUrl: env.CLOUDINARY_URL,
}
