import type { Prisma } from '../../generated/prisma/client'
import type { WalletTransactionType } from '../../generated/prisma/enums'
import { lockRow } from './booking-guards'

type DebitInput = {
  guardianId: string
  type: Exclude<WalletTransactionType, 'TOPUP'>
  amount: Prisma.Decimal
  description: string
  bookingId?: string
  transportBookingId?: string
}

// The one place a wallet is debited (care fees now, transport fares later). The balance only moves
// together with its ledger row, and the guardian row is locked so two charges can't both read the
// same balance. Returns false, and writes nothing, when the balance can't cover the amount.
export const debitWallet = async (
  tx: Prisma.TransactionClient,
  { guardianId, type, amount, description, bookingId, transportBookingId }: DebitInput,
) => {
  await lockRow(tx, 'guardian_profiles', guardianId)
  const { walletBalance } = await tx.guardianProfile.findUniqueOrThrow({
    where: { id: guardianId },
    select: { walletBalance: true },
  })
  if (walletBalance.lt(amount)) return false

  const balanceAfter = walletBalance.sub(amount)
  await tx.guardianProfile.update({
    where: { id: guardianId },
    data: { walletBalance: balanceAfter },
  })
  await tx.walletTransaction.create({
    data: { guardianId, type, amount, balanceAfter, description, bookingId, transportBookingId },
  })
  return true
}
