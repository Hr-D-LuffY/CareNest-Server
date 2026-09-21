import httpStatus from 'http-status'
import { VerificationStatus } from '../../../generated/prisma/enums'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import {
  createStaffSchema,
  listStaffQuerySchema,
  updateStaffSchema,
  verifyStaffSchema,
} from './admin.interface'
import { AdminService } from './admin.service'

const createStaff = catchAsync(async (req, res) => {
  const payload = createStaffSchema.parse(req.body)
  const staff = await AdminService.createStaff(payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Staff account created successfully',
    data: staff,
  })
})

const listStaff = catchAsync(async (req, res) => {
  const query = listStaffQuerySchema.parse(req.query)
  const { items, meta } = await AdminService.listStaff(query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Staff retrieved successfully',
    data: items,
    meta,
  })
})

const getStaff = catchAsync(async (req, res) => {
  const staff = await AdminService.getStaff(idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Staff profile retrieved successfully',
    data: staff,
  })
})

const updateStaff = catchAsync(async (req, res) => {
  const payload = updateStaffSchema.parse(req.body)
  const staff = await AdminService.updateStaff(idParamSchema.parse(req.params).id, payload)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Staff profile updated successfully',
    data: staff,
  })
})

const verifyStaff = catchAsync(async (req, res) => {
  const payload = verifyStaffSchema.parse(req.body)
  const staff = await AdminService.verifyStaff(
    getAuthUser(req),
    idParamSchema.parse(req.params).id,
    payload,
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message:
      payload.status === VerificationStatus.VERIFIED
        ? 'Staff verified successfully'
        : 'Staff rejected successfully',
    data: staff,
  })
})

const deleteStaff = catchAsync(async (req, res) => {
  await AdminService.deleteStaff(idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Staff account deleted successfully',
    data: null,
  })
})

export const AdminController = {
  createStaff,
  listStaff,
  getStaff,
  updateStaff,
  verifyStaff,
  deleteStaff,
}
