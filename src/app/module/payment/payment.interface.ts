import { z } from 'zod'

const TOP_UP_MIN_AMOUNT = 10
const TOP_UP_MAX_AMOUNT = 25000
const CENTS = 100
// 10.15 * 100 is 1014.9999999999999 in floating point; rounding to this many places absorbs that.
const FLOAT_TOLERANCE_DIGITS = 6

export const topUpSchema = z.object({
  amount: z
    .number({ error: 'Amount must be a number' })
    .min(TOP_UP_MIN_AMOUNT, `Minimum top-up is ${TOP_UP_MIN_AMOUNT} BDT`)
    .max(TOP_UP_MAX_AMOUNT, `Maximum top-up is ${TOP_UP_MAX_AMOUNT} BDT`)
    .refine((value) => Number.isInteger(Number((value * CENTS).toFixed(FLOAT_TOLERANCE_DIGITS))), {
      message: 'Amount can have at most 2 decimal places',
    }),
})

export type TopUpPayload = z.infer<typeof topUpSchema>

// What bKash appends to our callback URL after the guardian finishes (or abandons) checkout.
export const BKASH_CALLBACK_STATUSES = ['success', 'failure', 'cancel'] as const

export const bkashCallbackQuerySchema = z.object({
  paymentID: z.string().min(1, 'paymentID is required'),
  status: z.enum(BKASH_CALLBACK_STATUSES, { error: 'Unknown payment status' }),
})

export type BkashCallbackQuery = z.infer<typeof bkashCallbackQuerySchema>
