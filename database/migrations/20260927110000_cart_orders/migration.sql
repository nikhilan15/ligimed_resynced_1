CREATE TYPE "OrderStatus" AS ENUM (
  'PLACED',
  'CONFIRMED',
  'PROCESSING',
  'READY_FOR_DISPATCH',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
  'REJECTED'
);

CREATE TABLE "carts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pharmacyOrganizationId" UUID NOT NULL,
  "dealerOrganizationId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cart_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cartId" UUID NOT NULL,
  "dealerCatalogueItemId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cart_items_quantity_positive" CHECK ("quantity" > 0)
);

CREATE TABLE "orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderNumber" VARCHAR(40) NOT NULL,
  "pharmacyOrganizationId" UUID NOT NULL,
  "dealerOrganizationId" UUID NOT NULL,
  "placedByUserId" UUID NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "subtotalMinor" BIGINT NOT NULL,
  "totalMinor" BIGINT NOT NULL,
  "shippingAddress" JSONB NOT NULL,
  "placedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_subtotal_nonnegative" CHECK ("subtotalMinor" >= 0),
  CONSTRAINT "orders_total_nonnegative" CHECK ("totalMinor" >= 0),
  CONSTRAINT "orders_total_not_less_than_subtotal" CHECK ("totalMinor" >= "subtotalMinor")
);

CREATE TABLE "order_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "dealerCatalogueItemId" UUID,
  "productId" UUID NOT NULL,
  "productName" VARCHAR(250) NOT NULL,
  "genericName" VARCHAR(250),
  "strength" VARCHAR(100),
  "dosageForm" VARCHAR(100),
  "packSize" VARCHAR(100),
  "sku" VARCHAR(100),
  "unitPriceMinor" BIGINT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "lineTotalMinor" BIGINT NOT NULL,
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_items_unit_price_nonnegative" CHECK ("unitPriceMinor" >= 0),
  CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "order_items_line_total_nonnegative" CHECK ("lineTotalMinor" >= 0),
  CONSTRAINT "order_items_line_total_consistent" CHECK ("lineTotalMinor" = "unitPriceMinor" * "quantity")
);

CREATE TABLE "order_status_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "fromStatus" "OrderStatus",
  "toStatus" "OrderStatus" NOT NULL,
  "changedByUserId" UUID,
  "note" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "carts_pharmacyOrganizationId_key" ON "carts"("pharmacyOrganizationId");
CREATE INDEX "carts_dealerOrganizationId_idx" ON "carts"("dealerOrganizationId");
CREATE UNIQUE INDEX "cart_items_cartId_dealerCatalogueItemId_key" ON "cart_items"("cartId", "dealerCatalogueItemId");
CREATE INDEX "cart_items_dealerCatalogueItemId_idx" ON "cart_items"("dealerCatalogueItemId");
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");
CREATE INDEX "orders_pharmacyOrganizationId_placedAt_idx" ON "orders"("pharmacyOrganizationId", "placedAt" DESC);
CREATE INDEX "orders_dealerOrganizationId_placedAt_idx" ON "orders"("dealerOrganizationId", "placedAt" DESC);
CREATE INDEX "orders_status_placedAt_idx" ON "orders"("status", "placedAt" DESC);
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");
CREATE INDEX "order_status_history_orderId_createdAt_idx" ON "order_status_history"("orderId", "createdAt");

ALTER TABLE "carts" ADD CONSTRAINT "carts_pharmacyOrganizationId_fkey" FOREIGN KEY ("pharmacyOrganizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carts" ADD CONSTRAINT "carts_dealerOrganizationId_fkey" FOREIGN KEY ("dealerOrganizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_dealerCatalogueItemId_fkey" FOREIGN KEY ("dealerCatalogueItemId") REFERENCES "dealer_catalogue_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_pharmacyOrganizationId_fkey" FOREIGN KEY ("pharmacyOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_dealerOrganizationId_fkey" FOREIGN KEY ("dealerOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_placedByUserId_fkey" FOREIGN KEY ("placedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_dealerCatalogueItemId_fkey" FOREIGN KEY ("dealerCatalogueItemId") REFERENCES "dealer_catalogue_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
