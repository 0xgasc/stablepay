import { z } from 'zod';

/**
 * Environment variable schema
 * Validates all required environment variables at startup
 */
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),
  DIRECT_URL: z.string().url('DIRECT_URL must be a valid PostgreSQL connection string').optional(),

  // Server
  PORT: z.string().regex(/^\d+$/, 'PORT must be a number').default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // CORS
  CORS_ORIGIN: z.string().default('*'),

  // Optional: Stripe for billing (future)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Optional: Logging services
  SENTRY_DSN: z.string().url().optional(),
  DATADOG_API_KEY: z.string().optional(),

  // Security
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters').optional(),

  // Admin authentication (required for production)
  ADMIN_EMAIL: z.string().email('ADMIN_EMAIL must be a valid email').optional(),
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters').optional(),
  ADMIN_API_TOKEN: z.string().min(32, 'ADMIN_API_TOKEN must be at least 32 characters for security').optional(),

  // CORS origins
  ALLOWED_ORIGINS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate environment variables at startup
 * Throws error if any required variables are missing or invalid
 */
export function validateEnv(): Env {
  try {
    const env = envSchema.parse(process.env);

    console.log('✅ Environment variables validated successfully');
    console.log(`   - NODE_ENV: ${env.NODE_ENV}`);
    console.log(`   - PORT: ${env.PORT}`);
    console.log(`   - DATABASE_URL: ${env.DATABASE_URL ? '✓ Set' : '✗ Missing'}`);

    // Warn about missing admin credentials (critical for production)
    const adminVars = {
      ADMIN_EMAIL: env.ADMIN_EMAIL,
      ADMIN_PASSWORD: env.ADMIN_PASSWORD,
      ADMIN_API_TOKEN: env.ADMIN_API_TOKEN,
    };

    const missingAdminVars = Object.entries(adminVars)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingAdminVars.length > 0) {
      console.warn('⚠️  Missing admin authentication variables:');
      missingAdminVars.forEach((key) => {
        console.warn(`   - ${key}`);
      });
      console.warn('   Admin panel login will not work without these!');
      console.warn('   Set these in your Vercel environment variables.');
    } else {
      console.log('   - Admin auth: ✓ Configured');
    }

    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment variable validation failed:');
      error.errors.forEach((err) => {
        console.error(`   - ${err.path.join('.')}: ${err.message}`);
      });
      throw new Error('Invalid environment configuration. Check .env file.');
    }
    throw error;
  }
}

/**
 * Get validated environment variables
 * Call validateEnv() first to ensure variables are valid
 */
export function getEnv(): Env {
  return envSchema.parse(process.env);
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Check if running in test
 */
export function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}
