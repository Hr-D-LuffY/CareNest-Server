import httpStatus from 'http-status'
import { type AiProviderConfig, type AiProviderName, config } from '../../config'
import { AppError } from '../../errorHelpers/AppError'
import { redisGet, redisIncrByWithExpiry, redisIncrWithExpiry } from '../redis'
import { AiProviderError } from './ai.errors'
import type { AiProvider, ChatRequest, ChatResult } from './ai.types'
import { createOpenAiCompatibleProvider } from './openai-compatible.provider'

const BREAKER_DEFAULT_OPEN_MS = 60_000
// A Retry-After can be hours (a spent daily quota); cap it so one odd header can't park a provider all day.
const BREAKER_MAX_OPEN_MS = 15 * 60_000
// Counters live a little past their UTC day so a late read never sees a half-expired key.
const USAGE_COUNTER_TTL_SECONDS = 48 * 60 * 60

const NOT_CONFIGURED_MESSAGE = 'AI features are not configured on this server'
const BUSY_MESSAGE = 'The AI assistant is busy right now. Please try again in a moment.'

export interface ProviderStatus {
  name: AiProviderName
  model: string
  // False while the provider is disabled (bad key) or its circuit breaker is open.
  healthy: boolean
  usedToday: number
  dailyLimit: number
  tokensToday: number
  dailyTokenLimit: number | undefined
}

export interface AiGatewayChatOptions {
  // A last check on a provider's answer (e.g. its tool call parses, or its JSON matches the Zod
  // schema). Returning false counts as that provider failing, and the next one is tried.
  accept?: (result: ChatResult) => boolean
}

interface ProviderEntry {
  settings: AiProviderConfig
  provider: AiProvider
}

const utcDay = () => new Date().toISOString().slice(0, 10)
const usageKey = (name: AiProviderName, counter: 'requests' | 'tokens') =>
  `ai:usage:${name}:${utcDay()}:${counter}`

// Counters are best-effort: with no Redis (or an unreachable one) every read is 0, so the budget
// fails open and only the providers' own limits apply.
const readCounter = async (key: string) => Number(await redisGet(key)) || 0

export const createAiGateway = (providerConfigs: AiProviderConfig[], requestTimeoutMs: number) => {
  const entries: ProviderEntry[] = providerConfigs.map((settings) => ({
    settings,
    provider: createOpenAiCompatibleProvider(settings, requestTimeoutMs),
  }))

  // A rejected key (401/403) switches the provider off until the process restarts.
  const disabled = new Set<AiProviderName>()
  // name → timestamp until which the provider is skipped after a failure.
  const openUntil = new Map<AiProviderName, number>()

  const isAvailable = ({ settings }: ProviderEntry) =>
    !disabled.has(settings.name) && (openUntil.get(settings.name) ?? 0) <= Date.now()

  const isOverBudget = async ({ settings }: ProviderEntry) => {
    const requests = await readCounter(usageKey(settings.name, 'requests'))
    if (requests >= settings.dailyRequests) return true
    if (settings.dailyTokens === undefined) return false
    return (await readCounter(usageKey(settings.name, 'tokens'))) >= settings.dailyTokens
  }

  const recordFailure = ({ settings }: ProviderEntry, error: AiProviderError) => {
    if (error.kind === 'auth') {
      disabled.add(settings.name)
      console.warn(`AI provider ${settings.name} disabled until restart: ${error.message}`)
      return
    }
    const openMs = Math.min(error.retryAfterMs ?? BREAKER_DEFAULT_OPEN_MS, BREAKER_MAX_OPEN_MS)
    openUntil.set(settings.name, Date.now() + openMs)
    console.warn(
      `AI provider ${settings.name} skipped for ${Math.round(openMs / 1000)}s: ${error.message}`,
    )
  }

  const chat = async (
    request: ChatRequest,
    { accept }: AiGatewayChatOptions = {},
  ): Promise<ChatResult> => {
    if (entries.length === 0) {
      throw new AppError(httpStatus.SERVICE_UNAVAILABLE, NOT_CONFIGURED_MESSAGE)
    }

    for (const entry of entries) {
      const { name } = entry.settings
      if (!isAvailable(entry) || (await isOverBudget(entry))) continue

      // Counted before the call: a request that fails still spends the provider's quota.
      await redisIncrWithExpiry(usageKey(name, 'requests'), USAGE_COUNTER_TTL_SECONDS)

      try {
        const result = await entry.provider.chat(request)
        if (result.usage.totalTokens > 0) {
          await redisIncrByWithExpiry(
            usageKey(name, 'tokens'),
            result.usage.totalTokens,
            USAGE_COUNTER_TTL_SECONDS,
          )
        }
        if (accept && !accept(result)) {
          console.warn(
            `AI provider ${name} gave an answer that failed validation, trying the next one`,
          )
          continue
        }
        return result
      } catch (error) {
        if (!(error instanceof AiProviderError)) throw error
        if (!error.shouldFailOver) {
          // Our request is wrong, and would be wrong everywhere: surface it instead of hiding it.
          console.error(`AI request rejected by ${name}: ${error.message}`)
          throw new AppError(httpStatus.BAD_GATEWAY, 'The AI service rejected the request')
        }
        recordFailure(entry, error)
      }
    }

    throw new AppError(httpStatus.SERVICE_UNAVAILABLE, BUSY_MESSAGE)
  }

  const getStatus = async (): Promise<ProviderStatus[]> =>
    Promise.all(
      entries.map(async (entry) => {
        const { name, model, dailyRequests, dailyTokens } = entry.settings
        return {
          name,
          model,
          healthy: isAvailable(entry),
          usedToday: await readCounter(usageKey(name, 'requests')),
          dailyLimit: dailyRequests,
          tokensToday: await readCounter(usageKey(name, 'tokens')),
          dailyTokenLimit: dailyTokens,
        }
      }),
    )

  return { chat, getStatus }
}

export const aiGateway = createAiGateway(config.ai.providers, config.ai.requestTimeoutMs)
