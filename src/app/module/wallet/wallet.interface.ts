import { z } from 'zod'
import { WalletTransactionType } from '../../../generated/prisma/enums'
import { paginationQueryShape } from '../../utils/pagination'

export const listTransactionsQuerySchema = z.object({
  ...paginationQueryShape,
  type: z.enum(WalletTransactionType).optional(),
})

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>
