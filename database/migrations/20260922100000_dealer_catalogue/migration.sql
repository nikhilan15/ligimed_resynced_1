CREATE TABLE "manufacturers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(250) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "manufacturers_slug_key" ON "manufacturers"("slug");

CREATE TABLE "product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_categories_slug_key" ON "product_categories"("slug");

CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "manufacturerId" UUID,
    "categoryId" UUID,
    "name" VARCHAR(250) NOT NULL,
    "genericName" VARCHAR(250),
    "strength" VARCHAR(100),
    "dosageForm" VARCHAR(100),
    "packSize" VARCHAR(100),
    "description" VARCHAR(2000),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "products_name_idx" ON "products"("name");
CREATE INDEX "products_genericName_idx" ON "products"("genericName");
CREATE INDEX "products_categoryId_isActive_idx" ON "products"("categoryId", "isActive");

CREATE TABLE "dealer_catalogue_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" VARCHAR(100),
    "unitPriceMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "minimumQuantity" INTEGER NOT NULL DEFAULT 1,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "dealer_catalogue_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dealer_catalogue_items_price_nonnegative" CHECK ("unitPriceMinor" >= 0),
    CONSTRAINT "dealer_catalogue_items_minimum_quantity_positive" CHECK ("minimumQuantity" > 0)
);
CREATE UNIQUE INDEX "dealer_catalogue_items_organizationId_productId_key" ON "dealer_catalogue_items"("organizationId", "productId");
CREATE INDEX "dealer_catalogue_items_organizationId_isAvailable_updatedAt_idx" ON "dealer_catalogue_items"("organizationId", "isAvailable", "updatedAt");
CREATE INDEX "dealer_catalogue_items_productId_isAvailable_idx" ON "dealer_catalogue_items"("productId", "isAvailable");

ALTER TABLE "products" ADD CONSTRAINT "products_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dealer_catalogue_items" ADD CONSTRAINT "dealer_catalogue_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dealer_catalogue_items" ADD CONSTRAINT "dealer_catalogue_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
