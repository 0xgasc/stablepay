-- Create merchants table if it doesn't exist
CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email TEXT UNIQUE NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    role TEXT DEFAULT 'MERCHANT',
    plan TEXT,
    "paymentMode" TEXT DEFAULT 'DIRECT',
    "networkMode" TEXT DEFAULT 'TESTNET',
    "isActive" BOOLEAN DEFAULT false,
    "setupCompleted" BOOLEAN DEFAULT false,
    "loginToken" TEXT UNIQUE,
    "tokenExpiresAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create merchant_wallets table if it doesn't exist
CREATE TABLE IF NOT EXISTS merchant_wallets (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "merchantId" TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    chain TEXT NOT NULL,
    address TEXT NOT NULL,
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE("merchantId", chain)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);
CREATE INDEX IF NOT EXISTS idx_merchants_login_token ON merchants("loginToken");
CREATE INDEX IF NOT EXISTS idx_merchant_wallets_merchant_id ON merchant_wallets("merchantId");