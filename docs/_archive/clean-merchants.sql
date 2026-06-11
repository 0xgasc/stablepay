-- Clean all merchants from the database
DELETE FROM merchant_wallets;
DELETE FROM merchants;

-- Verify tables are clean
SELECT COUNT(*) as merchant_count FROM merchants;
SELECT COUNT(*) as wallet_count FROM merchant_wallets;