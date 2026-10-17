import { z } from 'zod'
import type { AiProviderConfig, AiProviderName } from '../../config'
import { AiProviderError, type AiFailureKind } from './ai.errors'
import type { AiProvider, ChatMessage, ChatRequest, ChatResult, ToolCall } from './ai.types'

const DEFAULT_MAX_TOKENS = 1024
const DEFAULT_TEMPERATURE = 0.2
const MAX_ERROR_DETAIL_LENGTH = 200
const MS_PER_SECOND = 1000

const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_REQUEST_TIMEOUT = 408
const HTTP_PAYLOAD_TOO_LARGE = 413
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR = 500

// What the three providers have in common: POST {baseUrl}/chat/completions, OpenAI shape. Parsed
// loosely on purpose, since each one adds its own extra fields (reasoning, safety ratings, ...).
const toolCallSchema = z.object({
  id: z.string().min(1).optional(),
  extra_content: z.unknown().optional(),
  function: z.object({
    name: z.string().min(1),
    arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  }),
})

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z.array(toolCallSchema).nullish(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .nullish(),
})

// OpenRouter (and sometimes others) report a failure as HTTP 200 with an `error` object in the body.
const errorBodySchema = z.object({
  error: z.object({
    message: z.string().optional(),
    code: z.union([z.number(), z.string()]).optional(),
  }),
})

type WireMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: {
        id: string
        type: 'function'
        function: { name: string; arguments: string }
        extra_content?: unknown
      }[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

// Gemini 3 answers every tool call with a signed "thought" and rejects the follow-up request (HTTP 400)
// if a function call in the history has no signature. Its own calls are sent back with their own
// signature. A call made by another provider (a conversation that failed over to Gemini halfway
// through a tool loop) has none, so it gets Google's documented skip value instead.
const GEMINI_SKIP_THOUGHT_SIGNATURE = {
  google: { thought_signature: 'skip_thought_signature_validator' },
}

const toWireExtra = (call: ToolCall, target: AiProviderName) => {
  if (call.extra?.provider === target) return call.extra.data
  return target === 'gemini' ? GEMINI_SKIP_THOUGHT_SIGNATURE : undefined
}

const toWireMessage = (message: ChatMessage, target: AiProviderName): WireMessage => {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
  if (message.role === 'assistant') {
    if (!message.toolCalls?.length) return { role: 'assistant', content: message.content ?? '' }
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((call) => {
        const extra = toWireExtra(call, target)
        return {
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
          ...(extra !== undefined && { extra_content: extra }),
        }
      }),
    }
  }
  return { role: message.role, content: message.content }
}

const classifyStatus = (status: number): AiFailureKind => {
  if (status === HTTP_TOO_MANY_REQUESTS || status === HTTP_PAYLOAD_TOO_LARGE) return 'rate_limited'
  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) return 'auth'
  if (status === HTTP_NOT_FOUND) return 'not_found'
  if (status === HTTP_REQUEST_TIMEOUT || status >= HTTP_SERVER_ERROR) return 'server'
  // 400, 422 and anything unexpected: our request is wrong.
  return 'bad_request'
}

// Retry-After is either a number of seconds or an HTTP date.
const parseRetryAfter = (header: string | null) => {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * MS_PER_SECOND
  const at = Date.parse(header)
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now())
}

// Gemini wraps its error object in an array: [{ "error": {...} }].
const unwrapErrorPayload = (payload: unknown) => (Array.isArray(payload) ? payload[0] : payload)

// A short, safe description of the provider's complaint for our logs. Never the request, so a prompt
// or a key can't end up in a log line.
const describeError = (payload: unknown) => {
  const parsed = errorBodySchema.safeParse(unwrapErrorPayload(payload))
  return parsed.success ? parsed.data.error.message?.slice(0, MAX_ERROR_DETAIL_LENGTH) : undefined
}

// Some reasoning models (Qwen on Groq, for one) put their thinking inline as <think>...</think>.
const stripThinking = (content: string) => content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

export const createOpenAiCompatibleProvider = (
  { name, baseUrl, apiKey, model }: AiProviderConfig,
  timeoutMs: number,
): AiProvider => {
  const fail = (
    kind: AiFailureKind,
    extra: { status?: number; retryAfterMs?: number; detail?: string } = {},
  ) => new AiProviderError({ provider: name, kind, ...extra })

  const chat = async ({
    messages,
    tools,
    jsonMode,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
  }: ChatRequest): Promise<ChatResult> => {
    const body = {
      model,
      messages: messages.map((message) => toWireMessage(message, name)),
      max_tokens: maxTokens,
      temperature,
      ...(tools?.length && {
        tools: tools.map(({ name: toolName, description, parameters }) => ({
          type: 'function',
          function: { name: toolName, description, parameters },
        })),
      }),
      ...(jsonMode && { response_format: { type: 'json_object' } }),
    }

    let response: Response
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      throw fail(timedOut ? 'timeout' : 'network')
    }

    const payload: unknown = await response.json().catch(() => null)

    if (!response.ok) {
      throw fail(classifyStatus(response.status), {
        status: response.status,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
        detail: describeError(payload),
      })
    }

    const parsed = completionSchema.safeParse(payload)
    if (!parsed.success) {
      const bodyError = errorBodySchema.safeParse(unwrapErrorPayload(payload))
      if (bodyError.success) {
        const code = Number(bodyError.data.error.code)
        throw fail(Number.isNaN(code) ? 'server' : classifyStatus(code), {
          status: Number.isNaN(code) ? undefined : code,
          detail: bodyError.data.error.message?.slice(0, MAX_ERROR_DETAIL_LENGTH),
        })
      }
      throw fail('invalid_response', { detail: 'unexpected response shape' })
    }

    const choice = parsed.data.choices[0]
    const message = choice?.message
    if (!message) throw fail('invalid_response', { detail: 'no choices returned' })

    const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call, index) => ({
      // Some providers leave the id out; the reply to a tool call needs one, so make a stable one.
      id: call.id ?? `call_${index}`,
      name: call.function.name,
      arguments:
        typeof call.function.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function.arguments ?? {}),
      ...(call.extra_content !== undefined && {
        extra: { provider: name, data: call.extra_content },
      }),
    }))

    const content = message.content ? stripThinking(message.content) : null
    // A reply with neither text nor a tool call is useless (a reasoning model can spend its whole
    // token budget thinking), so let the next provider have a go.
    if (!content && toolCalls.length === 0) {
      throw fail('invalid_response', { detail: 'empty reply' })
    }

    const usage = parsed.data.usage
    return {
      content: content || null,
      toolCalls,
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens:
          usage?.total_tokens ?? (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
      },
      provider: name,
      model,
    }
  }

  return { name, model, chat }
}
