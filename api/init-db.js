import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lxbrsiujmntrvzqdphhj.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU0OTMzNDksImV4cCI6MjA1MTA2OTM0OX0.WXJYoHgfG6BvsBU2VFJrEQZJgMSMjc9d-MhOVGLfSKo';

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if merchants table exists
    const { data: tables, error: tablesError } = await supabase
      .from('merchants')
      .select('id')
      .limit(1);

    if (tablesError && tablesError.code === '42P01') {
      // Table doesn't exist - this is expected
      return res.status(200).json({ 
        message: 'Merchants table does not exist. Please create it using Supabase dashboard.',
        sql: `
-- Run this SQL in your Supabase SQL Editor:

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

CREATE INDEX IF NOT EXISTS idx_merchants_email ON merchants(email);
CREATE INDEX IF NOT EXISTS idx_merchants_login_token ON merchants("loginToken");
CREATE INDEX IF NOT EXISTS idx_merchant_wallets_merchant_id ON merchant_wallets("merchantId");
        `
      });
    }

    // Count existing merchants
    const { count, error: countError } = await supabase
      .from('merchants')
      .select('*', { count: 'exact', head: true });

    return res.status(200).json({ 
      status: 'Database connected successfully',
      merchantsTableExists: true,
      merchantCount: count || 0
    });
  } catch (error) {
    console.error('Database initialization error:', error);
    return res.status(500).json({ 
      error: 'Database initialization failed',
      details: error.message 
    });
  }
}