// Check which environment variables are available
export default async function handler(req, res) {
  // Only allow in development or with special header
  const isDev = process.env.NODE_ENV === 'development';
  const authHeader = req.headers['x-admin-check'];

  if (!isDev && authHeader !== 'stablepay-admin-check') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const envVars = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    DIRECT_URL: !!process.env.DIRECT_URL,
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    ALLOWED_ORIGINS: !!process.env.ALLOWED_ORIGINS,
    NODE_ENV: process.env.NODE_ENV || 'not set'
  };

  // Show first/last 10 chars of sensitive values if they exist
  const details = {};
  if (process.env.DATABASE_URL) {
    details.DATABASE_URL = `${process.env.DATABASE_URL.substring(0, 20)}...${process.env.DATABASE_URL.slice(-15)}`;
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    details.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
  if (process.env.SUPABASE_ANON_KEY) {
    details.SUPABASE_ANON_KEY = `${process.env.SUPABASE_ANON_KEY.substring(0, 20)}...${process.env.SUPABASE_ANON_KEY.slice(-15)}`;
  }

  return res.status(200).json({
    message: 'Environment variable check',
    available: envVars,
    details: details,
    timestamp: new Date().toISOString()
  });
}
