// Check merchants in production database
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkMerchants() {
  try {
    console.log('Checking merchants in production database...\n');

    const merchants = await prisma.merchant.findMany({
      orderBy: { createdAt: 'desc' }
    });

    console.log(`Found ${merchants.length} merchants:\n`);

    if (merchants.length > 0) {
      merchants.forEach((merchant, index) => {
        console.log(`${index + 1}. ${merchant.companyName || 'No company'}`);
        console.log(`   Email: ${merchant.email}`);
        console.log(`   Contact: ${merchant.contactName || 'N/A'}`);
        console.log(`   Status: ${merchant.isActive ? '✅ Active' : '⏳ Pending'}`);
        console.log(`   Plan: ${merchant.plan || 'None'}`);
        console.log(`   Created: ${merchant.createdAt}`);
        console.log(`   ID: ${merchant.id}\n`);
      });
    } else {
      console.log('❌ No merchants found in database!');
      console.log('\nThis means either:');
      console.log('1. The signup failed silently');
      console.log('2. You\'re connected to the wrong database');
      console.log('3. The merchant was created but immediately deleted');
    }

    // Also check database connection
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      const hostMatch = dbUrl.match(/\/\/([^:]+)/);
      console.log(`\n📊 Connected to: ${hostMatch ? hostMatch[1] : 'unknown host'}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkMerchants();
