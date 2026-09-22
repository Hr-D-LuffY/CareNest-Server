import httpStatus from 'http-status'
import type { Prisma } from '../../../generated/prisma/client'
import {
  StaffType,
  TransportStatus,
  VerificationStatus,
  WalletTransactionType,
} from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { ACTIVE_BOOKING_STATUSES, lockRow } from '../../lib/booking-guards'
import { calculateFare } from '../../lib/fare.service'
import { prisma } from '../../lib/prisma'
import { debitWallet } from '../../lib/wallet.service'
import { toIsoDate } from '../../utils/date'
import type { TokenPayload } from '../../utils/jwt'
import { buildMeta, getPagination } from '../../utils/pagination'
import { getGuardianId } from '../child/child.service'
import { todayUtc } from '../room/room.service'
import { getMyDriverId } from '../staff/staff.service'
import type {
  CreateTransportPayload,
  CreateVehiclePayload,
  ListTransportQuery,
  ListVehiclesQuery,
  UpdateVehiclePayload,
} from './transport.interface'

type Caller = Pick<TokenPayload, 'userId'>

// Flat charge every ride starts from; the trip fare is baseFare + minutes x the driver's
// perMinuteRate. A guardian must hold at least this much to request a ride.
const TRANSPORT_BASE_FARE = 50

const AUDIT_TRANSPORT_ENTITY = 'TransportBooking'
const AUDIT_TRANSPORT_REQUESTED = 'TRANSPORT_REQUESTED'
const AUDIT_TRANSPORT_CANCELLED = 'TRANSPORT_CANCELLED'
const AUDIT_TRIP_STARTED = 'TRIP_STARTED'
const AUDIT_TRIP_ENDED = 'TRIP_ENDED'
const TRIP_FARE_DESCRIPTION = 'Transport fare for'
const MS_PER_MINUTE = 60_000
const AUDIT_VEHICLE_ENTITY = 'Vehicle'
const AUDIT_VEHICLE_REGISTERED = 'VEHICLE_REGISTERED'
const VEHICLE_NOT_FOUND_MESSAGE = 'Vehicle not found'
const TRANSPORT_NOT_FOUND_MESSAGE = 'Transport booking not found'
const PLATE_TAKEN_MESSAGE = 'A vehicle with this plate number is already registered'
const DRIVER_TYPES: StaffType[] = [StaffType.DRIVER, StaffType.BOTH]
const OPEN_TRANSPORT_STATUSES = [TransportStatus.REQUESTED, TransportStatus.IN_PROGRESS]

// Only verified, non-deleted drivers can take rides, so only their vehicles are bookable.
const bookableDriver = {
  isDeleted: false,
  verificationStatus: VerificationStatus.VERIFIED,
  staffType: { in: DRIVER_TYPES },
} satisfies Prisma.StaffProfileWhereInput

const vehicleSelect = {
  id: true,
  plateNumber: true,
  capacity: true,
  vehicleType: true,
  createdAt: true,
  updatedAt: true,
  driver: { select: { id: true, perMinuteRate: true, user: { select: { name: true } } } },
} as const

const assertPlateFree = async (plateNumber: string, ownVehicleId?: string) => {
  const existing = await prisma.vehicle.findUnique({
    where: { plateNumber },
    select: { id: true },
  })
  if (existing && existing.id !== ownVehicleId) {
    throw new AppError(httpStatus.CONFLICT, PLATE_TAKEN_MESSAGE)
  }
}

const findOwnedVehicle = async (driverId: string, vehicleId: string) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, driverId },
    select: { id: true },
  })
  if (!vehicle) throw new AppError(httpStatus.NOT_FOUND, VEHICLE_NOT_FOUND_MESSAGE)
  return vehicle
}

const createVehicle = async (caller: Caller, payload: CreateVehiclePayload) => {
  const driverId = await getMyDriverId(caller)
  const { plateNumber, capacity, vehicleType } = payload
  await assertPlateFree(plateNumber)

  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.create({
      data: { driverId, plateNumber, capacity, vehicleType },
      select: vehicleSelect,
    })
    await tx.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_VEHICLE_REGISTERED,
        entity: AUDIT_VEHICLE_ENTITY,
        entityId: vehicle.id,
        metadata: { plateNumber, vehicleType },
      },
    })
    return vehicle
  })
}

const listVehiclesWhere = async (where: Prisma.VehicleWhereInput, query: ListVehiclesQuery) => {
  const filter = { ...where, ...(query.vehicleType && { vehicleType: query.vehicleType }) }
  const [items, total] = await Promise.all([
    prisma.vehicle.findMany({
      where: filter,
      select: vehicleSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...getPagination(query),
    }),
    prisma.vehicle.count({ where: filter }),
  ])
  return { items, meta: buildMeta(query, total) }
}

const listMyVehicles = async (caller: Caller, query: ListVehiclesQuery) => {
  const driverId = await getMyDriverId(caller)
  return listVehiclesWhere({ driverId }, query)
}

const listVehicles = (query: ListVehiclesQuery) =>
  listVehiclesWhere({ driver: bookableDriver }, query)

const updateVehicle = async (caller: Caller, vehicleId: string, payload: UpdateVehiclePayload) => {
  const driverId = await getMyDriverId(caller)
  await findOwnedVehicle(driverId, vehicleId)

  const { plateNumber, capacity, vehicleType } = payload
  if (plateNumber) await assertPlateFree(plateNumber, vehicleId)

  // Shrinking a vehicle must not push already-requested riders out of their seats.
  if (capacity !== undefined) await assertCapacityFits(vehicleId, capacity)

  return prisma.vehicle.update({
    where: { id: vehicleId },
    data: { plateNumber, capacity, vehicleType },
    select: vehicleSelect,
  })
}

// Riders on one date share the vehicle, so capacity can't drop below the busiest upcoming date.
const assertCapacityFits = async (vehicleId: string, capacity: number) => {
  const upcoming = await prisma.transportBooking.findMany({
    where: {
      vehicleId,
      status: { in: OPEN_TRANSPORT_STATUSES },
      booking: { sessionDate: { gte: todayUtc() } },
    },
    select: { booking: { select: { sessionDate: true } } },
  })
  const perDate = new Map<number, number>()
  for (const { booking } of upcoming) {
    const key = booking.sessionDate.getTime()
    perDate.set(key, (perDate.get(key) ?? 0) + 1)
  }
  const peak = Math.max(0, ...perDate.values())
  if (peak > capacity) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Capacity cannot go below ${peak}, the most riders already requested on one upcoming date`,
    )
  }
}

// A vehicle with any ride history stays, since trip records point at it.
const deleteVehicle = async (caller: Caller, vehicleId: string) => {
  const driverId = await getMyDriverId(caller)
  await findOwnedVehicle(driverId, vehicleId)

  const rides = await prisma.transportBooking.count({ where: { vehicleId } })
  if (rides > 0) {
    throw new AppError(httpStatus.CONFLICT, 'This vehicle has ride records and cannot be deleted')
  }
  await prisma.vehicle.delete({ where: { id: vehicleId } })
}

const transportSelect = {
  id: true,
  status: true,
  pickupAddress: true,
  dropoffAddress: true,
  baseFare: true,
  createdAt: true,
  booking: {
    select: {
      id: true,
      sessionDate: true,
      child: { select: { id: true, name: true } },
      room: { select: { id: true, name: true, startTime: true, endTime: true } },
    },
  },
  vehicle: { select: { id: true, plateNumber: true, vehicleType: true } },
  driver: { select: { id: true, user: { select: { name: true } } } },
  tripLog: { select: { tripStart: true, tripEnd: true, durationMinutes: true, fare: true } },
} as const

type TransportRecord = Prisma.TransportBookingGetPayload<{ select: typeof transportSelect }>

const toTransportView = ({ booking, ...transport }: TransportRecord) => ({
  ...transport,
  booking: { ...booking, sessionDate: toIsoDate(booking.sessionDate) },
})

// One ride per care booking (bookingId is unique). A cancelled ride can be requested again, which
// reuses its row rather than adding a second one.
const createTransport = async (caller: Caller, payload: CreateTransportPayload) => {
  const { bookingId, vehicleId, pickupAddress, dropoffAddress } = payload
  const guardianId = await getGuardianId(caller)

  // Someone else's booking gets the same 404 as a missing one, so ids can't be probed.
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, guardianId, status: { in: ACTIVE_BOOKING_STATUSES } },
    select: { id: true, sessionDate: true },
  })
  if (!booking) throw new AppError(httpStatus.NOT_FOUND, 'Booking not found')
  if (booking.sessionDate < todayUtc()) {
    throw new AppError(
      httpStatus.CONFLICT,
      'This session has passed, so a ride cannot be requested',
    )
  }

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, driver: bookableDriver },
    select: {
      id: true,
      capacity: true,
      driverId: true,
      driver: { select: { perMinuteRate: true } },
    },
  })
  if (!vehicle) throw new AppError(httpStatus.NOT_FOUND, VEHICLE_NOT_FOUND_MESSAGE)
  if (vehicle.driver.perMinuteRate === null) {
    throw new AppError(httpStatus.CONFLICT, 'This driver has no per-minute rate set yet')
  }

  const created = await prisma.$transaction(async (tx) => {
    await lockRow(tx, 'bookings', bookingId)
    await lockRow(tx, 'vehicles', vehicleId)

    const existing = await tx.transportBooking.findUnique({
      where: { bookingId },
      select: { id: true, status: true },
    })
    if (existing && existing.status !== TransportStatus.CANCELLED) {
      throw new AppError(httpStatus.CONFLICT, 'A ride is already requested for this booking')
    }

    const taken = await tx.transportBooking.count({
      where: {
        vehicleId,
        status: { in: OPEN_TRANSPORT_STATUSES },
        booking: { sessionDate: booking.sessionDate },
      },
    })
    if (taken >= vehicle.capacity) {
      throw new AppError(httpStatus.CONFLICT, 'This vehicle is full on that date')
    }

    const { walletBalance } = await tx.guardianProfile.findUniqueOrThrow({
      where: { id: guardianId },
      select: { walletBalance: true },
    })
    if (walletBalance.lt(TRANSPORT_BASE_FARE)) {
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        `Insufficient wallet balance. The base fare is ${TRANSPORT_BASE_FARE}, your balance is ${walletBalance}`,
      )
    }

    const data = {
      driverId: vehicle.driverId,
      vehicleId,
      pickupAddress,
      dropoffAddress,
      status: TransportStatus.REQUESTED,
      baseFare: TRANSPORT_BASE_FARE,
    }
    const transport = existing
      ? await tx.transportBooking.update({
          where: { id: existing.id },
          data,
          select: transportSelect,
        })
      : await tx.transportBooking.create({
          data: { ...data, bookingId },
          select: transportSelect,
        })
    await tx.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_TRANSPORT_REQUESTED,
        entity: AUDIT_TRANSPORT_ENTITY,
        entityId: transport.id,
        metadata: { bookingId, vehicleId },
      },
    })
    return transport
  })
  return toTransportView(created)
}

const listMyTransport = async (caller: Caller, query: ListTransportQuery) => {
  const guardianId = await getGuardianId(caller)
  const where: Prisma.TransportBookingWhereInput = {
    booking: { guardianId },
    ...(query.status && { status: query.status }),
  }

  const [items, total] = await Promise.all([
    prisma.transportBooking.findMany({
      where,
      select: transportSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...getPagination(query),
    }),
    prisma.transportBooking.count({ where }),
  ])
  return { items: items.map(toTransportView), meta: buildMeta(query, total) }
}

// Someone else's ride gets the same 404 as a missing one, so ids can't be probed.
const findOwnedTransport = async (guardianId: string, transportId: string) => {
  const transport = await prisma.transportBooking.findFirst({
    where: { id: transportId, booking: { guardianId } },
    select: transportSelect,
  })
  if (!transport) throw new AppError(httpStatus.NOT_FOUND, TRANSPORT_NOT_FOUND_MESSAGE)
  return transport
}

const getMyTransport = async (caller: Caller, transportId: string) => {
  const guardianId = await getGuardianId(caller)
  return toTransportView(await findOwnedTransport(guardianId, transportId))
}

// Only a ride the driver has not started can be cancelled. The status flip is conditional, so a
// double-click or a concurrent trip start can't cancel it twice.
const cancelTransport = async (caller: Caller, transportId: string) => {
  const guardianId = await getGuardianId(caller)
  const transport = await findOwnedTransport(guardianId, transportId)
  if (transport.status !== TransportStatus.REQUESTED) {
    throw new AppError(httpStatus.CONFLICT, `A ${transport.status} ride cannot be cancelled`)
  }

  const cancelled = await prisma.$transaction(async (tx) => {
    const { count } = await tx.transportBooking.updateMany({
      where: { id: transportId, status: TransportStatus.REQUESTED },
      data: { status: TransportStatus.CANCELLED },
    })
    if (count === 0) {
      throw new AppError(httpStatus.CONFLICT, 'This ride can no longer be cancelled')
    }
    await tx.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_TRANSPORT_CANCELLED,
        entity: AUDIT_TRANSPORT_ENTITY,
        entityId: transportId,
      },
    })
    return tx.transportBooking.findUniqueOrThrow({
      where: { id: transportId },
      select: transportSelect,
    })
  })
  return toTransportView(cancelled)
}

// Only the driver assigned to the ride may log it. Someone else's ride gets the same 404 as a
// missing one, so ids can't be probed.
const findMyTrip = async (driverId: string, transportId: string) => {
  const transport = await prisma.transportBooking.findFirst({
    where: { id: transportId, driverId },
    select: {
      id: true,
      status: true,
      baseFare: true,
      booking: {
        select: { guardianId: true, sessionDate: true, child: { select: { name: true } } },
      },
      driver: { select: { perMinuteRate: true } },
    },
  })
  if (!transport) throw new AppError(httpStatus.NOT_FOUND, TRANSPORT_NOT_FOUND_MESSAGE)
  return transport
}

const startTrip = async (caller: Caller, transportId: string) => {
  const driverId = await getMyDriverId(caller)
  const transport = await findMyTrip(driverId, transportId)

  if (transport.status !== TransportStatus.REQUESTED) {
    throw new AppError(httpStatus.CONFLICT, `A ${transport.status} ride cannot be started`)
  }
  if (transport.booking.sessionDate.getTime() !== todayUtc().getTime()) {
    throw new AppError(httpStatus.CONFLICT, 'A trip can only start on the session date')
  }

  const started = await prisma.$transaction(async (tx) => {
    const { count } = await tx.transportBooking.updateMany({
      where: { id: transportId, status: TransportStatus.REQUESTED },
      data: { status: TransportStatus.IN_PROGRESS },
    })
    if (count === 0) {
      throw new AppError(httpStatus.CONFLICT, 'This ride can no longer be started')
    }

    await tx.tripLog.create({ data: { transportBookingId: transportId, tripStart: new Date() } })
    await tx.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_TRIP_STARTED,
        entity: AUDIT_TRANSPORT_ENTITY,
        entityId: transportId,
      },
    })
    return tx.transportBooking.findUniqueOrThrow({
      where: { id: transportId },
      select: transportSelect,
    })
  })
  return toTransportView(started)
}

const endTrip = async (caller: Caller, transportId: string) => {
  const driverId = await getMyDriverId(caller)
  const transport = await findMyTrip(driverId, transportId)

  if (transport.status !== TransportStatus.IN_PROGRESS) {
    throw new AppError(httpStatus.CONFLICT, `A ${transport.status} ride cannot be ended`)
  }
  const { perMinuteRate } = transport.driver
  if (perMinuteRate === null) {
    throw new AppError(
      httpStatus.CONFLICT,
      'This driver has no per-minute rate set, so the trip cannot be priced',
    )
  }

  const tripLog = await prisma.tripLog.findUniqueOrThrow({
    where: { transportBookingId: transportId },
    select: { tripStart: true },
  })
  const tripEnd = new Date()
  const durationMinutes = Math.ceil(
    (tripEnd.getTime() - tripLog.tripStart.getTime()) / MS_PER_MINUTE,
  )
  const fare = transport.baseFare.add(
    calculateFare({ units: durationMinutes, rate: perMinuteRate }),
  )

  const { ended, charged } = await prisma.$transaction(async (tx) => {
    const { count } = await tx.tripLog.updateMany({
      where: { transportBookingId: transportId, tripEnd: null },
      data: { tripEnd, durationMinutes, fare },
    })
    if (count === 0) {
      throw new AppError(httpStatus.CONFLICT, 'This ride can no longer be ended')
    }

    await tx.transportBooking.update({
      where: { id: transportId },
      data: { status: TransportStatus.COMPLETED },
    })
    const paid = await debitWallet(tx, {
      guardianId: transport.booking.guardianId,
      type: WalletTransactionType.TRANSPORT_FARE,
      amount: fare,
      description: `${TRIP_FARE_DESCRIPTION} ${transport.booking.child.name}`,
      transportBookingId: transportId,
    })
    await tx.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_TRIP_ENDED,
        entity: AUDIT_TRANSPORT_ENTITY,
        entityId: transportId,
        metadata: { durationMinutes, fare: fare.toString(), charged: paid },
      },
    })
    const record = await tx.transportBooking.findUniqueOrThrow({
      where: { id: transportId },
      select: transportSelect,
    })
    return { ended: record, charged: paid }
  })
  return { ...toTransportView(ended), charged }
}

export const TransportService = {
  startTrip,
  endTrip,
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
