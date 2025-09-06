-- Disable Row Level Security on merchants table to allow anon access
-- Run this in your Supabase SQL Editor

ALTER TABLE merchants DISABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_wallets DISABLE ROW LEVEL SECURITY;

-- Optional: Create permissive policies instead of disabling RLS
-- ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow anon read/write merchants" ON merchants FOR ALL USING (true);
-- 
-- ALTER TABLE merchant_wallets ENABLE ROW LEVEL SECURITY; 
-- CREATE POLICY "Allow anon read/write merchant_wallets" ON merchant_wallets FOR ALL USING (true);