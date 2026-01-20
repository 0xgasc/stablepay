-- Add verification fields to fee_payments
ALTER TABLE "public"."fee_payments"
ADD COLUMN IF NOT EXISTS "verifiedBy" TEXT,
ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);

-- Create platform_wallets table for fee collection
CREATE TABLE IF NOT EXISTS "public"."platform_wallets" (
    "id" TEXT NOT NULL,
    "chain" "public"."Chain" NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_wallets_pkey" PRIMARY KEY ("id")
);

-- One wallet per chain
CREATE UNIQUE INDEX IF NOT EXISTS "platform_wallets_chain_key" ON "public"."platform_wallets"("chain");
