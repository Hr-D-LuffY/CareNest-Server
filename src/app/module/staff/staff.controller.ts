import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import { createSlotSchema, updateMyStaffSchema, updateSlotSchema } from './staff.interface'
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
  createMySlot,
  listStaffSlots,
  updateMySlot,
  deleteMySlot,
}
