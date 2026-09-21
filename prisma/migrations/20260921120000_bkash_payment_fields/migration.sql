-- SSLCommerz columns become bKash ones: gatewaySessionKey -> gatewayPaymentId, gatewayValId -> gatewayTrxId.
ALTER TABLE "payments" RENAME COLUMN "gatewaySessionKey" TO "gatewayPaymentId";
ALTER TABLE "payments" RENAME COLUMN "gatewayValId" TO "gatewayTrxId";

-- CreateIndex
CREATE UNIQUE INDEX "payments_gatewayPaymentId_key" ON "payments"("gatewayPaymentId");
