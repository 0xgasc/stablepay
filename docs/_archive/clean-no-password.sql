-- Delete merchant records without passwords
DELETE FROM merchant_wallets WHERE "merchantId" IN (
  SELECT id FROM merchants WHERE "passwordHash" IS NULL
);

DELETE FROM merchants WHERE "passwordHash" IS NULL;

-- Verify cleanup
SELECT COUNT(*) as count FROM merchants WHERE "passwordHash" IS NULL;