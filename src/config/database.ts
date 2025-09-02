import { PrismaClient } from '@prisma/client';

declare global {
  var __db__: PrismaClient | undefined;
}

// Create Prisma client with pgbouncer-compatible settings
const prismaClientSingleton = () => {
  return new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    },
    // Add pgbouncer compatibility
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
};

// Ensure single instance in development
const db = globalThis.__db__ ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__db__ = db;
}

export { db };