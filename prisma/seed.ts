import bcrypt from 'bcryptjs'
import { config } from '../src/app/config'
import { prisma } from '../src/app/lib/prisma'
import {
  DayOfWeek,
  Role,
  StaffType,
  Tier,
  VehicleType,
  VerificationStatus,
} from '../src/generated/prisma/enums'

// Demo credentials for evaluation only — rotate before any real deployment.
const DEMO_ADMIN_EMAIL = 'admin@carenest.com'
const DEMO_ADMIN_PASSWORD = 'CareNest@Admin2026'
const DEMO_STAFF_PASSWORD = 'CareNest@Staff2026'

const hashPassword = (password: string) => bcrypt.hash(password, config.bcryptSaltRounds)

// The only place an Admin account is ever created — never through the API .
const seedAdmin = async () => {
  const passwordHash = await hashPassword(DEMO_ADMIN_PASSWORD)
  return prisma.user.upsert({
    where: { email: DEMO_ADMIN_EMAIL },
    update: {},
    create: { name: 'CareNest Admin', email: DEMO_ADMIN_EMAIL, passwordHash, role: Role.ADMIN },
  })
}

type StaffSeed = {
  email: string
  name: string
  staffType: StaffType
  hourlyRate?: number
  perMinuteRate?: number
}

const seedStaff = async ({ email, name, staffType, hourlyRate, perMinuteRate }: StaffSeed) => {
  const existing = await prisma.staffProfile.findFirst({ where: { user: { email } } })
  if (existing) return existing

  const passwordHash = await hashPassword(DEMO_STAFF_PASSWORD)
  return prisma.staffProfile.create({
    data: {
      staffType,
      bio: `Demo ${staffType.toLowerCase()} account for evaluation`,
      hourlyRate,
      perMinuteRate,
      // Verified up front: a room can only be assigned to a verified sitter (room.service.ts).
      verificationStatus: VerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      user: { create: { name, email, passwordHash, role: Role.STAFF } },
    },
  })
}

type SlotSeed = { staffId: string; dayOfWeek: DayOfWeek; startTime: string; endTime: string }

const seedAvailabilitySlot = async (slot: SlotSeed) => {
  const existing = await prisma.availabilitySlot.findFirst({ where: slot })
  if (existing) return existing
  return prisma.availabilitySlot.create({ data: slot })
}

type RoomSeed = {
  name: string
  staffId: string
  tier: Tier
  capacity: number
  dayOfWeek: DayOfWeek
  startTime: string
  endTime: string
}

// A room's window must sit inside the sitter's availability, so each room's slot is seeded first.
const seedRoom = async ({ name, ...rest }: RoomSeed) => {
  const existing = await prisma.room.findFirst({ where: { name } })
  if (existing) return existing
  return prisma.room.create({ data: { name, ...rest } })
}

const DEMO_VEHICLE_PLATE = 'DEMO-1234'

const seedVehicle = (driverId: string) =>
  prisma.vehicle.upsert({
    where: { plateNumber: DEMO_VEHICLE_PLATE },
    update: {},
    create: { plateNumber: DEMO_VEHICLE_PLATE, capacity: 4, vehicleType: VehicleType.CAR, driverId },
  })

const main = async () => {
  const admin = await seedAdmin()

  const sitter = await seedStaff({
    email: 'sitter.demo@carenest.com',
    name: 'Demo Sitter',
    staffType: StaffType.SITTER,
    hourlyRate: 250,
  })
  const driver = await seedStaff({
    email: 'driver.demo@carenest.com',
    name: 'Demo Driver',
    staffType: StaffType.DRIVER,
    perMinuteRate: 5,
  })

  await seedAvailabilitySlot({
    staffId: sitter.id,
    dayOfWeek: DayOfWeek.MONDAY,
    startTime: '08:00',
    endTime: '14:00',
  })
  await seedAvailabilitySlot({
    staffId: sitter.id,
    dayOfWeek: DayOfWeek.WEDNESDAY,
    startTime: '08:00',
    endTime: '15:00',
  })

  await seedRoom({
    name: 'Sunshine Room',
    staffId: sitter.id,
    tier: Tier.DAILY,
    capacity: 10,
    dayOfWeek: DayOfWeek.MONDAY,
    startTime: '09:00',
    endTime: '13:00',
  })
  await seedRoom({
    name: 'Rainbow Room',
    staffId: sitter.id,
    tier: Tier.WEEKLY,
    capacity: 8,
    dayOfWeek: DayOfWeek.WEDNESDAY,
    startTime: '10:00',
    endTime: '14:00',
  })

  await seedVehicle(driver.id)

  console.log('Seed complete.')
  console.log('Demo Admin login (for evaluation):')
  console.log(`  email:    ${admin.email}`)
  console.log(`  password: ${DEMO_ADMIN_PASSWORD}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
