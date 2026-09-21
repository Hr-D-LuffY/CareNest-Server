import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { topUpSchema } from './payment.interface'
import { PaymentService } from './payment.service'

const initiateTopUp = catchAsync(async (req, res) => {
  const payload = topUpSchema.parse(req.body)
  const result = await PaymentService.initiateTopUp(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'bKash payment created, redirect the guardian to checkoutUrl',
    data: result,
  })
})

export const PaymentController = { initiateTopUp }
