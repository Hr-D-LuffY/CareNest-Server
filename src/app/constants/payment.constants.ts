export const TOP_UP_MIN_AMOUNT = 10
export const TOP_UP_MAX_AMOUNT = 25000
export const PAYMENT_CURRENCY = 'BDT'

// bKash Tokenized Checkout: `mode 0011` is checkout with a redirect, `intent sale` charges at once.
export const BKASH_CHECKOUT_MODE = '0011'
export const BKASH_INTENT = 'sale'
export const BKASH_SUCCESS_CODE = '0000'
export const BKASH_REQUEST_TIMEOUT_MS = 15_000
// Refresh the cached id_token this long before bKash says it expires.
export const BKASH_TOKEN_EXPIRY_BUFFER_MS = 60_000
export const BKASH_NOT_CONFIGURED_MESSAGE = 'bKash payments are not configured on this server'
export const BKASH_STATUS_COMPLETED = 'Completed'
