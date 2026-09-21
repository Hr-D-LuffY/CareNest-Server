import { Prisma } from '../../generated/prisma/client'

const MINUTES_PER_HOUR = 60
const MONEY_DECIMAL_PLACES = 2

type Money = Prisma.Decimal | number

// The one fare formula (SRS 4.8, 4.9): units x rate x modifier. Care fees use hours x hourlyRate x
// price multiplier; transport fares reuse it with minutes x perMinuteRate.
export const calculateFare = ({
  units,
  rate,
  multiplier = 1,
}: {
  units: Money
  rate: Money
  multiplier?: Money
}) => new Prisma.Decimal(units).mul(rate).mul(multiplier).toDecimalPlaces(MONEY_DECIMAL_PLACES)

type CareFeeRoom = {
  startTime: string
  endTime: string
  priceMultiplier: Money
  staff: { hourlyRate: Money | null }
}

// Estimated care fee for one full session of a room; null while its staff has no hourly rate yet.
// Booking creation and waitlist promotion both price a seat through this.
export const estimateCareFee = ({ startTime, endTime, priceMultiplier, staff }: CareFeeRoom) => {
  if (staff.hourlyRate === null) return null
  return calculateFare({
    units: hoursBetween(startTime, endTime),
    rate: staff.hourlyRate,
    multiplier: priceMultiplier,
  })
}

const MS_PER_HOUR = MINUTES_PER_HOUR * 60 * 1000

// Actual time between two instants in hours, to the cent-style precision `hoursUsed` is stored at
// (e.g. 1h 30m -> 1.5). Never negative.
export const hoursElapsed = (from: Date, to: Date) =>
  new Prisma.Decimal(Math.max(0, to.getTime() - from.getTime()))
    .div(MS_PER_HOUR)
    .toDecimalPlaces(MONEY_DECIMAL_PLACES)

const toMinutes = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return hours * MINUTES_PER_HOUR + minutes
}

// Length of an "HH:mm" window in hours (e.g. 09:00-11:30 -> 2.5).
export const hoursBetween = (startTime: string, endTime: string) =>
  (toMinutes(endTime) - toMinutes(startTime)) / MINUTES_PER_HOUR
