# StablePay Deployment Guide

## Current Status ✅

### Completed Features
1. **Refund System** - Full single and batch refund functionality
2. **Trust Center** - Complete security and compliance page
3. **Dashboard** - Enhanced with refund capabilities
4. **API Endpoints** - All refund endpoints implemented

### Ready for Deployment
- ✅ Backend refund API (`/src/routes/refunds.ts`)
- ✅ Frontend refund UI (`/public/dashboard.html`)
- ✅ Trust center page (`/public/trust.html`)
- ✅ Updated landing page (`/public/index.html`)

---

## Pre-Deployment Checklist

### 1. Environment Variables
Ensure these are set in Vercel:

```bash
# Database
DATABASE_URL="your-postgres-connection-string"

# API Keys (if needed)
# Add any API keys for blockchain RPC endpoints if using custom ones

# Admin Credentials (for initial setup)
DEFAULT_ADMIN_EMAIL="admin@stablepay.com"
DEFAULT_ADMIN_PASSWORD="SecurePassword123!"
DEFAULT_ADMIN_NAME="Admin"
```

### 2. Database Schema
The refund system requires the `Refund` model in your Prisma schema. Verify it exists:

```prisma
model Refund {
  id            String        @id @default(cuid())
  orderId       String
  amount        Decimal       @db.Decimal(18, 6)
  reason        String
  status        RefundStatus  @default(PENDING)
  refundTxHash  String?
  approvedBy    String?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  order         Order         @relation(fields: [orderId], references: [id])

  @@index([orderId])
  @@index([status])
}

enum RefundStatus {
  PENDING
  APPROVED
  REJECTED
  PROCESSING
  COMPLETED
  FAILED
}
```

### 3. Run Database Migration

```bash
# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Or create and run migration
npx prisma migrate dev --name add-refund-system
```

---

## Deployment Steps

### Option 1: Deploy to Vercel (Recommended)

#### Step 1: Install Vercel CLI
```bash
npm i -g vercel
```

#### Step 2: Login to Vercel
```bash
vercel login
```

#### Step 3: Deploy
```bash
cd /Volumes/WORKHORSE\ GS/vibecoding/stablepay
vercel
```

Follow prompts:
- Set up and deploy? **Yes**
- Which scope? Select your account
- Link to existing project? **Yes** (if updating) or **No** (if new)
- What's your project's name? **stablepay**
- In which directory is your code located? **./src**
- Want to override settings? **No**

#### Step 4: Set Environment Variables
```bash
vercel env add DATABASE_URL
# Paste your database connection string

vercel env add DEFAULT_ADMIN_EMAIL
vercel env add DEFAULT_ADMIN_PASSWORD
vercel env add DEFAULT_ADMIN_NAME
```

#### Step 5: Deploy to Production
```bash
vercel --prod
```

### Option 2: Deploy via Vercel Dashboard

1. Go to https://vercel.com/dashboard
2. Click "Add New" → "Project"
3. Import your Git repository
4. Configure:
   - **Framework Preset**: Other
   - **Root Directory**: `./`
   - **Build Command**: `npm run build` or leave default
   - **Output Directory**: `public`
5. Add environment variables in project settings
6. Click "Deploy"

---

## Post-Deployment Tasks

### 1. Verify Deployment

#### Check Homepage
```
https://stablepay-nine.vercel.app/
```
- [ ] Landing page loads
- [ ] Trust & Security section visible
- [ ] "Security" link in navigation works

#### Check Trust Center
```
https://stablepay-nine.vercel.app/trust.html
```
- [ ] Page loads correctly
- [ ] All 7 accordion sections work
- [ ] Footer links functional

#### Check Dashboard
```
https://stablepay-nine.vercel.app/dashboard.html
```
- [ ] Login works
- [ ] Orders table displays
- [ ] Refund modal opens
- [ ] Batch refund section visible

#### Check API Endpoints
```bash
# Test refund creation
curl -X POST https://stablepay-nine.vercel.app/api/refunds \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "test_order_id",
    "amount": "10.00",
    "reason": "Test refund",
    "status": "PENDING"
  }'

# Test refund stats
curl https://stablepay-nine.vercel.app/api/refunds/stats
```

### 2. Test Refund System on Testnet

#### Single Refund Test (Base Sepolia)
1. Create test order with USDC payment
2. Wait for confirmation
3. Open refund modal
4. Connect MetaMask to Base Sepolia
5. Execute refund
6. Verify transaction on BaseScan Sepolia
7. Check refund record in dashboard

#### Batch Refund Test (Base Sepolia)
1. Create 3-5 test orders
2. Add all to batch refund
3. Connect MetaMask
4. Execute batch refund
5. Verify single Multicall3 transaction
6. Check all refund records created

#### Solana Refund Test (Devnet)
1. Create test order on Solana Devnet
2. Open refund modal
3. Connect Phantom wallet
4. Execute refund
5. Verify on Solscan Devnet

### 3. Monitor Logs

Check Vercel logs for errors:
```bash
vercel logs
```

Or visit: https://vercel.com/dashboard → Your Project → Logs

---

## Testing Checklist

### Core Functionality
- [ ] Merchant signup works
- [ ] Merchant login works
- [ ] Create payment order
- [ ] Customer pays with MetaMask (testnet)
- [ ] Customer pays with Phantom (testnet)
- [ ] Webhook confirmation works
- [ ] Order status updates to CONFIRMED

### Refund System
- [ ] Single refund - EVM chains
- [ ] Single refund - Solana
- [ ] Batch refund - Multiple orders same chain
- [ ] Batch refund validation (mixed chains fail correctly)
- [ ] Refund amount validation (can't exceed order)
- [ ] Partial refund works
- [ ] Transaction hash recorded correctly
- [ ] Refund stats endpoint accurate

### Trust Center
- [ ] Trust center page loads
- [ ] All accordions expand/collapse
- [ ] Links work (security email, GitHub, etc.)
- [ ] Mobile responsive
- [ ] Footer consistent across pages

### Security
- [ ] API endpoints protected (if auth required)
- [ ] SQL injection protection (Prisma handles this)
- [ ] XSS protection (input sanitization)
- [ ] HTTPS enforced (Vercel handles this)

---

## Troubleshooting

### Issue: Database Connection Error
**Solution**: Check `DATABASE_URL` in Vercel environment variables
```bash
vercel env ls
```

### Issue: Refund API Returns 404
**Solution**: Verify routes are registered in `/src/index.ts`
```typescript
app.use('/api/refunds', refundsRouter);
```

### Issue: MetaMask Can't Connect
**Solution**:
- Check HTTPS is enabled (required for Web3)
- Verify network IDs match (Base Sepolia: 84532)
- Check USDC contract addresses in `getChainConfig()`

### Issue: Batch Refund Fails
**Solution**:
- Ensure all orders on same chain
- Verify Multicall3 address: `0xcA11bde05977b3631167028862bE2a173976CA11`
- Check wallet has sufficient USDC balance
- Verify gas funds available

### Issue: Solana Transfer Fails
**Solution**:
- Check using correct USDC mint address (Devnet vs Mainnet)
- Verify token accounts exist for sender and recipient
- Ensure sufficient SOL for gas fees

---

## Production Checklist

### Before Going Live
- [ ] Update USDC addresses to mainnet (not testnet)
- [ ] Update Solana RPC to mainnet
- [ ] Set up monitoring (Sentry, LogRocket, etc.)
- [ ] Configure custom domain
- [ ] Set up SSL/TLS (Vercel auto-provisions)
- [ ] Create privacy policy page
- [ ] Create terms of service page
- [ ] Set up status page (status.stablepay.io)
- [ ] Configure email for security@ and support@
- [ ] Enable error tracking
- [ ] Set up uptime monitoring
- [ ] Test all payment flows on mainnet with small amounts

### Mainnet Configuration Changes

#### Update Token Addresses
In `/public/dashboard.html`, update `getChainConfig()`:
```javascript
// Change from testnet to mainnet
'BASE_MAINNET': {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    // ... use mainnet addresses
}
```

#### Update Solana Cluster
In refund functions, change:
```javascript
// From:
solanaWeb3.clusterApiUrl('devnet')

// To:
solanaWeb3.clusterApiUrl('mainnet-beta')

// And update USDC mint:
const usdcMint = new solanaWeb3.PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
```

---

## Monitoring & Maintenance

### Set Up Alerts
1. **Uptime monitoring**: UptimeRobot (free tier)
2. **Error tracking**: Sentry (free tier)
3. **Log aggregation**: Vercel built-in logs

### Regular Tasks
- **Daily**: Check error logs
- **Weekly**: Review refund transactions
- **Monthly**: Security audit review
- **Quarterly**: Update dependencies
- **Annually**: Renew SSL certificates (auto with Vercel)

---

## Next Steps After Deployment

### Immediate (Week 1)
1. Deploy to Vercel production
2. Test all features on testnet
3. Monitor for errors
4. Create privacy policy and terms pages
5. Set up support email

### Short-term (Month 1)
1. Onboard first test merchants
2. Process real testnet transactions
3. Collect feedback
4. Fix any bugs discovered
5. Set up analytics (Google Analytics, Mixpanel)

### Medium-term (Quarter 1)
1. Launch on mainnet
2. Marketing push
3. Add more chains (Optimism, Avalanche, etc.)
4. Enhanced analytics dashboard
5. Customer support system

### Long-term (Year 1)
1. SOC 2 Type II certification
2. Scale infrastructure
3. Add fiat off-ramp options
4. Multi-currency support (USDT, EURC expansion)
5. Enterprise features

---

## Important Files Reference

### Backend
- `/src/routes/refunds.ts` - Refund API endpoints
- `/src/index.ts` - Main server file (verify routes registered)
- `/prisma/schema.prisma` - Database schema

### Frontend
- `/public/index.html` - Landing page with trust signals
- `/public/trust.html` - Trust center page
- `/public/dashboard.html` - Merchant dashboard with refund UI
- `/public/login.html` - Login page
- `/public/signup.html` - Signup page

### Documentation
- `/REFUND_IMPLEMENTATION_COMPLETE.md` - Refund system docs
- `/TRUST_CENTER_IMPLEMENTATION_COMPLETE.md` - Trust center docs
- `/REFUND_SYSTEM_DESIGN.md` - Original refund design
- `/TRUST_CENTER_DESIGN.md` - Original trust center design
- `/DEPLOYMENT_GUIDE.md` - This file

---

## Support Contacts

**Security Issues**: security@stablepay.io
**General Support**: support@stablepay.io
**GitHub**: https://github.com/stablepay

---

## Summary

✅ **All features implemented and ready**
✅ **Documentation complete**
✅ **Deployment guide prepared**
✅ **Testing checklist created**
✅ **Production checklist ready**

**Next Action**: Run deployment command and start testing on testnet!

```bash
cd /Volumes/WORKHORSE\ GS/vibecoding/stablepay
vercel --prod
```

Good luck with the deployment! 🚀
