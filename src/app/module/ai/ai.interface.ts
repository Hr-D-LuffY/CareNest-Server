import { z } from 'zod'

// Input caps for /ai/chat. Free-tier providers are token-limited, so a conversation is trimmed to
// the most recent turns, and a single message can't be a wall of text.
export const MAX_CHAT_MESSAGES = 10
export const MAX_CHAT_MESSAGE_LENGTH = 500
// Accepts a longer history than is used, so a client that keeps the whole thread still works.
const MAX_CHAT_HISTORY_SENT = 50

export const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        // No `system` or `tool` roles: those are ours, and letting a client send them would let it
        // rewrite the assistant's rules.
        role: z.enum(['user', 'assistant'], { error: 'Role must be user or assistant' }),
        content: z
          .string({ error: 'Message content is required' })
          .trim()
          .min(1, 'Message content is required')
          .max(
            MAX_CHAT_MESSAGE_LENGTH,
            `A message can be at most ${MAX_CHAT_MESSAGE_LENGTH} characters`,
          ),
      }),
    )
    .min(1, 'Send at least one message')
    .max(MAX_CHAT_HISTORY_SENT, `Send at most ${MAX_CHAT_HISTORY_SENT} messages`),
})

export type ChatPayload = z.infer<typeof chatSchema>

export const insightsQuerySchema = z.object({
  refresh: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

export type InsightsQuery = z.infer<typeof insightsQuerySchema>
