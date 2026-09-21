import type { Prisma } from '../../generated/prisma/client'
import { WalletTransactionType } from '../../generated/prisma/enums'
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

type CreditInput = {
  guardianId: string
  amount: Prisma.Decimal
  description: string
  paymentId: string
}

// Credits a confirmed top-up. Same rule as debitWallet: the balance only moves together with its
// ledger row. `paymentId` is unique on the ledger, so a payment can never credit twice.
export const creditWallet = async (
  tx: Prisma.TransactionClient,
  { guardianId, amount, description, paymentId }: CreditInput,
) => {
  await lockRow(tx, 'guardian_profiles', guardianId)
  const { walletBalance } = await tx.guardianProfile.findUniqueOrThrow({
    where: { id: guardianId },
    select: { walletBalance: true },
  })

  const balanceAfter = walletBalance.add(amount)
  await tx.guardianProfile.update({
    where: { id: guardianId },
    data: { walletBalance: balanceAfter },
  })
  await tx.walletTransaction.create({
    data: {
      guardianId,
      type: WalletTransactionType.TOPUP,
      amount,
      balanceAfter,
      description,
      paymentId,
    },
  })
  return balanceAfter
}
