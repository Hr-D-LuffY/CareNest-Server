import httpStatus from 'http-status'
import { z } from 'zod'
import { config } from '../config'
import { AppError } from '../errorHelpers/AppError'

// bKash Tokenized Checkout: `mode 0011` is checkout with a redirect, `intent sale` charges at once.
const BKASH_CHECKOUT_MODE = '0011'
const BKASH_INTENT = 'sale'
const BKASH_SUCCESS_CODE = '0000'
const BKASH_REQUEST_TIMEOUT_MS = 15_000
// Refresh the cached id_token this long before bKash says it expires.
const BKASH_TOKEN_EXPIRY_BUFFER_MS = 60_000
const BKASH_NOT_CONFIGURED_MESSAGE = 'bKash payments are not configured on this server'
// Exported: payment.service.ts also needs it when creating the Payment row and won't duplicate it.
export const PAYMENT_CURRENCY = 'BDT'

const grantTokenResponseSchema = z.object({
  id_token: z.string().min(1),
  expires_in: z.coerce.number().positive(),
})

const createPaymentResponseSchema = z.object({
  paymentID: z.string().min(1),
  bkashURL: z.url(),
})

const errorCodeSchema = z.object({ statusCode: z.string() })

const getCredentials = () => {
  if (!config.bkash) {
    throw new AppError(httpStatus.SERVICE_UNAVAILABLE, BKASH_NOT_CONFIGURED_MESSAGE)
  }
  return config.bkash
}

// bKash reports failures as HTTP 200 with a non-"0000" statusCode, so both the HTTP status and the
// body code are checked. The gateway's own message is only logged in development, never returned.
const post = async (path: string, headers: Record<string, string>, body: object) => {
  const { baseUrl } = getCredentials()
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BKASH_REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (config.isDevelopment) console.error('bKash request failed', path, error)
    throw new AppError(httpStatus.BAD_GATEWAY, 'Could not reach bKash, please try again')
  }

  const payload: unknown = await response.json().catch(() => null)
  // Grant Token carries no statusCode on success, so only an explicit non-success code is an error.
  const code = errorCodeSchema.safeParse(payload)
  const rejected = code.success && code.data.statusCode !== BKASH_SUCCESS_CODE
  if (!response.ok || rejected) {
    if (config.isDevelopment) console.error('bKash rejected request', path, payload)
    throw new AppError(httpStatus.BAD_GATEWAY, 'bKash could not process the request')
  }
  return payload
}

let cachedToken: { idToken: string; expiresAt: number } | null = null

// The id_token lives an hour; reusing it avoids a grant call on every top-up. It stays in memory
// only, never in the database, a log line or a response.
const getIdToken = async () => {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.idToken

  const { appKey, appSecret, username, password } = getCredentials()
  const payload = await post(
    '/tokenized/checkout/token/grant',
    { username, password },
    { app_key: appKey, app_secret: appSecret },
  )
  const parsed = grantTokenResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'bKash returned an unexpected token response')
  }

  cachedToken = {
    idToken: parsed.data.id_token,
    expiresAt: Date.now() + parsed.data.expires_in * 1000 - BKASH_TOKEN_EXPIRY_BUFFER_MS,
  }
  return cachedToken.idToken
}

export const createBkashPayment = async ({
  amount,
  invoiceNumber,
  payerReference,
}: {
  amount: string
  invoiceNumber: string
  payerReference: string
}) => {
  const { appKey, callbackUrl } = getCredentials()
  const payload = await post(
    '/tokenized/checkout/create',
    { Authorization: await getIdToken(), 'X-APP-Key': appKey },
    {
      mode: BKASH_CHECKOUT_MODE,
      payerReference,
      callbackURL: callbackUrl,
      amount,
      currency: PAYMENT_CURRENCY,
      intent: BKASH_INTENT,
      merchantInvoiceNumber: invoiceNumber,
    },
  )
  const parsed = createPaymentResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'bKash returned an unexpected payment response')
  }
  return { paymentId: parsed.data.paymentID, checkoutUrl: parsed.data.bkashURL }
}

// Execute Payment returns `merchantInvoiceNumber`, Query Payment returns `merchantInvoice`.
const paymentDetailsSchema = z.object({
  trxID: z.string().min(1).optional(),
  transactionStatus: z.string(),
  amount: z.string().min(1),
  currency: z.string().optional(),
  merchantInvoiceNumber: z.string().optional(),
  merchantInvoice: z.string().optional(),
})

const toPaymentDetails = (payload: unknown) => {
  const parsed = paymentDetailsSchema.safeParse(payload)
  if (!parsed.success) {
    throw new AppError(httpStatus.BAD_GATEWAY, 'bKash returned an unexpected payment status')
  }
  const { trxID, merchantInvoiceNumber, merchantInvoice, ...rest } = parsed.data
  return {
    ...rest,
    trxId: trxID,
    invoiceNumber: merchantInvoiceNumber ?? merchantInvoice,
  }
}

const authorizedPost = async (path: string, paymentId: string) => {
  const { appKey } = getCredentials()
  return post(
    path,
    { Authorization: await getIdToken(), 'X-APP-Key': appKey },
    { paymentID: paymentId },
  )
}

// Asks bKash to actually take the money for a checkout the guardian approved. Only its answer, not
// the redirect's `status` query, may be trusted.
export const executeBkashPayment = async (paymentId: string) =>
  toPaymentDetails(await authorizedPost('/tokenized/checkout/execute', paymentId))

// Read-only lookup, used when Execute is refused because a first callback already executed it.
export const queryBkashPayment = async (paymentId: string) =>
  toPaymentDetails(await authorizedPost('/tokenized/checkout/payment/status', paymentId))
