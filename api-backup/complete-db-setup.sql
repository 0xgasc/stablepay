-- Complete Database Setup for StablePay
-- Run this in your Supabase SQL Editor to fix all issues

-- 1. Update Chain enum with missing values
ALTER TYPE "Chain" ADD VALUE IF NOT EXISTS 'POLYGON_MUMBAI';
ALTER TYPE "Chain" ADD VALUE IF NOT EXISTS 'ARBITRUM_SEPOLIA'; 
ALTER TYPE "Chain" ADD VALUE IF NOT EXISTS 'SOLANA_DEVNET';
ALTER TYPE "Chain" ADD VALUE IF NOT EXISTS 'SOLANA_MAINNET';

-- 2. Option A: Keep RLS disabled for development (current working state)
-- No action needed - tables will remain accessible to anon key

-- 3. Option B: Enable RLS with permissive policies (more secure)
-- Uncomment the lines below if you want to enable RLS:

/*
-- Enable RLS on all tables
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_configs ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for development
CREATE POLICY "Allow anon access to merchants" ON merchants FOR ALL USING (true);
CREATE POLICY "Allow anon access to merchant_wallets" ON merchant_wallets FOR ALL USING (true);
CREATE POLICY "Allow anon access to orders" ON orders FOR ALL USING (true);
CREATE POLICY "Allow anon access to transactions" ON transactions FOR ALL USING (true);
CREATE POLICY "Allow anon access to refunds" ON refunds FOR ALL USING (true);
CREATE POLICY "Allow anon access to chain_configs" ON chain_configs FOR ALL USING (true);

-- For production, you'd want more restrictive policies like:
-- CREATE POLICY "Merchants can only see their own data" ON orders FOR ALL USING (merchantId = auth.uid());
-- CREATE POLICY "Admin full access" ON orders FOR ALL USING (auth.role() = 'admin');
*/

-- 4. Verify the setup
SELECT 'Chain enum updated successfully' as status;
SELECT unnest(enum_range(NULL::"Chain")) as available_chains;