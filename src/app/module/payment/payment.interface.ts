import { z } from 'zod'
import { TOP_UP_MAX_AMOUNT, TOP_UP_MIN_AMOUNT } from '../../constants/payment.constants'

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
