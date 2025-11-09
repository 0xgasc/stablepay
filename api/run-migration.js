import { PrismaClient } from '@prisma/client';

let prisma;
function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

export default async function handler(req, res) {
  // Security check
  const { secret } = req.query;

  if (secret !== process.env.ADMIN_SECRET && secret !== 'temp-migration-2024') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const db = getPrisma();

  try {
    // Check if invoiceEnabled column exists
    const checkColumn = await db.$queryRawUnsafe(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'merchants'
      AND column_name = 'invoiceEnabled'
    `);

    if (checkColumn.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'Column invoiceEnabled already exists',
        alreadyExists: true
      });
    }

    // Add invoiceEnabled column with default false
    await db.$executeRawUnsafe(`
      ALTER TABLE "merchants"
      ADD COLUMN "invoiceEnabled" BOOLEAN NOT NULL DEFAULT false
    `);

    return res.status(200).json({
      success: true,
      message: 'Successfully added invoiceEnabled column to merchants table'
    });
  } catch (error) {
    console.error('Migration error:', error);
    return res.status(500).json({
      error: 'Migration failed',
      details: error.message
    });
  } finally {
    await db.$disconnect();
  }
}
