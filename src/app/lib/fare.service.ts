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

const toMinutes = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return hours * MINUTES_PER_HOUR + minutes
}

// Length of an "HH:mm" window in hours (e.g. 09:00-11:30 -> 2.5).
export const hoursBetween = (startTime: string, endTime: string) =>
  (toMinutes(endTime) - toMinutes(startTime)) / MINUTES_PER_HOUR
