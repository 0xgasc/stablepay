-- Run this SQL in Supabase to fix permissions
-- This will allow registration to work properly

-- Disable RLS on merchants table to allow anon access
ALTER TABLE merchants DISABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_wallets DISABLE ROW LEVEL SECURITY;

-- Verify tables are accessible
SELECT 'merchants table accessible' as status;
SELECT COUNT(*) as merchant_count FROM merchants;