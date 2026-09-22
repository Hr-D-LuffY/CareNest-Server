import httpStatus from 'http-status'
import { AppError } from '../../errorHelpers/AppError'
import { clearAuthCookies } from '../../utils/authCookies'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { updateGuardianSchema } from './guardian.interface'
import { GuardianService } from './guardian.service'

const getMyProfile = catchAsync(async (req, res) => {
  const guardian = await GuardianService.getMyProfile(getAuthUser(req))

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Guardian profile retrieved successfully',
    data: guardian,
  })
})

const updateMyProfile = catchAsync(async (req, res) => {
  const payload = updateGuardianSchema.parse(req.body)
  const guardian = await GuardianService.updateMyProfile(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Guardian profile updated successfully',
    data: guardian,
  })
})

const deleteMyAccount = catchAsync(async (req, res) => {
  await GuardianService.deleteMyAccount(getAuthUser(req))

  clearAuthCookies(res)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Account deleted successfully',
    data: null,
  })
})

const uploadMyPhoto = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError(httpStatus.BAD_REQUEST, 'A photo file is required')
  const guardian = await GuardianService.uploadMyPhoto(getAuthUser(req), req.file)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Profile photo updated successfully',
    data: guardian,
  })
})

export const GuardianController = {
  getMyProfile,
  updateMyProfile,
  deleteMyAccount,
  uploadMyPhoto,
}
