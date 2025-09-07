-- Update the Chain enum to include all supported chains
-- Run this in your Supabase SQL Editor

-- First, let's see what chains currently exist
-- SELECT unnest(enum_range(NULL::chain));

-- Add missing chain values to the enum
ALTER TYPE "Chain" ADD VALUE IF NOT EXISTS 'POLYGON_MUMBAI';
ALTER TYPE "Chain" ADD VALUE IF NOT EXISTS 'ARBITRUM_SEPOLIA'; 
ALTER TYPE "Chain" ADD VALUE IF NOT EXISTS 'SOLANA_DEVNET';
ALTER TYPE "Chain" ADD VALUE IF NOT EXISTS 'SOLANA_MAINNET';

-- If the enum doesn't exist at all, create it:
-- CREATE TYPE "Chain" AS ENUM (
--   'BASE_SEPOLIA',
--   'BASE_MAINNET', 
--   'ETHEREUM_SEPOLIA',
--   'ETHEREUM_MAINNET',
--   'POLYGON_MAINNET',
--   'POLYGON_MUMBAI',
--   'ARBITRUM_MAINNET',
--   'ARBITRUM_SEPOLIA',
--   'SOLANA_MAINNET',
--   'SOLANA_DEVNET'
-- );