import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import { listMyWaitlistQuerySchema, listRoomWaitlistQuerySchema } from './waitlist.interface'
import { WaitlistService } from './waitlist.service'

const listRoomWaitlist = catchAsync(async (req, res) => {
  const query = listRoomWaitlistQuerySchema.parse(req.query)
  const { items, meta } = await WaitlistService.listRoomWaitlist(
    getAuthUser(req),
    idParamSchema.parse(req.params).id,
    query,
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Waitlist retrieved successfully',
    data: items,
    meta,
  })
})

const listMyWaitlist = catchAsync(async (req, res) => {
  const query = listMyWaitlistQuerySchema.parse(req.query)
  const { items, meta } = await WaitlistService.listMyWaitlist(getAuthUser(req), query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Waitlist entries retrieved successfully',
    data: items,
    meta,
  })
})

export const WaitlistController = { listRoomWaitlist, listMyWaitlist }
