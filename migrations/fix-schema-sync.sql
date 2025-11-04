-- ===================================================================
-- STABLEPAY: Sync Database Schema with Prisma
-- ===================================================================
-- Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/lxbrsiujmntrvzqdphhj/sql
-- ===================================================================

-- 1. Add merchantId to orders table (critical for multi-tenant)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "merchantId" TEXT;

-- 2. Add index on merchantId for performance
CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders("merchantId");

-- 3. Add foreign key constraint (optional, but recommended)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'orders_merchantId_fkey'
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT orders_merchantId_fkey
        FOREIGN KEY ("merchantId") REFERENCES merchants(id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- ===================================================================
-- Verify the changes
-- ===================================================================
SELECT
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'merchantId';
