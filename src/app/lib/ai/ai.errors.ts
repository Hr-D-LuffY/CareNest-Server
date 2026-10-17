import type { AiProviderName } from '../../config'

// Why a provider call failed, in the terms the gateway cares about.
//   timeout / network      the call never got an answer
//   rate_limited           429, or 413 (Groq answers 413 when a request exceeds its tokens-per-minute cap)
//   server                 5xx or 408
//   not_found              404: usually a model that is retired or has no free endpoint right now
//   auth                   401 / 403: the key is wrong, revoked or not allowed this model
//   invalid_response       200, but the body is unusable (no choices, broken shape)
//   bad_request            400 / 422: our request is wrong. A bug to surface, never to paper over
export type AiFailureKind =
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'server'
  | 'not_found'
  | 'auth'
  | 'invalid_response'
  | 'bad_request'

interface AiProviderErrorOptions {
  provider: AiProviderName
  kind: AiFailureKind
  status?: number
  retryAfterMs?: number
  detail?: string
}

export class AiProviderError extends Error {
  public readonly provider: AiProviderName
  public readonly kind: AiFailureKind
  public readonly status: number | undefined
  public readonly retryAfterMs: number | undefined

  constructor({ provider, kind, status, retryAfterMs, detail }: AiProviderErrorOptions) {
    super(`${provider} ${kind}${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`)
    this.name = 'AiProviderError'
    this.provider = provider
    this.kind = kind
    this.status = status
    this.retryAfterMs = retryAfterMs
  }

  // Everything except a bad request is worth trying the next provider for. A 400 would fail the same
  // way everywhere, and hiding it behind a fallback would hide the bug.
  get shouldFailOver() {
    return this.kind !== 'bad_request'
  }
}
