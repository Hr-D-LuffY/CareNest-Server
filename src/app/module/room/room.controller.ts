import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import { createRoomSchema, updateRoomSchema } from './room.interface'
import { RoomService } from './room.service'

const createRoom = catchAsync(async (req, res) => {
  const payload = createRoomSchema.parse(req.body)
  const room = await RoomService.createRoom(payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Room created successfully',
    data: room,
  })
})

const updateRoom = catchAsync(async (req, res) => {
  const payload = updateRoomSchema.parse(req.body)
  const room = await RoomService.updateRoom(idParamSchema.parse(req.params).id, payload)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Room updated successfully',
    data: room,
  })
})

const deleteRoom = catchAsync(async (req, res) => {
  await RoomService.deleteRoom(getAuthUser(req), idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Room deleted successfully',
    data: null,
  })
})

export const RoomController = { createRoom, updateRoom, deleteRoom }
