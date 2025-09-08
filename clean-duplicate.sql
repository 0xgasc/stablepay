-- Delete the duplicate merchant record
DELETE FROM merchant_wallets WHERE merchantId IN (
  SELECT id FROM merchants WHERE email = 'gasolomonc@gmail.com'
);

DELETE FROM merchants WHERE email = 'gasolomonc@gmail.com';

-- Verify it was deleted
SELECT COUNT(*) as count FROM merchants WHERE email = 'gasolomonc@gmail.com';