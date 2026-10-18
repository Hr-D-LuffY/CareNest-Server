import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { chatSchema, insightsQuerySchema } from './ai.interface'
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

const getInsights = catchAsync(async (req, res) => {
  const query = insightsQuerySchema.parse(req.query)
  const insights = await AiService.getInsights(query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'AI insights retrieved successfully',
    data: insights,
  })
})

const getStatus = catchAsync(async (_req, res) => {
  const providers = await AiService.getProviderStatus()

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'AI provider status retrieved successfully',
    data: providers,
  })
})

export const AiController = { chat, getInsights, getStatus }
