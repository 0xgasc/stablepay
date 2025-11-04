-- Add new fields to merchants table for enterprise features
-- Run this in Supabase SQL Editor

ALTER TABLE merchants
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS industry TEXT,
ADD COLUMN IF NOT EXISTS monthly_volume DECIMAL(18,2),
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Create API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY DEFAULT 'ak_' || replace(gen_random_uuid()::text, '-', ''),
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_merchant_id ON api_keys(merchant_id);

-- Disable RLS for now
ALTER TABLE api_keys DISABLE ROW LEVEL SECURITY;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'merchants'
ORDER BY ordinal_position;
