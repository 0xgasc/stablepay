-- ===================================================================
-- STABLEPAY: Create Missing PostgreSQL Enum Types
-- ===================================================================
-- Run this in Supabase SQL Editor to fix signup errors
-- https://supabase.com/dashboard/project/lxbrsiujmntrvzqdphhj/sql
-- ===================================================================

-- Create UserRole enum
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MERCHANT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create PlanType enum
DO $$ BEGIN
    CREATE TYPE "PlanType" AS ENUM ('STARTER', 'GROWTH', 'ENTERPRISE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create PaymentMode enum
DO $$ BEGIN
    CREATE TYPE "PaymentMode" AS ENUM ('DIRECT', 'ESCROW');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create NetworkMode enum
DO $$ BEGIN
    CREATE TYPE "NetworkMode" AS ENUM ('TESTNET', 'MAINNET');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create Chain enum
DO $$ BEGIN
    CREATE TYPE "Chain" AS ENUM (
        'BASE_SEPOLIA',
        'BASE_MAINNET',
        'ETHEREUM_SEPOLIA',
        'ETHEREUM_MAINNET',
        'POLYGON_MAINNET',
        'POLYGON_MUMBAI',
        'ARBITRUM_MAINNET',
        'ARBITRUM_SEPOLIA',
        'SOLANA_MAINNET',
        'SOLANA_DEVNET'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create OrderStatus enum
DO $$ BEGIN
    CREATE TYPE "OrderStatus" AS ENUM (
        'PENDING',
        'PAID',
        'CONFIRMED',
        'REFUNDED',
        'EXPIRED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create TransactionStatus enum
DO $$ BEGIN
    CREATE TYPE "TransactionStatus" AS ENUM (
        'PENDING',
        'CONFIRMED',
        'FAILED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create RefundStatus enum
DO $$ BEGIN
    CREATE TYPE "RefundStatus" AS ENUM (
        'PENDING',
        'APPROVED',
        'REJECTED',
        'PROCESSED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ===================================================================
-- Verify enum types were created
-- ===================================================================
SELECT
    t.typname AS enum_name,
    string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS enum_values
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname IN (
    'UserRole', 'PlanType', 'PaymentMode', 'NetworkMode',
    'Chain', 'OrderStatus', 'TransactionStatus', 'RefundStatus'
)
GROUP BY t.typname
ORDER BY t.typname;
