import httpStatus from 'http-status'
import { catchAsync } from '../../utils/catchAsync'
import { getAuthUser } from '../../utils/getAuthUser'
import { sendResponse } from '../../utils/sendResponse'
import { idParamSchema } from '../../utils/validation'
import {
  createTransportSchema,
  createVehicleSchema,
  listTransportQuerySchema,
  listVehiclesQuerySchema,
  updateVehicleSchema,
} from './transport.interface'
import { TransportService } from './transport.service'

const createVehicle = catchAsync(async (req, res) => {
  const payload = createVehicleSchema.parse(req.body)
  const vehicle = await TransportService.createVehicle(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Vehicle registered successfully',
    data: vehicle,
  })
})

const listMyVehicles = catchAsync(async (req, res) => {
  const query = listVehiclesQuerySchema.parse(req.query)
  const { items, meta } = await TransportService.listMyVehicles(getAuthUser(req), query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Vehicles retrieved successfully',
    data: items,
    meta,
  })
})

const listVehicles = catchAsync(async (req, res) => {
  const query = listVehiclesQuerySchema.parse(req.query)
  const { items, meta } = await TransportService.listVehicles(query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Vehicles retrieved successfully',
    data: items,
    meta,
  })
})

const updateVehicle = catchAsync(async (req, res) => {
  const payload = updateVehicleSchema.parse(req.body)
  const vehicle = await TransportService.updateVehicle(
    getAuthUser(req),
    idParamSchema.parse(req.params).id,
    payload,
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Vehicle updated successfully',
    data: vehicle,
  })
})

const deleteVehicle = catchAsync(async (req, res) => {
  await TransportService.deleteVehicle(getAuthUser(req), idParamSchema.parse(req.params).id)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Vehicle deleted successfully',
    data: null,
  })
})

const createTransport = catchAsync(async (req, res) => {
  const payload = createTransportSchema.parse(req.body)
  const transport = await TransportService.createTransport(getAuthUser(req), payload)

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    message: 'Transport requested successfully',
    data: transport,
  })
})

const listMyTransport = catchAsync(async (req, res) => {
  const query = listTransportQuerySchema.parse(req.query)
  const { items, meta } = await TransportService.listMyTransport(getAuthUser(req), query)

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Transport bookings retrieved successfully',
    data: items,
    meta,
  })
})

const getMyTransport = catchAsync(async (req, res) => {
  const transport = await TransportService.getMyTransport(
    getAuthUser(req),
    idParamSchema.parse(req.params).id,
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Transport booking retrieved successfully',
    data: transport,
  })
})

const cancelTransport = catchAsync(async (req, res) => {
  const transport = await TransportService.cancelTransport(
    getAuthUser(req),
    idParamSchema.parse(req.params).id,
  )

  sendResponse(res, {
    statusCode: httpStatus.OK,
    message: 'Transport booking cancelled successfully',
    data: transport,
  })
})

export const TransportController = {
  createVehicle,
  listMyVehicles,
  listVehicles,
  updateVehicle,
  deleteVehicle,
  createTransport,
  listMyTransport,
  getMyTransport,
  cancelTransport,
}
