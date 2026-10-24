-- CreateEnum
CREATE TYPE "PaymentOption" AS ENUM ('DEPOSIT', 'FULL');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "paymentOption" "PaymentOption";

-- Preserve legacy orders without treating them as stock-confirmed.
UPDATE "Order"
SET "status" = 'PENDING'
WHERE "status" = 'CONFIRMED';

-- CreateTable
CREATE TABLE "OrderStockReservation" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "OrderStockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderStockReservation_orderId_variantId_key" ON "OrderStockReservation"("orderId", "variantId");

-- CreateIndex
CREATE INDEX "OrderStockReservation_orderId_releasedAt_idx" ON "OrderStockReservation"("orderId", "releasedAt");

-- CreateIndex
CREATE INDEX "OrderStockReservation_variantId_releasedAt_idx" ON "OrderStockReservation"("variantId", "releasedAt");

-- AddForeignKey
ALTER TABLE "OrderStockReservation" ADD CONSTRAINT "OrderStockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStockReservation" ADD CONSTRAINT "OrderStockReservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
