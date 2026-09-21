import { z } from 'zod'
import { TransportStatus, VehicleType } from '../../../generated/prisma/enums'
import { paginationQueryShape } from '../../utils/pagination'
import { atLeastOneField, updateBodySchema } from '../../utils/validation'

const PLATE_NUMBER_MIN_LENGTH = 3
const PLATE_NUMBER_MAX_LENGTH = 20
const VEHICLE_MIN_CAPACITY = 1
const VEHICLE_MAX_CAPACITY = 60
const ADDRESS_MIN_LENGTH = 5
const ADDRESS_MAX_LENGTH = 255

const plateNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(
    PLATE_NUMBER_MIN_LENGTH,
    `Plate number must be at least ${PLATE_NUMBER_MIN_LENGTH} characters`,
  )
  .max(
    PLATE_NUMBER_MAX_LENGTH,
    `Plate number must be at most ${PLATE_NUMBER_MAX_LENGTH} characters`,
  )

const capacitySchema = z
  .number()
  .int('Capacity must be a whole number')
  .min(VEHICLE_MIN_CAPACITY, `Capacity must be at least ${VEHICLE_MIN_CAPACITY}`)
  .max(VEHICLE_MAX_CAPACITY, `Capacity must be at most ${VEHICLE_MAX_CAPACITY}`)

const addressSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(ADDRESS_MIN_LENGTH, `${label} must be at least ${ADDRESS_MIN_LENGTH} characters`)
    .max(ADDRESS_MAX_LENGTH, `${label} must be at most ${ADDRESS_MAX_LENGTH} characters`)

export const createVehicleSchema = z.object({
  plateNumber: plateNumberSchema,
  capacity: capacitySchema,
  vehicleType: z.enum(VehicleType),
})

export const updateVehicleSchema = updateBodySchema({
  plateNumber: plateNumberSchema,
  capacity: capacitySchema,
  vehicleType: z.enum(VehicleType),
})
  .partial()
  .refine(...atLeastOneField)

export const listVehiclesQuerySchema = z.object({
  ...paginationQueryShape,
  vehicleType: z.enum(VehicleType).optional(),
})

export const createTransportSchema = z.object({
  bookingId: z.uuid('Booking id must be a valid UUID'),
  vehicleId: z.uuid('Vehicle id must be a valid UUID'),
  pickupAddress: addressSchema('Pickup address'),
  dropoffAddress: addressSchema('Dropoff address'),
})

export const listTransportQuerySchema = z.object({
  ...paginationQueryShape,
  status: z.enum(TransportStatus).optional(),
})

export type CreateVehiclePayload = z.infer<typeof createVehicleSchema>
export type UpdateVehiclePayload = z.infer<typeof updateVehicleSchema>
export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>
export type CreateTransportPayload = z.infer<typeof createTransportSchema>
export type ListTransportQuery = z.infer<typeof listTransportQuerySchema>
