import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { listTransactionsQuerySchema } from './wallet.interface'
import { WalletService } from './wallet.service'

const listMyTransactions = catchAsync(async (req, res) => {
  const query = listTransactionsQuerySchema.parse(req.query)
  const { items, meta } = await WalletService.listMyTransactions(getAuthUser(req), query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Wallet transactions retrieved successfully',
    data: items,
    meta,
  })
})

export const WalletController = { listMyTransactions }
