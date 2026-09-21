import httpStatus from 'http-status'
import { PaymentStatus } from '../../../generated/prisma/enums'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { bkashCallbackQuerySchema, topUpSchema } from './payment.interface'
import { PaymentService } from './payment.service'

const CALLBACK_OUTCOMES = {
  [PaymentStatus.SUCCESS]: { statusCode: httpStatus.OK, message: 'Wallet topped up successfully' },
  [PaymentStatus.CANCELLED]: { statusCode: httpStatus.OK, message: 'The payment was cancelled' },
  [PaymentStatus.FAILED]: {
    statusCode: httpStatus.PAYMENT_REQUIRED,
    message: 'The payment failed',
  },
  [PaymentStatus.PENDING]: { statusCode: httpStatus.ACCEPTED, message: 'The payment is pending' },
} as const

const initiateTopUp = catchAsync(async (req, res) => {
  const payload = topUpSchema.parse(req.body)
  const result = await PaymentService.initiateTopUp(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'bKash payment created, redirect the guardian to checkoutUrl',
    data: result,
  })
})

// Public on purpose: bKash redirects the guardian's browser here, so there is no token to check.
// The payment is authenticated by bKash confirming it, not by who calls this URL.
const handleBkashCallback = catchAsync(async (req, res) => {
  const query = bkashCallbackQuerySchema.parse(req.query)
  const payment = await PaymentService.handleBkashCallback(query)

  sendResponse(res, { ...CALLBACK_OUTCOMES[payment.status], data: payment })
})

export const PaymentController = { initiateTopUp, handleBkashCallback }
