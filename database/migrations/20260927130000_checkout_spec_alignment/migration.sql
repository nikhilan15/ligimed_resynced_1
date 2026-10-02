ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
CREATE TYPE "OrderStatus" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'PACKED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
  'RETURN_REQUESTED',
  'RETURNED'
);

ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus" USING (
  CASE "status"::text
    WHEN 'PLACED' THEN 'PENDING'
    WHEN 'PROCESSING' THEN 'PREPARING'
    WHEN 'READY_FOR_DISPATCH' THEN 'PACKED'
    ELSE "status"::text
  END
)::"OrderStatus";
ALTER TABLE "order_status_history" ALTER COLUMN "fromStatus" TYPE "OrderStatus" USING (
  CASE "fromStatus"::text
    WHEN 'PLACED' THEN 'PENDING'
    WHEN 'PROCESSING' THEN 'PREPARING'
    WHEN 'READY_FOR_DISPATCH' THEN 'PACKED'
    ELSE "fromStatus"::text
  END
)::"OrderStatus";
ALTER TABLE "order_status_history" ALTER COLUMN "toStatus" TYPE "OrderStatus" USING (
  CASE "toStatus"::text
    WHEN 'PLACED' THEN 'PENDING'
    WHEN 'PROCESSING' THEN 'PREPARING'
    WHEN 'READY_FOR_DISPATCH' THEN 'PACKED'
    ELSE "toStatus"::text
  END
)::"OrderStatus";
DROP TYPE "OrderStatus_old";
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE TYPE "PaymentMethod" AS ENUM ('CASH_ON_DELIVERY', 'BANK_TRANSFER', 'ONLINE');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

ALTER TABLE "orders"
  ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH_ON_DELIVERY',
  ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "taxMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryChargeMinor" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_tax_nonnegative" CHECK ("taxMinor" >= 0),
  ADD CONSTRAINT "orders_delivery_charge_nonnegative" CHECK ("deliveryChargeMinor" >= 0),
  DROP CONSTRAINT "orders_total_not_less_than_subtotal",
  ADD CONSTRAINT "orders_total_consistent" CHECK (
    "totalMinor" = "subtotalMinor" + "taxMinor" + "deliveryChargeMinor"
  );

ALTER TABLE "orders" ALTER COLUMN "paymentMethod" DROP DEFAULT;
