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

export const AI_PROVIDER_NAMES = ['gemini', 'groq', 'openrouter'] as const
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number]

const DEFAULT_AI_PROVIDER_ORDER = AI_PROVIDER_NAMES.join(',')
const DEFAULT_AI_REQUEST_TIMEOUT_MS = 20_000

// Every provider is called through its OpenAI-compatible chat-completions endpoint, so one client
// serves all three. The limits are what the gateway lets itself use per UTC day, kept a little under
// the free-tier quota (Gemini 3.5 Flash-Lite: 500 requests/day; Groq: 200K tokens/day; OpenRouter
// free models: 50 requests/day) so the gateway stops before the provider does. No token cap for
// Gemini or OpenRouter: their binding limit is requests.
const AI_PROVIDER_DEFAULTS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash-lite',
    dailyRequests: 450,
    dailyTokens: undefined,
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    dailyRequests: 900,
    dailyTokens: 170_000,
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    dailyRequests: 45,
    dailyTokens: undefined,
  },
} as const satisfies Record<
  AiProviderName,
  { baseUrl: string; model: string; dailyRequests: number; dailyTokens: number | undefined }
>

export interface AiProviderConfig {
  name: AiProviderName
  baseUrl: string
  apiKey: string
  model: string
  dailyRequests: number
  dailyTokens: number | undefined
}

const optionalPositiveInt = z.coerce.number().int().positive().optional()

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
    // AI providers are all optional: a provider without a key is skipped, and with no key at all the
    // AI routes answer 503 while the rest of the app boots normally.
    AI_PROVIDER_ORDER: z
      .string()
      .default(DEFAULT_AI_PROVIDER_ORDER)
      .transform((value) =>
        value
          .split(',')
          .map((name) => name.trim().toLowerCase())
          .filter(Boolean),
      )
      .pipe(
        z
          .array(
            z.enum(AI_PROVIDER_NAMES, {
              error: `AI_PROVIDER_ORDER may only list: ${AI_PROVIDER_NAMES.join(', ')}`,
            }),
          )
          .min(1, 'AI_PROVIDER_ORDER must list at least one provider'),
      ),
    AI_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULT_AI_REQUEST_TIMEOUT_MS),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL: z.string().min(1).optional(),
    GEMINI_DAILY_REQUESTS: optionalPositiveInt,
    GEMINI_DAILY_TOKENS: optionalPositiveInt,
    GROQ_API_KEY: z.string().min(1).optional(),
    GROQ_MODEL: z.string().min(1).optional(),
    GROQ_DAILY_REQUESTS: optionalPositiveInt,
    GROQ_DAILY_TOKENS: optionalPositiveInt,
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    OPENROUTER_MODEL: z.string().min(1).optional(),
    OPENROUTER_DAILY_REQUESTS: optionalPositiveInt,
    OPENROUTER_DAILY_TOKENS: optionalPositiveInt,
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

const aiKeys: Record<AiProviderName, string | undefined> = {
  gemini: env.GEMINI_API_KEY,
  groq: env.GROQ_API_KEY,
  openrouter: env.OPENROUTER_API_KEY,
}

const aiOverrides: Record<
  AiProviderName,
  { model?: string; dailyRequests?: number; dailyTokens?: number }
> = {
  gemini: {
    model: env.GEMINI_MODEL,
    dailyRequests: env.GEMINI_DAILY_REQUESTS,
    dailyTokens: env.GEMINI_DAILY_TOKENS,
  },
  groq: {
    model: env.GROQ_MODEL,
    dailyRequests: env.GROQ_DAILY_REQUESTS,
    dailyTokens: env.GROQ_DAILY_TOKENS,
  },
  openrouter: {
    model: env.OPENROUTER_MODEL,
    dailyRequests: env.OPENROUTER_DAILY_REQUESTS,
    dailyTokens: env.OPENROUTER_DAILY_TOKENS,
  },
}

// The providers that have a key, in failover order (first listed is tried first, duplicates ignored).
const aiProviders = [...new Set(env.AI_PROVIDER_ORDER)].flatMap((name): AiProviderConfig[] => {
  const apiKey = aiKeys[name]
  if (!apiKey) return []
  const defaults = AI_PROVIDER_DEFAULTS[name]
  const overrides = aiOverrides[name]
  return [
    {
      name,
      baseUrl: defaults.baseUrl,
      apiKey,
      model: overrides.model ?? defaults.model,
      dailyRequests: overrides.dailyRequests ?? defaults.dailyRequests,
      dailyTokens: overrides.dailyTokens ?? defaults.dailyTokens,
    },
  ]
})

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
  // Empty until at least one provider key is set; the AI routes turn that into a 503.
  ai: {
    providers: aiProviders,
    requestTimeoutMs: env.AI_REQUEST_TIMEOUT_MS,
  },
}
