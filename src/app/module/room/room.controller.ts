import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import {
  createRoomSchema,
  listRoomsQuerySchema,
  roomDetailQuerySchema,
  searchRoomsQuerySchema,
  updateRoomSchema,
} from './room.interface'
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

const listRooms = catchAsync(async (req, res) => {
  const query = listRoomsQuerySchema.parse(req.query)
  const { items, meta } = await RoomService.listRooms(query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Rooms retrieved successfully',
    data: items,
    meta,
  })
})

const searchRooms = catchAsync(async (req, res) => {
  const query = searchRoomsQuerySchema.parse(req.query)
  const { items, meta } = await RoomService.listRooms(query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Rooms retrieved successfully',
    data: items,
    meta,
  })
})

const getRoom = catchAsync(async (req, res) => {
  const query = roomDetailQuerySchema.parse(req.query)
  const room = await RoomService.getRoom(idParamSchema.parse(req.params).id, query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Room retrieved successfully',
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

export const RoomController = {
  createRoom,
  listRooms,
  searchRooms,
  getRoom,
  updateRoom,
  deleteRoom,
}
