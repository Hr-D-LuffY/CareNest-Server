import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import { createRatingSchema, listStaffRatingsQuerySchema } from './rating.interface'
import { RatingService } from './rating.service'

const createRating = catchAsync(async (req, res) => {
  const payload = createRatingSchema.parse(req.body)
  const rating = await RatingService.createRating(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Rating submitted successfully',
    data: rating,
  })
})

const getStaffRatings = catchAsync(async (req, res) => {
  const query = listStaffRatingsQuerySchema.parse(req.query)
  const { average, count, reviews, meta } = await RatingService.getStaffRatings(
    idParamSchema.parse(req.params).id,
    query,
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Staff ratings retrieved successfully',
    data: { average, count, reviews },
    meta,
  })
})

export const RatingController = { createRating, getStaffRatings }
