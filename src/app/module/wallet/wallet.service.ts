import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import { buildMeta, getPagination } from '../../utils/pagination'
import { getGuardianId } from '../child/child.service'
import type { ListTransactionsQuery } from './wallet.interface'

type Caller = Pick<TokenPayload, 'userId'>

const transactionSelect = {
  id: true,
  type: true,
  amount: true,
  balanceAfter: true,
  description: true,
  bookingId: true,
  transportBookingId: true,
  paymentId: true,
  createdAt: true,
} as const

// The guardian's own ledger, newest first (SRS 4.3). `amount` is always positive; `type` says
// whether it was a top-up or a spend, and `balanceAfter` is the wallet balance right after it.
const listMyTransactions = async (caller: Caller, query: ListTransactionsQuery) => {
  const guardianId = await getGuardianId(caller)
  const where = { guardianId, ...(query.type && { type: query.type }) }

  const [items, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      select: transactionSelect,
      // `id` breaks ties so rows created in the same instant page in a stable order.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...getPagination(query),
    }),
    prisma.walletTransaction.count({ where }),
  ])

  return { items, meta: buildMeta(query, total) }
}

export const WalletService = { listMyTransactions }
