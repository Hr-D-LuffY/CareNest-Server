import { randomUUID } from 'node:crypto'
import httpStatus from 'http-status'
import { PaymentStatus } from '../../../generated/prisma/enums'
import { PAYMENT_CURRENCY } from '../../constants/payment.constants'
import { AppError } from '../../errorHelpers/AppError'
import { createBkashPayment } from '../../lib/bkash.service'
import { prisma } from '../../lib/prisma'
import type { TokenPayload } from '../../utils/jwt'
import { getGuardianId } from '../child/child.service'
import type { TopUpPayload } from './payment.interface'

type Caller = Pick<TokenPayload, 'userId'>

const AUDIT_PAYMENT_ENTITY = 'Payment'
const AUDIT_TOPUP_INITIATED = 'WALLET_TOPUP_INITIATED'
const INVOICE_PREFIX = 'CN'

const initiateTopUp = async (caller: Caller, { amount }: TopUpPayload) => {
  const guardianId = await getGuardianId(caller)

  const payment = await prisma.payment.create({
    data: {
      guardianId,
      amount,
      currency: PAYMENT_CURRENCY,
      transactionId: `${INVOICE_PREFIX}${randomUUID().replaceAll('-', '')}`,
    },
    select: { id: true, transactionId: true, amount: true },
  })

  try {
    const { paymentId, checkoutUrl } = await createBkashPayment({
      amount: payment.amount.toFixed(2),
      invoiceNumber: payment.transactionId,
      payerReference: guardianId,
    })
    await prisma.payment.update({
      where: { id: payment.id },
      data: { gatewayPaymentId: paymentId },
    })
    await prisma.auditLog.create({
      data: {
        userId: caller.userId,
        action: AUDIT_TOPUP_INITIATED,
        entity: AUDIT_PAYMENT_ENTITY,
        entityId: payment.id,
        metadata: { amount: payment.amount.toString() },
      },
    })
    return { paymentId: payment.id, amount: payment.amount, checkoutUrl }
  } catch (error) {
    // The guardian never reached bKash, so this attempt can't be paid; don't leave it PENDING.
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED },
    })
    if (error instanceof AppError) throw error
    throw new AppError(httpStatus.BAD_GATEWAY, 'Could not start the bKash payment')
  }
}

export const PaymentService = { initiateTopUp }
