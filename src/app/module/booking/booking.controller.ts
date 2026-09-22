import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import { createBookingSchema, listBookingsQuerySchema } from './booking.interface'
import { BookingService } from './booking.service'

const createBooking = catchAsync(async (req, res) => {
  const payload = createBookingSchema.parse(req.body)
  const { booking, waitlistEntry } = await BookingService.createBooking(getAuthUser(req), payload)

  // A full room answers 202: the request is accepted but the child holds a queue spot, not a seat.
  if (waitlistEntry) {
    return sendResponse(res, {
      statusCode: httpStatus.ACCEPTED,
      message: 'The room is full, so the child was added to the waitlist',
      data: waitlistEntry,
    })
  }

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Booking confirmed successfully',
    data: booking,
  })
})

const listMyBookings = catchAsync(async (req, res) => {
  const query = listBookingsQuerySchema.parse(req.query)
  const { items, meta } = await BookingService.listMyBookings(getAuthUser(req), query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Bookings retrieved successfully',
    data: items,
    meta,
  })
})

const getMyBooking = catchAsync(async (req, res) => {
  const booking = await BookingService.getMyBooking(
    getAuthUser(req),
    idParamSchema.parse(req.params).id,
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Booking retrieved successfully',
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

const checkIn = catchAsync(async (req, res) => {
  const log = await BookingService.checkIn(getAuthUser(req), idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Child checked in successfully',
    data: log,
  })
})

const checkOut = catchAsync(async (req, res) => {
  const log = await BookingService.checkOut(getAuthUser(req), idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Child checked out successfully',
    data: log,
  })
})

export const BookingController = {
  createBooking,
  listMyBookings,
  getMyBooking,
  cancelBooking,
  checkIn,
  checkOut,
}
