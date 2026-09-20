import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import { createStaffSchema, listStaffQuerySchema, updateStaffSchema } from './admin.interface'
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

const deleteStaff = catchAsync(async (req, res) => {
  await AdminService.deleteStaff(idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Staff account deleted successfully',
    data: null,
  })
})

export const AdminController = { createStaff, listStaff, getStaff, updateStaff, deleteStaff }
