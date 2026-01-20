// Script to add supportedTokens column to merchant_wallets table
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking/adding supportedTokens column...');

  try {
    // Check if column exists by trying to query it
    const testQuery = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'merchant_wallets'
      AND column_name = 'supportedTokens'
    ` as any[];

    if (testQuery.length === 0) {
      console.log('Column does not exist, adding it...');

      // Add the column with default value
      await prisma.$executeRaw`
        ALTER TABLE merchant_wallets
        ADD COLUMN IF NOT EXISTS "supportedTokens" TEXT[] DEFAULT ARRAY['USDC']::TEXT[]
      `;

      console.log('Column added successfully!');
    } else {
      console.log('Column already exists');
    }

    // Update any NULL values to default
    await prisma.$executeRaw`
      UPDATE merchant_wallets
      SET "supportedTokens" = ARRAY['USDC']::TEXT[]
      WHERE "supportedTokens" IS NULL
    `;

    console.log('Updated NULL values to default');

    // Show current wallets
    const wallets = await prisma.merchantWallet.findMany({
      select: {
        id: true,
        chain: true,
        address: true,
        supportedTokens: true,
        merchant: {
          select: { companyName: true }
        }
      }
    });

    console.log('\nCurrent wallets:');
    wallets.forEach(w => {
      console.log(`  ${w.merchant?.companyName || 'Unknown'} - ${w.chain}: ${w.supportedTokens?.join(', ') || 'USDC'}`);
    });

  } catch (error) {
    console.error('Error:', error);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
