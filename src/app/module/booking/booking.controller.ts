import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import { createBookingSchema } from './booking.interface'
import { BookingService } from './booking.service'

const createBooking = catchAsync(async (req, res) => {
  const payload = createBookingSchema.parse(req.body)
  const booking = await BookingService.createBooking(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Booking confirmed successfully',
    data: booking,
  })
})

const cancelBooking = catchAsync(async (req, res) => {
  const booking = await BookingService.cancelBooking(
    getAuthUser(req),
    idParamSchema.parse(req.params).id,
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Booking cancelled successfully',
    data: booking,
  })
})

export const BookingController = { createBooking, cancelBooking }
