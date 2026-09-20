import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { updateMyStaffSchema } from './staff.interface'
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

export const StaffController = { getMyProfile, updateMyProfile }
