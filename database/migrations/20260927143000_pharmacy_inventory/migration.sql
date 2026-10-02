CREATE TYPE "StockMovementType" AS ENUM (
  'RECEIPT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'SALE',
  'RETURN_IN',
  'RETURN_OUT',
  'EXPIRED'
);

CREATE TABLE "inventory_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "reorderLevel" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_items_reorder_level_nonnegative" CHECK ("reorderLevel" >= 0)
);

CREATE TABLE "inventory_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "inventoryItemId" UUID NOT NULL,
  "batchNumber" VARCHAR(100) NOT NULL,
  "quantityOnHand" INTEGER NOT NULL,
  "purchasePriceMinor" BIGINT,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "manufacturedAt" DATE,
  "expiresAt" DATE NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_batches_quantity_nonnegative" CHECK ("quantityOnHand" >= 0),
  CONSTRAINT "inventory_batches_price_nonnegative" CHECK ("purchasePriceMinor" IS NULL OR "purchasePriceMinor" >= 0),
  CONSTRAINT "inventory_batches_dates_valid" CHECK ("manufacturedAt" IS NULL OR "manufacturedAt" <= "expiresAt")
);

CREATE TABLE "stock_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "inventoryBatchId" UUID NOT NULL,
  "type" "StockMovementType" NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" VARCHAR(500),
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_movements_delta_nonzero" CHECK ("quantityDelta" <> 0),
  CONSTRAINT "stock_movements_balance_nonnegative" CHECK ("balanceAfter" >= 0)
);

CREATE UNIQUE INDEX "inventory_items_organizationId_productId_key" ON "inventory_items"("organizationId", "productId");
CREATE INDEX "inventory_items_organizationId_updatedAt_idx" ON "inventory_items"("organizationId", "updatedAt" DESC);
CREATE UNIQUE INDEX "inventory_batches_inventoryItemId_batchNumber_key" ON "inventory_batches"("inventoryItemId", "batchNumber");
CREATE INDEX "inventory_batches_inventoryItemId_expiresAt_idx" ON "inventory_batches"("inventoryItemId", "expiresAt");
CREATE INDEX "inventory_batches_expiresAt_quantityOnHand_idx" ON "inventory_batches"("expiresAt", "quantityOnHand");
CREATE INDEX "stock_movements_inventoryBatchId_createdAt_idx" ON "stock_movements"("inventoryBatchId", "createdAt" DESC);
CREATE INDEX "stock_movements_createdById_createdAt_idx" ON "stock_movements"("createdById", "createdAt" DESC);

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventoryBatchId_fkey" FOREIGN KEY ("inventoryBatchId") REFERENCES "inventory_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
