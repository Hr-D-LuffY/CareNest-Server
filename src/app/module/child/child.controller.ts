import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import { createChildSchema, listChildrenQuerySchema, updateChildSchema } from './child.interface'
import { ChildService } from './child.service'

const createChild = catchAsync(async (req, res) => {
  const payload = createChildSchema.parse(req.body)
  const child = await ChildService.createChild(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Child profile created successfully',
    data: child,
  })
})

const listMyChildren = catchAsync(async (req, res) => {
  const query = listChildrenQuerySchema.parse(req.query)
  const { items, meta } = await ChildService.listMyChildren(getAuthUser(req), query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Children retrieved successfully',
    data: items,
    meta,
  })
})

const getMyChild = catchAsync(async (req, res) => {
  const child = await ChildService.getMyChild(getAuthUser(req), idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Child profile retrieved successfully',
    data: child,
  })
})

const updateMyChild = catchAsync(async (req, res) => {
  const payload = updateChildSchema.parse(req.body)
  const child = await ChildService.updateMyChild(
    getAuthUser(req),
    idParamSchema.parse(req.params).id,
    payload,
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Child profile updated successfully',
    data: child,
  })
})

const deleteMyChild = catchAsync(async (req, res) => {
  await ChildService.deleteMyChild(getAuthUser(req), idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Child profile deleted successfully',
    data: null,
  })
})

export const ChildController = {
  createChild,
  listMyChildren,
  getMyChild,
  updateMyChild,
  deleteMyChild,
}
