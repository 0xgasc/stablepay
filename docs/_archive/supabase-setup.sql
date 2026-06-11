-- StablePay Database Setup for Supabase
-- Run this SQL in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enums
DO $$ BEGIN
    CREATE TYPE "Chain" AS ENUM ('BASE_SEPOLIA', 'ETHEREUM_SEPOLIA');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'CONFIRMED', 'REFUNDED', 'EXPIRED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PROCESSED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create orders table
CREATE TABLE IF NOT EXISTS "orders" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "amount" DECIMAL(18,6) NOT NULL,
    "chain" "Chain" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "paymentAddress" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS "transactions" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "orderId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "blockNumber" BIGINT,
    "blockTimestamp" TIMESTAMP(3),
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transactions_txHash_key" UNIQUE ("txHash")
);

-- Create refunds table
CREATE TABLE IF NOT EXISTS "refunds" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "refundTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- Create chain_configs table
CREATE TABLE IF NOT EXISTS "chain_configs" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "chain" "Chain" NOT NULL,
    "rpcUrl" TEXT NOT NULL,
    "usdcAddress" TEXT NOT NULL,
    "paymentAddress" TEXT NOT NULL,
    "requiredConfirms" INTEGER NOT NULL DEFAULT 12,
    "blockTimeSeconds" INTEGER NOT NULL DEFAULT 12,
    "lastScannedBlock" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "chain_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chain_configs_chain_key" UNIQUE ("chain")
);

-- Add foreign key constraints
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "transactions_orderId_idx" ON "transactions"("orderId");
CREATE INDEX IF NOT EXISTS "transactions_chain_idx" ON "transactions"("chain");
CREATE INDEX IF NOT EXISTS "transactions_status_idx" ON "transactions"("status");
CREATE INDEX IF NOT EXISTS "orders_chain_status_idx" ON "orders"("chain", "status");
CREATE INDEX IF NOT EXISTS "orders_expiresAt_idx" ON "orders"("expiresAt");
CREATE INDEX IF NOT EXISTS "refunds_orderId_idx" ON "refunds"("orderId");
CREATE INDEX IF NOT EXISTS "refunds_status_idx" ON "refunds"("status");

-- Insert initial chain configurations
INSERT INTO "chain_configs" ("chain", "rpcUrl", "usdcAddress", "paymentAddress", "requiredConfirms", "blockTimeSeconds", "lastScannedBlock")
VALUES 
    ('BASE_SEPOLIA', 'https://sepolia.base.org', '0x8a04d904055528a69f3e4594dda308a31aeb8457', '0x742d35Cc6631C0532925a3b8D186dA7C1B1DEB84', 1, 2, 10850000),
    ('ETHEREUM_SEPOLIA', 'https://eth-sepolia.g.alchemy.com/v2/alcht_YbDiff1KAqK0fNAzBgycHfz7G0iz4n', '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', '0x742d35Cc6631C0532925a3b8D186dA7C1B1DEB84', 3, 12, 7200000)
ON CONFLICT ("chain") DO UPDATE SET
    "rpcUrl" = EXCLUDED."rpcUrl",
    "usdcAddress" = EXCLUDED."usdcAddress",
    "paymentAddress" = EXCLUDED."paymentAddress",
    "lastScannedBlock" = EXCLUDED."lastScannedBlock";

-- Create trigger to update updatedAt timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON "orders" FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON "transactions" FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_refunds_updated_at BEFORE UPDATE ON "refunds" FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Success message
SELECT 'StablePay database setup completed successfully!' as message;