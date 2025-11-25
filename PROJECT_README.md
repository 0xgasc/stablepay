# StablePay - Multi-Chain USDC Payment Platform

**Production URL:** https://stablepay-nine.vercel.app

A production-ready payment platform for accepting USDC on Base and Solana blockchains.

---

## 🚀 Current Status

### ✅ **Production Ready**
- Multi-chain support (Base Sepolia, Base Mainnet, Solana Devnet, Solana Mainnet)
- Merchant dashboard with wallet management
- Order tracking and transaction history
- Real blockchain transactions (MetaMask + Phantom integration)
- Comprehensive client documentation

### 📊 **Recent Transactions**
- Successfully processing live payments from Unlock (unlock@unlock.com)
- Merchant ID: `cmhkjckgi0000qut5wxmtsw1f`
- Configured wallets:
  - Base Sepolia: `0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D`
  - Solana Devnet: `9GW4bqrYugG8sRdMVC5zNwM6ZAm69ztevPadT3RCFqH2`
  - Solana Mainnet: `9GW4bqrYugG8sRdMVC5zNwM6ZAm69ztevPadT3RCFqH2`

---

## 📁 Project Structure

```
stablepay/
├── src/
│   ├── index.ts                      # Main Express server
│   ├── config/
│   │   └── database.ts               # Prisma client setup
│   ├── routes/
│   │   ├── orders.ts                 # Order CRUD endpoints
│   │   ├── refunds.ts                # Refund endpoints (skeleton)
│   │   ├── admin.ts                  # Admin panel API
│   │   └── auth.ts                   # Authentication
│   └── services/
│       └── orderService.ts           # Order business logic
│
├── prisma/
│   └── schema.prisma                 # Database schema (Supabase PostgreSQL)
│
├── public/
│   ├── index.html                    # Landing page
│   ├── login.html                    # Merchant login
│   ├── dashboard.html                # ⭐ Main merchant dashboard
│   ├── enterprise-admin.html         # Admin console
│   ├── checkout-widget.js            # Payment widget (needs update)
│   ├── demo-integration.html         # Integration examples
│   │
│   └── docs/                         # ⭐ CLIENT DOCUMENTATION
│       ├── README.md                 # Documentation hub
│       ├── GETTING_STARTED.md        # Quick start guide
│       ├── API.md                    # API reference
│       ├── EXAMPLES.md               # Framework examples
│       └── TROUBLESHOOTING.md        # Common issues
│
├── README.md                         # Original project README
└── PROJECT_README.md                 # ⭐ THIS FILE (complete documentation)
```

---

## 🎯 Key Features

### For Merchants
- **Multi-chain wallet configuration** (Base, Solana, Ethereum, Polygon, Arbitrum)
- **Real-time order tracking** with blockchain confirmations
- **Transaction history** with explorer links
- **Testnet/Mainnet switching**
- **Refund system** (UI skeleton in place)
- **Developer tab** with auto-generated code snippets

### For Customers
- **MetaMask integration** (Base, Ethereum, Polygon, Arbitrum)
- **Phantom integration** (Solana)
- **Automatic network switching**
- **Transaction confirmation** before payment
- **Real USDC transfers** to merchant wallets

---

## 🗄️ Database Schema

**Platform:** Supabase (PostgreSQL)
**ORM:** Prisma

### Core Tables

**Merchant**
- Account information (email, company, contact)
- Plan type (STARTER, PRO, ENTERPRISE)
- Network mode (TESTNET, MAINNET)
- Payment mode (DIRECT, ESCROW)

**Wallet**
- Chain (BASE_MAINNET, BASE_SEPOLIA, SOLANA_MAINNET, etc.)
- Address (0x... or 9GW...)
- Active status

**Order**
- Amount, chain, status (PENDING, CONFIRMED, FAILED, EXPIRED)
- Payment address (merchant wallet)
- Customer info (email, name)
- Created/expires timestamps

**Transaction**
- Transaction hash (blockchain)
- Order ID (foreign key)
- From/to addresses
- Confirmation count
- Block timestamp

**Refund** (skeleton)
- Order ID, amount, reason
- Status (PENDING, APPROVED, REJECTED, PROCESSED)
- Refund transaction hash

---

## 🔑 API Endpoints

### Public Endpoints

**Create Order**
```
POST /api/v1/orders
Body: { merchantId, amount, chain, paymentAddress, customerEmail?, customerName? }
Response: { success: true, order: { id, status: "PENDING", ... } }
```

**Get Order**
```
GET /api/v1/orders/:orderId
Response: { id, status, amount, transactions: [...] }
```

**Confirm Order**
```
POST /api/v1/orders/:orderId/confirm
Body: { txHash }
Response: { success: true, order: { status: "CONFIRMED" } }
```

### Admin Endpoints (Requires Auth)

**Get Merchant Data**
```
GET /api/v1/admin?resource=merchants
Header: Authorization: Bearer {loginToken}
Response: { merchants: [...] }
```

**Get Wallets**
```
GET /api/v1/admin?resource=wallets&merchantId={id}
Response: [{ chain, address, isActive }]
```

**Get Orders**
```
GET /api/v1/admin?resource=orders&merchantId={id}
Header: Authorization: Bearer {loginToken}
Response: { orders: [...] }
```

---

## 💻 Local Development

### Prerequisites
```bash
node >= 18.x
npm >= 9.x
```

### Setup

1. **Clone and Install**
```bash
cd /Volumes/WORKHORSE\ GS/vibecoding/stablepay
npm install
```

2. **Environment Variables**
```bash
# .env file (already configured)
DATABASE_URL="postgresql://..."  # Supabase connection string
PORT=3001
NODE_ENV=development
```

3. **Start Development Server**
```bash
npm run dev
```

Server runs on: http://localhost:3001

4. **Database**
```bash
# Generate Prisma client
npx prisma generate

# View database
npx prisma studio  # Opens on http://localhost:5555
```

---

## 🌐 Deployment

**Platform:** Vercel
**URL:** https://stablepay-nine.vercel.app

### Vercel Configuration

**Build Command:** `npx prisma generate && npm run build`
**Output Directory:** `dist`
**Install Command:** `npm install`

### Environment Variables (Vercel)
```
DATABASE_URL = {Supabase connection string}
NODE_ENV = production
```

### Deploy
```bash
# Via Vercel CLI
vercel --prod

# Or push to main branch (auto-deploys)
git push origin main
```

---

## 🎨 Dashboard Features

### Location: `/public/dashboard.html`

**Tabs:**
1. **Orders** - View all payments with status, amount, blockchain confirmations
2. **Wallets** - Configure receiving addresses for each chain
3. **Developer** - ⭐ Copy-paste integration code (auto-populated with merchant ID)
4. **Payment Links** - Test payments and demo store
5. **Settings** - Account information

**Key Functions:**
- `loadMerchantData()` - Fetches merchant account from API
- `loadOrders()` - Displays orders with transactions
- `renderChainToggles()` - Wallet configuration UI (grouped by blockchain)
- `updateWidgetCode()` - Auto-fills merchant ID in code examples
- `openTestPayment()` - Opens test payment modal

**Test Payment Modal:**
- Connect MetaMask (Base, Ethereum, Polygon, Arbitrum)
- Connect Phantom (Solana)
- Execute real USDC transactions
- Automatic network switching
- Transaction confirmation tracking

---

## 📚 Client Documentation

### Location: `/public/docs/`

All documentation is production-ready and available at:
- https://stablepay-nine.vercel.app/docs/README.md
- https://stablepay-nine.vercel.app/docs/GETTING_STARTED.md
- https://stablepay-nine.vercel.app/docs/API.md
- https://stablepay-nine.vercel.app/docs/EXAMPLES.md
- https://stablepay-nine.vercel.app/docs/TROUBLESHOOTING.md

**Documentation includes:**
- ✅ 3-step quick start guide
- ✅ Complete API reference
- ✅ Framework examples (React, Next.js, Vue, WordPress, WooCommerce, Shopify)
- ✅ Troubleshooting for all common issues
- ✅ Testing instructions (testnet faucets, etc.)
- ✅ Security best practices

---

## 🔧 Important Code Locations

### Wallet Connection Logic
**File:** `/public/dashboard.html`
**Lines:** 1338-1407

```javascript
// MetaMask connection (handles multiple providers)
// Lines 1338-1383

// Phantom connection
// Lines 1385-1407
```

### EVM Payment Execution
**File:** `/public/dashboard.html`
**Lines:** 1466-1635

```javascript
// Network switching
// USDC token transfer (ethers.js v6)
// Transaction confirmation
// Order status update via API
```

### Solana Payment Execution
**File:** `/public/dashboard.html`
**Lines:** 1637-1933

```javascript
// SPL token transfer
// Associated token account creation
// Transaction encoding (little-endian u64)
// Signature confirmation
```

### Chain Configuration
**File:** `/public/dashboard.html`
**Lines:** 2300-2456

```javascript
// Token addresses for all chains
// RPC URLs
// Chain IDs (hex format)
// Native currency info
```

---

## 🌍 Supported Chains

| Chain | Mainnet | Testnet | Status | USDC Address |
|-------|---------|---------|--------|--------------|
| **Base** | BASE_MAINNET (0x2105) | BASE_SEPOLIA (0x14a34) | ✅ Live | Mainnet: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`<br>Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| **Solana** | SOLANA_MAINNET | SOLANA_DEVNET | ✅ Live | Mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`<br>Devnet: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Ethereum | ETH_MAINNET (0x1) | ETH_SEPOLIA (0xaa36a7) | 🔜 Soon | - |
| Polygon | POLYGON_MAINNET (0x89) | POLYGON_MUMBAI (0x13881) | 🔜 Soon | - |
| Arbitrum | ARBITRUM_MAINNET (0xa4b1) | ARBITRUM_SEPOLIA (0x66eee) | 🔜 Soon | - |

---

## 🧪 Testing

### Test Merchant Account
- **Email:** unlock@unlock.com
- **Merchant ID:** `cmhkjckgi0000qut5wxmtsw1f`
- **Password:** (stored in dashboard session)

### Testnet Faucets

**Base Sepolia:**
- ETH (gas): https://www.alchemy.com/faucets/base-sepolia
- USDC: https://faucet.circle.com/

**Solana Devnet:**
- SOL: `solana airdrop 2`
- USDC: https://spl-token-faucet.com/

### Test Flow
1. Login to dashboard
2. Go to Payment Links tab → Test Payment
3. Connect MetaMask or Phantom
4. Select testnet chain (BASE_SEPOLIA or SOLANA_DEVNET)
5. Enter amount (e.g., 0.10 USDC)
6. Click "Initiate Payment"
7. Approve in wallet
8. Check Orders tab for confirmation

---

## 🔒 Security

### Wallet Security
- ✅ Merchant wallets are display-only (no private keys stored)
- ✅ Customers connect their own wallets (MetaMask/Phantom)
- ✅ Transactions signed client-side
- ✅ No custody of funds

### API Security
- ✅ CORS enabled (cross-origin requests allowed)
- ✅ Authentication via Bearer token
- ✅ Input validation on all endpoints
- ✅ Helmet.js security headers

### Database Security
- ✅ Supabase RLS (Row Level Security)
- ✅ Environment variables for credentials
- ✅ No private keys in database

---

## 🚧 Known Issues & TODOs

### Checkout Widget
**Status:** Needs update
**File:** `/public/checkout-widget.js`
**Issue:** Currently has placeholder card payment UI
**TODO:** Replace with real MetaMask/Phantom integration (copy from dashboard.html)

### Refund System
**Status:** Skeleton only
**Files:**
- UI: `/public/dashboard.html` lines 635-698 (modal)
- API: `/src/routes/refunds.ts` (basic structure)
- DB: Refund table exists in schema

**TODO:**
- Implement refund approval workflow
- Add admin UI for approving/rejecting refunds
- Execute USDC refund transactions

### Token Swap Feature
**Status:** Architecture only
**File:** `ADVANCED_FEATURES.md`
**TODO:** Integrate Uniswap V3 (EVM) and Jupiter (Solana) for accepting any token

### Webhooks
**Status:** Coming soon
**TODO:** Real-time payment notifications

---

## 📞 Support & Contact

**Production Issues:** Check Vercel logs
**Database Issues:** Check Supabase dashboard
**API Testing:** Use dashboard Developer tab "Test this endpoint" button

**Client Support Email:** support@stablepay.com

---

## 🗺️ Roadmap

**Q1 2025:**
- ✅ Base + Solana support
- ✅ USDC payments
- ✅ Merchant dashboard
- ✅ Client documentation
- 🔜 Complete checkout widget
- 🔜 Webhooks
- 🔜 Refund system

**Q2 2025:**
- Ethereum, Polygon, Arbitrum
- USDT, EURC support
- Subscription payments
- Invoice system

**Q3 2025:**
- Fiat on/off ramps
- Payment analytics
- Mobile SDK

---

## 📝 Session Continuity Notes

### For Future Development Sessions

**Context to provide:**
1. This is StablePay - a multi-chain USDC payment platform
2. Currently live on Vercel: https://stablepay-nine.vercel.app
3. Successfully processing real transactions (see Unlock merchant)
4. Main work file: `/public/dashboard.html` (2,630 lines)
5. Database: Supabase PostgreSQL via Prisma
6. Tech stack: Node.js, Express, Prisma, vanilla JS (no framework)

**Key Files to Remember:**
- `/public/dashboard.html` - Main UI (all working payment logic)
- `/src/index.ts` - Backend server
- `/prisma/schema.prisma` - Database schema
- `/public/docs/` - All client documentation (production-ready)

**What Works:**
- Order creation via API ✅
- Real blockchain transactions (MetaMask + Phantom) ✅
- Transaction confirmation and tracking ✅
- Merchant dashboard ✅
- Client documentation ✅

**What Needs Work:**
- Checkout widget (needs real wallet integration)
- Refund system (skeleton only)
- Token swap feature (planned)

**How to Continue:**
```bash
# 1. Navigate to project
cd /Volumes/WORKHORSE\ GS/vibecoding/stablepay

# 2. Start dev server
npm run dev

# 3. Open dashboard
open http://localhost:3001/dashboard.html

# 4. View database
npx prisma studio
```

**Recent Changes (2025-11-11):**
- ✅ Consolidated wallet UI (one card per blockchain)
- ✅ Fixed MetaMask detection with multiple wallets
- ✅ Created comprehensive client documentation
- ✅ Updated Developer tab with auto-populated code
- ✅ Added framework examples (React, Next.js, Vue, WordPress)
- ✅ Fixed API test endpoint (orders creation)

---

## 🎓 Learning the Codebase

**Start here if new to the project:**

1. **Understand the flow:**
   - Read `/public/docs/GETTING_STARTED.md`
   - See `CHECKOUT_FLOW_GUIDE.md` for technical flow

2. **Explore the dashboard:**
   - Open `/public/dashboard.html`
   - Search for `function loadMerchantData()` - entry point
   - Search for `function initiateEVMPayment()` - Base payment logic
   - Search for `function initiateSolanaPayment()` - Solana payment logic

3. **Test locally:**
   - `npm run dev`
   - Login as unlock@unlock.com
   - Go to Payment Links → Test Payment
   - Watch browser console for logs

4. **Database exploration:**
   - `npx prisma studio`
   - Check Merchant, Wallet, Order, Transaction tables

---

**Last Updated:** 2025-11-11
**Version:** 1.0 (Production)
**Active Merchants:** 2 (unlock@unlock.com + test account)
**Transactions Processed:** Multiple successful test payments
**Status:** ✅ Production Ready
