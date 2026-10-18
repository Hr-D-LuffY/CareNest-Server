import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { chatSchema } from './ai.interface'
import { AiService } from './ai.service'

const chat = catchAsync(async (req, res) => {
  const payload = chatSchema.parse(req.body)
  const reply = await AiService.chat(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Assistant replied successfully',
    data: reply,
  })
})

export const AiController = { chat }
