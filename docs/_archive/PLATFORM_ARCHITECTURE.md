# StablePay Platform Architecture (Crossmint-Style)

## Core Products to Build

### 1. **Wallet Infrastructure**
- Invisible wallets for customers (no seed phrases)
- Social login (Google, Apple, email)
- Multi-chain support (EVM + Solana)
- Gas sponsorship for users
- Custodial and non-custodial options

### 2. **Digital Asset Checkout**
- Embedded checkout widget (like Stripe)
- Accept credit cards, crypto, stablecoins
- One-line integration for developers
- Customizable UI to match brand
- Mobile-optimized

### 3. **Onramps & Offramps**
- Fiat to USDC conversion (onramp)
- USDC to fiat withdrawal (offramp)
- Bank transfers and card payments
- KYC/AML compliance built-in

### 4. **Developer APIs**

```javascript
// Example API Usage
const stablepay = new StablePay('sk_live_xxx');

// Create customer wallet
const wallet = await stablepay.wallets.create({
  email: 'user@example.com',
  chain: 'base'
});

// Create checkout session
const checkout = await stablepay.checkout.create({
  amount: 100,
  currency: 'USDC',
  recipient: wallet.address,
  successUrl: 'https://merchant.com/success'
});

// Onramp fiat to USDC
const onramp = await stablepay.onramp.create({
  amount: 100,
  currency: 'USD',
  paymentMethod: 'card',
  destination: wallet.address
});
```

## API Endpoints to Build

### Authentication
- `POST /api/v1/auth/api-keys` - Generate API keys
- `POST /api/v1/auth/verify` - Verify API key

### Wallets
- `POST /api/v1/wallets` - Create wallet
- `GET /api/v1/wallets/:id` - Get wallet details
- `GET /api/v1/wallets/:id/balance` - Get balance
- `POST /api/v1/wallets/:id/transfer` - Transfer funds

### Checkout
- `POST /api/v1/checkout/sessions` - Create checkout
- `GET /api/v1/checkout/sessions/:id` - Get session
- `POST /api/v1/checkout/embed` - Generate embed code

### Onramps/Offramps
- `POST /api/v1/onramp/quote` - Get conversion quote
- `POST /api/v1/onramp/create` - Create onramp
- `POST /api/v1/offramp/create` - Create offramp
- `GET /api/v1/transactions/:id` - Get transaction status

### Webhooks
- `POST /api/v1/webhooks` - Register webhook
- `POST /api/v1/webhooks/test` - Test webhook

## Embedded Checkout Widget

```html
<!-- One-line integration -->
<script src="https://stablepay.com/checkout.js"></script>
<div
  class="stablepay-checkout"
  data-amount="100"
  data-currency="USDC"
  data-merchant="merchant_id"
></div>
```

## Database Schema Updates

### New Tables Needed

**customer_wallets**
- id, email, walletAddress
- chain, createdAt
- lastActivity

**checkout_sessions**
- id, merchantId, amount
- currency, status
- customerEmail, walletAddress
- successUrl, cancelUrl
- metadata

**onramp_transactions**
- id, customerId, amount
- sourceCurrency, destinationCurrency
- paymentMethod, status
- fiatAmount, cryptoAmount
- exchangeRate

**api_keys**
- id, merchantId
- key, secret
- permissions, rateLimit
- createdAt, lastUsed

**webhooks**
- id, merchantId
- url, events
- secret, isActive

## Tech Stack
- **Frontend**: React for dashboard, Vanilla JS for widget
- **Backend**: Node.js/Express APIs
- **Database**: Supabase PostgreSQL
- **Blockchain**: Web3.js, Ethers.js, Solana Web3
- **Payments**: Stripe for fiat, direct crypto
- **KYC**: Sumsub or Jumio integration

## Competitive Advantages
1. **USDC-focused** - Specialized in stablecoin payments
2. **Lower fees** - 1% vs Crossmint's 2.5%
3. **Instant settlement** - Direct to merchant wallets
4. **Better developer experience** - Simpler APIs
5. **Open source components** - Build trust

## Revenue Model
- Transaction fees: 1% on payments
- Onramp fees: 1.5% markup
- Offramp fees: 1%
- Enterprise plans: Custom pricing
- API usage tiers