import httpStatus from 'http-status'
import { AppError } from '../../errorHelpers/AppError'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import {
  createSlotSchema,
  earningsQuerySchema,
  listMyBookingsQuerySchema,
  listMyTripsQuerySchema,
  updateMyStaffSchema,
  updateSlotSchema,
} from './staff.interface'
import { StaffService } from './staff.service'

const getMyProfile = catchAsync(async (req, res) => {
  const staff = await StaffService.getMyProfile(getAuthUser(req))

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Staff profile retrieved successfully',
    data: staff,
  })
})

const updateMyProfile = catchAsync(async (req, res) => {
  const payload = updateMyStaffSchema.parse(req.body)
  const staff = await StaffService.updateMyProfile(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Staff profile updated successfully',
    data: staff,
  })
})

const uploadMyVerificationDocument = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError(httpStatus.BAD_REQUEST, 'A document file is required')
  const staff = await StaffService.uploadMyVerificationDocument(getAuthUser(req), req.file)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Verification document uploaded successfully',
    data: staff,
  })
})

const listMyBookings = catchAsync(async (req, res) => {
  const query = listMyBookingsQuerySchema.parse(req.query)
  const { items, meta } = await StaffService.listMyBookings(getAuthUser(req), query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Assigned bookings retrieved successfully',
    data: items,
    meta,
  })
})

const listMyTrips = catchAsync(async (req, res) => {
  const query = listMyTripsQuerySchema.parse(req.query)
  const { items, meta } = await StaffService.listMyTrips(getAuthUser(req), query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Assigned trips retrieved successfully',
    data: items,
    meta,
  })
})

const getMyEarnings = catchAsync(async (req, res) => {
  const query = earningsQuerySchema.parse(req.query)
  const earnings = await StaffService.getMyEarnings(getAuthUser(req), query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Earnings retrieved successfully',
    data: earnings,
  })
})

const createMySlot = catchAsync(async (req, res) => {
  const payload = createSlotSchema.parse(req.body)
  const slot = await StaffService.createMySlot(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Availability slot created successfully',
    data: slot,
  })
})

const listStaffSlots = catchAsync(async (req, res) => {
  const slots = await StaffService.listStaffSlots(idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Availability retrieved successfully',
    data: slots,
  })
})

const updateMySlot = catchAsync(async (req, res) => {
  const payload = updateSlotSchema.parse(req.body)
  const slot = await StaffService.updateMySlot(
    getAuthUser(req),
    idParamSchema.parse(req.params).id,
    payload,
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Availability slot updated successfully',
    data: slot,
  })
})

const deleteMySlot = catchAsync(async (req, res) => {
  await StaffService.deleteMySlot(getAuthUser(req), idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Availability slot deleted successfully',
    data: null,
  })
})

export const StaffController = {
  getMyProfile,
  updateMyProfile,
  uploadMyVerificationDocument,
  listMyBookings,
  listMyTrips,
  getMyEarnings,
  createMySlot,
  listStaffSlots,
  updateMySlot,
  deleteMySlot,
}
