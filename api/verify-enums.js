// Quick verification that enum types exist in database
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyEnums() {
  try {
    console.log('Checking if enum types exist in database...\n');

    // Try to query enum values from PostgreSQL
    const result = await prisma.$queryRaw`
      SELECT
        t.typname AS enum_name,
        string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS enum_values
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname IN (
        'UserRole', 'PlanType', 'PaymentMode', 'NetworkMode',
        'Chain', 'OrderStatus', 'TransactionStatus', 'RefundStatus'
      )
      GROUP BY t.typname
      ORDER BY t.typname;
    `;

    if (result.length === 8) {
      console.log('✅ ALL ENUM TYPES FOUND:');
      result.forEach(row => {
        console.log(`   ${row.enum_name}: ${row.enum_values}`);
      });
      console.log('\n✅ Database is ready for merchant signup!');
    } else {
      console.log(`⚠️  MISSING ENUMS: Found ${result.length}/8 enum types`);
      result.forEach(row => {
        console.log(`   ✓ ${row.enum_name}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifyEnums();
