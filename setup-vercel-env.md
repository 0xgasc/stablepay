# Setting up Vercel Environment Variables

## Critical Issue
Your database isn't connecting because Vercel doesn't have the DATABASE_URL environment variable!

## Quick Fix - Add these to Vercel:

1. Go to: https://vercel.com/dashboard
2. Select your `stablepay` project
3. Go to Settings → Environment Variables
4. Add this variable:

```
DATABASE_URL = postgresql://postgres.lxbrsiujmntrvzqdphhj:Madrid2025!@aws-1-eu-west-3.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

5. Click "Save"
6. **IMPORTANT**: Redeploy by going to Deployments tab → Click 3 dots on latest → Redeploy

## Test the API
After redeploying, test these URLs:
- https://stablepay-nine.vercel.app/api/test (should show "API is working")
- https://stablepay-nine.vercel.app/api/orders (should return orders or empty array)

## Alternative: Use Vercel CLI
```bash
vercel env add DATABASE_URL
# Paste the database URL when prompted
vercel --prod
```