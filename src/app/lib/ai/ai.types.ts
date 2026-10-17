import type { AiProviderName } from '../../config'

// The shapes every AI call uses. They follow the OpenAI chat-completions format in camelCase, which
// all three providers speak, so a conversation is just a `ChatMessage[]` we own and any provider can
// continue it. That is what lets the gateway switch provider halfway through a tool loop.

export interface ToolCall {
  id: string
  name: string
  // The raw JSON string the model produced; the caller parses and validates it against the tool's schema.
  arguments: string
  // Provider-specific data that must travel back with this call (Gemini 3's thought signature).
  // Opaque to everyone except the provider that produced it, which is named so it is never sent
  // anywhere else.
  extra?: { provider: AiProviderName; data: unknown }
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface ToolDefinition {
  name: string
  description: string
  // A JSON Schema object describing the arguments.
  parameters: Record<string, unknown>
}

export interface ChatRequest {
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  // Ask for a single JSON object as the reply (used by the admin insights narrative).
  jsonMode?: boolean
  maxTokens?: number
  temperature?: number
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatResult {
  content: string | null
  toolCalls: ToolCall[]
  usage: TokenUsage
  provider: AiProviderName
  model: string
}

export interface AiProvider {
  name: AiProviderName
  model: string
  chat: (request: ChatRequest) => Promise<ChatResult>
}
