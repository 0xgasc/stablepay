const { Client } = require('pg');
require('dotenv').config();

async function testConnection() {
  console.log('🔍 Testing Supabase connection...');
  console.log('Connection string:', process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@'));

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('⏳ Connecting...');
    await client.connect();
    console.log('✅ Connected to Supabase!');
    
    console.log('🔍 Testing query...');
    const result = await client.query('SELECT NOW() as current_time, version()');
    console.log('✅ Query successful!');
    console.log('📊 Result:', result.rows[0]);
    
    // Test our tables
    console.log('🔍 Checking our tables...');
    const tables = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename IN ('orders', 'transactions', 'refunds', 'chain_configs')
    `);
    console.log('📋 Tables found:', tables.rows.map(r => r.tablename));
    
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('📝 Full error:', error);
  } finally {
    await client.end();
    console.log('🔚 Connection closed');
  }
}

testConnection();