# StablePay Documentation

## Overview
StablePay is a multi-tenant SaaS payment platform that enables businesses to accept USDC (stablecoin) payments across multiple blockchain networks.

## Current Architecture

### Core Features
- **Multi-tenant SaaS**: Each merchant has their own account with isolated data
- **Multi-chain Support**: 10 chains (5 testnet, 5 mainnet) including Solana and EVM chains
- **Email/Password Authentication**: Simple registration and login flow
- **Merchant Dashboard**: Company-specific dashboard for managing payments
- **Payment Links**: Generate payment links with QR codes

### Database Schema (Supabase PostgreSQL)

#### Tables
1. **merchants**
   - id, email, companyName, contactName
   - passwordHash (for authentication)
   - role (MERCHANT/ADMIN)
   - plan, paymentMode, networkMode
   - loginToken, tokenExpiresAt
   - isActive, setupCompleted

2. **merchant_wallets**
   - id, merchantId, chain, address
   - isActive

3. **orders**
   - id, merchantId, orderId, amount, currency
   - chain, status, walletAddress
   - customerEmail, transactionHash
   - createdAt, updatedAt

### API Endpoints

#### Active/In-Use
- `/api/register-minimal.js` - Registration endpoint (ACTIVE)
- `/api/login.js` - Authentication endpoint (ACTIVE)
- `/api/merchant.js` - Get/update merchant data (ACTIVE)
- `/api/orders-simple.js` - Order management (ACTIVE)

#### Test/Debug Endpoints (Can be removed?)
- `/api/register.js` - Original registration with complex hashing
- `/api/register-simple-test.js` - Test endpoint
- `/api/test-db.js` - Database connection test
- `/api/test-supabase.js` - Supabase connectivity test

### Frontend Pages

#### Core Pages
- `/index.html` - Landing page with registration
- `/login.html` - Login page
- `/dashboard.html` - Merchant dashboard
- `/admin.html` - Admin panel for system management
- `/payment-link.html` - Payment link generator

#### Demo/Test Pages (Can be removed?)
- `/demo.html` - Demo store
- `/setup.html` - Initial setup wizard (unused?)

### Authentication Flow
1. Register with email/password → passwordHash saved to DB
2. Login validates password → generates loginToken
3. Dashboard checks sessionStorage for merchantId/token
4. All merchant-specific data loaded via API

### Payment Flow
1. Merchant creates payment link with amount
2. QR code generated for easy sharing
3. Customer scans and pays in USDC
4. Transaction recorded in orders table
5. Merchant sees payment in dashboard

## Files to Clean Up

### SQL Files (Can be consolidated?)
- `add-password-field.sql`
- `clean-duplicate.sql`
- `clean-merchants.sql`
- `clean-no-password.sql`
- `sql-fix.sql`

### Test API Endpoints
- `/api/register-simple-test.js`
- `/api/test-db.js`
- `/api/test-supabase.js`
- `/api/register.js` (replaced by register-minimal.js)

### Unused Pages?
- `/setup.html` - Not referenced in current flow
- `/demo.html` - Old demo page?

## Environment Variables Needed
- Supabase URL: https://lxbrsiujmntrvzqdphhj.supabase.co
- Supabase Anon Key: (stored in code currently)

## Deployment
- GitHub: https://github.com/0xgasc/stablepay
- Vercel: https://stablepay-nine.vercel.app
- Database: Supabase

## Next Steps
1. Remove test endpoints
2. Consolidate SQL files
3. Move API keys to environment variables
4. Add proper error handling
5. Implement actual payment processing with crypto wallets