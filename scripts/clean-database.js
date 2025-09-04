import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function cleanDatabase() {
  try {
    console.log('🧹 Cleaning database...');
    
    // Delete all transactions first (due to foreign key)
    const deletedTx = await prisma.transaction.deleteMany({});
    console.log(`✅ Deleted ${deletedTx.count} transactions`);
    
    // Delete all orders
    const deletedOrders = await prisma.order.deleteMany({});
    console.log(`✅ Deleted ${deletedOrders.count} orders`);
    
    console.log('🎉 Database cleaned successfully!');
  } catch (error) {
    console.error('❌ Error cleaning database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanDatabase();