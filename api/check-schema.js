// Check actual schema of production database tables
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSchema() {
  try {
    console.log('Checking actual database schema...\n');

    // Check merchants table columns
    const merchantColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'merchants'
      ORDER BY ordinal_position;
    `;

    console.log('📊 MERCHANTS TABLE:');
    merchantColumns.forEach(col => {
      console.log(`   ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? '⚠️ NOT NULL' : ''}`);
    });

    // Check orders table columns
    const orderColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'orders'
      ORDER BY ordinal_position;
    `;

    console.log('\n📦 ORDERS TABLE:');
    orderColumns.forEach(col => {
      console.log(`   ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? '⚠️ NOT NULL' : ''}`);
    });

    // Check merchant_wallets table
    const walletColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'merchant_wallets'
      ORDER BY ordinal_position;
    `;

    console.log('\n💰 MERCHANT_WALLETS TABLE:');
    walletColumns.forEach(col => {
      console.log(`   ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? '⚠️ NOT NULL' : ''}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkSchema();
