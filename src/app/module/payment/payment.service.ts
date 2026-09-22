import { randomUUID } from 'node:crypto'
import httpStatus from 'http-status'
import { Prisma } from '../../../generated/prisma/client'
import { PaymentStatus } from '../../../generated/prisma/enums'
import { AppError } from '../../errorHelpers/AppError'
import { lockRow } from '../../lib/booking-guards'
import {
  createBkashPayment,
  executeBkashPayment,
  PAYMENT_CURRENCY,
  queryBkashPayment,
} from '../../lib/bkash.service'
import { prisma } from '../../lib/prisma'
import { creditWallet } from '../../lib/wallet.service'
import type { TokenPayload } from '../../utils/jwt'
import { getGuardianId } from '../child/child.service'
import type { BkashCallbackQuery, TopUpPayload } from './payment.interface'

type Caller = Pick<TokenPayload, 'userId'>

const AUDIT_PAYMENT_ENTITY = 'Payment'
const AUDIT_TOPUP_INITIATED = 'WALLET_TOPUP_INITIATED'
const AUDIT_TOPUP_SUCCEEDED = 'WALLET_TOPUP_SUCCEEDED'
const AUDIT_TOPUP_FAILED = 'WALLET_TOPUP_FAILED'
const AUDIT_TOPUP_CANCELLED = 'WALLET_TOPUP_CANCELLED'
const INVOICE_PREFIX = 'CN'
const TOP_UP_DESCRIPTION = 'Wallet top-up via bKash'
const BKASH_STATUS_COMPLETED = 'Completed'

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

type PendingPayment = {
  id: string
  guardianId: string
  amount: Prisma.Decimal
  transactionId: string
  guardian: { userId: string }
}

type ConfirmedDetails = { trxId: string | undefined; gatewayResponse: Prisma.InputJsonObject }

const paymentResultSelect = { id: true, status: true, amount: true, gatewayTrxId: true } as const

const findPaymentResult = (id: string) =>
  prisma.payment.findUniqueOrThrow({ where: { id }, select: paymentResultSelect })

// Ends an attempt that was not paid. The conditional update on PENDING means a replayed callback
// can never turn a settled payment into a different outcome.
const settleUnpaid = async (
  payment: PendingPayment,
  status: typeof PaymentStatus.FAILED | typeof PaymentStatus.CANCELLED,
  reason: string,
) => {
  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, status: PaymentStatus.PENDING },
    data: { status },
  })
  if (count > 0) {
    await prisma.auditLog.create({
      data: {
        userId: payment.guardian.userId,
        action: status === PaymentStatus.CANCELLED ? AUDIT_TOPUP_CANCELLED : AUDIT_TOPUP_FAILED,
        entity: AUDIT_PAYMENT_ENTITY,
        entityId: payment.id,
        metadata: { reason },
      },
    })
  }
  return findPaymentResult(payment.id)
}

// bKash's word that the money moved, checked against what we asked for, so a payment for another
// invoice or a different amount can never credit this wallet. Returns the reason when it is not
// acceptable.
const confirmWithBkash = async (
  payment: PendingPayment,
  gatewayPaymentId: string,
): Promise<ConfirmedDetails | string> => {
  // A second callback (browser refresh, retry) finds the payment already executed and Execute is
  // refused, so fall back to a read-only Query, which reports the same final state.
  const details = await executeBkashPayment(gatewayPaymentId).catch(() =>
    queryBkashPayment(gatewayPaymentId),
  )

  if (details.transactionStatus !== BKASH_STATUS_COMPLETED) {
    return 'bKash did not complete the payment'
  }
  if (!new Prisma.Decimal(details.amount).eq(payment.amount)) return 'Paid amount does not match'
  if (details.invoiceNumber !== payment.transactionId) return 'Invoice number does not match'

  // Only the fields we need for audit; the raw payload also carries the payer's phone number.
  return {
    trxId: details.trxId,
    gatewayResponse: {
      trxID: details.trxId ?? null,
      transactionStatus: details.transactionStatus,
      amount: details.amount,
      currency: details.currency ?? null,
    },
  }
}

// Marks the payment SUCCESS and credits the wallet in one transaction. The conditional update on
// PENDING is the idempotency guard: of two racing callbacks only one credits.
const creditConfirmedPayment = async (payment: PendingPayment, details: ConfirmedDetails) => {
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, 'guardian_profiles', payment.guardianId)
    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: {
        status: PaymentStatus.SUCCESS,
        gatewayTrxId: details.trxId,
        gatewayResponse: details.gatewayResponse,
      },
    })
    if (count === 0) return

    const balanceAfter = await creditWallet(tx, {
      guardianId: payment.guardianId,
      amount: payment.amount,
      description: TOP_UP_DESCRIPTION,
      paymentId: payment.id,
    })
    await tx.auditLog.create({
      data: {
        userId: payment.guardian.userId,
        action: AUDIT_TOPUP_SUCCEEDED,
        entity: AUDIT_PAYMENT_ENTITY,
        entityId: payment.id,
        metadata: { amount: payment.amount.toString(), balanceAfter: balanceAfter.toString() },
      },
    })
  })
}

// Where bKash sends the guardian after checkout. The `status` in the URL is only a hint,
// since anyone can type that URL: a payment is credited solely when bKash itself confirms it via
// Execute/Query Payment. Safe to call repeatedly; a settled payment is returned as it is.
const handleBkashCallback = async ({ paymentID, status }: BkashCallbackQuery) => {
  const payment = await prisma.payment.findUnique({
    where: { gatewayPaymentId: paymentID },
    select: {
      id: true,
      guardianId: true,
      amount: true,
      transactionId: true,
      status: true,
      guardian: { select: { userId: true } },
    },
  })
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, 'Payment not found')
  if (payment.status !== PaymentStatus.PENDING) return findPaymentResult(payment.id)

  if (status === 'cancel') {
    return settleUnpaid(payment, PaymentStatus.CANCELLED, 'Cancelled by the guardian')
  }
  if (status === 'failure') {
    return settleUnpaid(payment, PaymentStatus.FAILED, 'bKash reported a failed payment')
  }

  const outcome = await confirmWithBkash(payment, paymentID)
  if (typeof outcome === 'string') return settleUnpaid(payment, PaymentStatus.FAILED, outcome)

  await creditConfirmedPayment(payment, outcome)
  return findPaymentResult(payment.id)
}

// The guardian polls their own payment while (or after) paying on bKash. Someone else's
// payment gets the same 404 as a missing one, so ids can't be probed.
const getMyPayment = async (caller: Caller, paymentId: string) => {
  const guardianId = await getGuardianId(caller)
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, guardianId },
    select: { ...paymentResultSelect, currency: true, createdAt: true, updatedAt: true },
  })
  if (!payment) throw new AppError(httpStatus.NOT_FOUND, 'Payment not found')
  return payment
}

export const PaymentService = { initiateTopUp, handleBkashCallback, getMyPayment }
