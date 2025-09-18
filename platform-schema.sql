-- StablePay Platform Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension first
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Customer Wallets (invisible wallets for end users)
CREATE TABLE customer_wallets (
    id TEXT PRIMARY KEY DEFAULT 'wallet_' || replace(uuid_generate_v4()::text, '-', ''),
    email TEXT NOT NULL,
    name TEXT,
    wallet_address TEXT NOT NULL,
    chain TEXT NOT NULL DEFAULT 'base',
    merchant_id TEXT REFERENCES merchants(id),
    private_key_encrypted TEXT, -- Encrypted private key for custodial wallets
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Checkout Sessions (payment sessions like Stripe)
CREATE TABLE checkout_sessions (
    id TEXT PRIMARY KEY DEFAULT 'cs_' || replace(uuid_generate_v4()::text, '-', ''),
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    amount DECIMAL(20,6) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDC',
    status TEXT NOT NULL DEFAULT 'pending', -- pending, completed, expired, failed
    customer_email TEXT,
    customer_wallet_id TEXT REFERENCES customer_wallets(id),
    recipient_address TEXT,
    success_url TEXT,
    cancel_url TEXT,
    payment_method TEXT, -- 'card', 'crypto', 'onramp'
    transaction_hash TEXT,
    metadata JSONB,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '30 minutes',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. API Keys (for developers to access our APIs)
CREATE TABLE api_keys (
    id TEXT PRIMARY KEY DEFAULT 'ak_' || replace(uuid_generate_v4()::text, '-', ''),
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    key_prefix TEXT NOT NULL, -- 'pk_live_' or 'pk_test_'
    key_hash TEXT NOT NULL, -- Hashed API key
    name TEXT NOT NULL,
    permissions TEXT[] DEFAULT ARRAY['read', 'write'],
    rate_limit INTEGER DEFAULT 1000, -- requests per hour
    is_active BOOLEAN DEFAULT true,
    last_used TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Onramp Transactions (fiat to crypto)
CREATE TABLE onramp_transactions (
    id TEXT PRIMARY KEY DEFAULT 'onramp_' || replace(uuid_generate_v4()::text, '-', ''),
    merchant_id TEXT REFERENCES merchants(id),
    customer_email TEXT NOT NULL,
    customer_wallet_id TEXT REFERENCES customer_wallets(id),
    fiat_amount DECIMAL(20,2) NOT NULL,
    fiat_currency TEXT NOT NULL DEFAULT 'USD',
    crypto_amount DECIMAL(20,6),
    crypto_currency TEXT NOT NULL DEFAULT 'USDC',
    exchange_rate DECIMAL(20,6),
    fee_amount DECIMAL(20,6),
    payment_method TEXT, -- 'card', 'bank_transfer'
    payment_intent_id TEXT, -- Stripe payment intent ID
    destination_address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
    transaction_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Webhooks (for notifying merchants of events)
CREATE TABLE webhooks (
    id TEXT PRIMARY KEY DEFAULT 'wh_' || replace(uuid_generate_v4()::text, '-', ''),
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    url TEXT NOT NULL,
    events TEXT[] NOT NULL, -- ['checkout.completed', 'wallet.created', etc]
    secret TEXT NOT NULL, -- For webhook signature verification
    is_active BOOLEAN DEFAULT true,
    last_success TIMESTAMP WITH TIME ZONE,
    failure_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Webhook Events (log of webhook deliveries)
CREATE TABLE webhook_events (
    id TEXT PRIMARY KEY DEFAULT 'we_' || replace(uuid_generate_v4()::text, '-', ''),
    webhook_id TEXT NOT NULL REFERENCES webhooks(id),
    event_type TEXT NOT NULL,
    event_data JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_customer_wallets_email ON customer_wallets(email);
CREATE INDEX idx_customer_wallets_merchant ON customer_wallets(merchant_id);
CREATE INDEX idx_checkout_sessions_merchant ON checkout_sessions(merchant_id);
CREATE INDEX idx_checkout_sessions_status ON checkout_sessions(status);
CREATE INDEX idx_api_keys_merchant ON api_keys(merchant_id);
CREATE INDEX idx_onramp_transactions_merchant ON onramp_transactions(merchant_id);
CREATE INDEX idx_webhooks_merchant ON webhooks(merchant_id);

-- Disable RLS for now (enable in production with proper policies)
ALTER TABLE customer_wallets DISABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE onramp_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks DISABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events DISABLE ROW LEVEL SECURITY;

-- Verify tables were created
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN (
    'customer_wallets', 'checkout_sessions', 'api_keys',
    'onramp_transactions', 'webhooks', 'webhook_events'
);