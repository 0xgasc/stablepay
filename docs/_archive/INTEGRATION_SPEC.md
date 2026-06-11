# StablePay Integration Specification

**For Lovable Agent: Complete Integration Guide**

---

## Overview

StablePay is a multi-chain USDC payment platform. This document provides everything needed to integrate StablePay checkout functionality into merchant websites.

**Current Status:**
- ✅ Backend API working (order creation, confirmation, wallet management)
- ✅ Multi-chain support (Base, Ethereum, Polygon, Arbitrum, Solana)
- ✅ Merchant dashboard with wallet configuration
- ⚠️ Checkout widget needs update to use real wallet connections
- ⚠️ Documentation needs to be added to Developer tab

---

## What We Need

### 1. **Embedded Checkout Widget** (Priority: HIGH)
A plug-and-play JavaScript widget that merchants can embed on their websites.

**Current Implementation:** `/public/checkout-widget.js`
- Has basic UI structure
- Missing: Real MetaMask/Phantom wallet connections
- Missing: Actual blockchain transaction execution

**Requirements:**
- Drop-in `<script>` tag merchants can add to any HTML page
- Auto-detects and connects to MetaMask (EVM) or Phantom (Solana)
- Prompts user to approve transaction with correct amount and token
- Confirms transaction on-chain and updates order status via API
- Responsive design, works on mobile
- Customizable theme (light/dark)

**Reference:** The "Test Payment" modal in `/public/dashboard.html` lines 540-603 shows the working wallet connection logic.

---

### 2. **Hosted Checkout Page** (Priority: HIGH)
A StablePay-hosted checkout URL merchants can redirect customers to.

**URL Structure:**
```
https://stablepay-nine.vercel.app/checkout?merchantId=xxx&amount=10.00&chain=BASE_SEPOLIA
```

**Requirements:**
- Create `/public/checkout.html` - standalone checkout page
- Accept query parameters: `merchantId`, `amount`, `chain`, `token`, `orderId` (optional)
- Display payment amount, merchant name, supported chains
- Connect wallet button (MetaMask or Phantom)
- Execute transaction on correct chain
- Show success/failure status
- Redirect to merchant site on completion (if `returnUrl` provided)

**API Flow:**
1. Merchant creates order: `POST /api/v1/orders` → returns `orderId`
2. Redirect customer to: `/checkout?orderId={orderId}`
3. Customer connects wallet, approves transaction
4. Transaction confirms, order status updates to `CONFIRMED`
5. Merchant receives webhook (future) or polls order status

---

### 3. **Enhanced Developer Documentation**

The Developer tab currently has basic API docs. We need to expand it:

#### Add to Developer Tab (`/public/dashboard.html` starting line 284):

**A. Checkout Integration Options**
```html
<div class="bg-slate-950 border shadow-sm border p-6">
  <h3 class="text-lg font-semibold text-white mb-4">Checkout Integration</h3>
  <p class="text-sm text-slate-400 mb-6">
    Choose how you want to integrate StablePay checkout into your application
  </p>

  <!-- Three integration methods -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <!-- 1. Embedded Widget -->
    <div class="border border-slate-800 p-4 rounded">
      <h4 class="font-medium text-white mb-2">Embedded Widget</h4>
      <p class="text-xs text-slate-400 mb-3">
        Add checkout directly to your page
      </p>
      <button class="text-blue-400 text-sm">View Docs →</button>
    </div>

    <!-- 2. Hosted Checkout -->
    <div class="border border-slate-800 p-4 rounded">
      <h4 class="font-medium text-white mb-2">Hosted Checkout</h4>
      <p class="text-xs text-slate-400 mb-3">
        Redirect to StablePay checkout page
      </p>
      <button class="text-blue-400 text-sm">View Docs →</button>
    </div>

    <!-- 3. Custom Integration -->
    <div class="border border-slate-800 p-4 rounded">
      <h4 class="font-medium text-white mb-2">Custom Integration</h4>
      <p class="text-xs text-slate-400 mb-3">
        Build your own UI with our API
      </p>
      <button class="text-blue-400 text-sm">View Docs →</button>
    </div>
  </div>
</div>
```

**B. Quick Start Guide**
```html
<div class="bg-slate-950 border shadow-sm border p-6">
  <h3 class="text-lg font-semibold text-white mb-4">Quick Start</h3>

  <div class="space-y-4">
    <!-- Step 1 -->
    <div class="flex space-x-4">
      <div class="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">1</div>
      <div class="flex-1">
        <h4 class="font-medium text-white mb-1">Configure Wallets</h4>
        <p class="text-sm text-slate-400">Go to the Wallets tab and add your wallet addresses for each blockchain you want to accept payments on.</p>
      </div>
    </div>

    <!-- Step 2 -->
    <div class="flex space-x-4">
      <div class="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">2</div>
      <div class="flex-1">
        <h4 class="font-medium text-white mb-1">Add Checkout to Your Site</h4>
        <p class="text-sm text-slate-400 mb-2">Copy and paste this code into your HTML:</p>
        <div class="bg-gray-900 p-3 rounded overflow-x-auto">
          <pre class="text-xs text-green-400 font-mono">&lt;script src="https://stablepay-nine.vercel.app/checkout-widget.js"&gt;&lt;/script&gt;
&lt;div class="stablepay-checkout"
     data-merchant="YOUR_MERCHANT_ID"
     data-amount="10.00"&gt;
&lt;/div&gt;</pre>
        </div>
      </div>
    </div>

    <!-- Step 3 -->
    <div class="flex space-x-4">
      <div class="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold">3</div>
      <div class="flex-1">
        <h4 class="font-medium text-white mb-1">Test Your Integration</h4>
        <p class="text-sm text-slate-400">Use testnet chains (Sepolia, Devnet) to test payments before going live.</p>
      </div>
    </div>
  </div>
</div>
```

**C. Widget Configuration Reference**
```html
<div class="bg-slate-950 border shadow-sm border p-6">
  <h3 class="text-lg font-semibold text-white mb-4">Widget Configuration</h3>

  <table class="w-full text-sm">
    <thead>
      <tr class="border-b border-slate-800">
        <th class="text-left py-2 text-slate-300">Attribute</th>
        <th class="text-left py-2 text-slate-300">Type</th>
        <th class="text-left py-2 text-slate-300">Description</th>
      </tr>
    </thead>
    <tbody class="text-slate-400">
      <tr class="border-b border-slate-800">
        <td class="py-2 font-mono text-xs">data-merchant</td>
        <td class="py-2">string</td>
        <td class="py-2">Your Merchant ID (required)</td>
      </tr>
      <tr class="border-b border-slate-800">
        <td class="py-2 font-mono text-xs">data-amount</td>
        <td class="py-2">string</td>
        <td class="py-2">Payment amount in USDC (required)</td>
      </tr>
      <tr class="border-b border-slate-800">
        <td class="py-2 font-mono text-xs">data-chain</td>
        <td class="py-2">string</td>
        <td class="py-2">Preferred chain (optional)</td>
      </tr>
      <tr class="border-b border-slate-800">
        <td class="py-2 font-mono text-xs">data-theme</td>
        <td class="py-2">string</td>
        <td class="py-2">light | dark (optional)</td>
      </tr>
      <tr>
        <td class="py-2 font-mono text-xs">data-customer-email</td>
        <td class="py-2">string</td>
        <td class="py-2">Customer email (optional)</td>
      </tr>
    </tbody>
  </table>
</div>
```

**D. Hosted Checkout Documentation**
```html
<div class="bg-slate-950 border shadow-sm border p-6">
  <h3 class="text-lg font-semibold text-white mb-4">Hosted Checkout</h3>

  <p class="text-sm text-slate-400 mb-4">
    Redirect customers to a StablePay-hosted checkout page:
  </p>

  <div class="bg-gray-900 p-4 rounded mb-4">
    <pre class="text-xs text-green-400 font-mono">// 1. Create an order
const order = await fetch('https://stablepay-nine.vercel.app/api/v1/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    merchantId: 'YOUR_MERCHANT_ID',
    amount: '10.00',
    chain: 'BASE_SEPOLIA',
    customerEmail: 'customer@example.com',
    paymentAddress: 'YOUR_WALLET_ADDRESS'
  })
});

// 2. Redirect to checkout
const { order: { id } } = await order.json();
window.location.href = `https://stablepay-nine.vercel.app/checkout?orderId=${id}`;

// 3. Check order status after redirect back
const status = await fetch(`https://stablepay-nine.vercel.app/api/v1/orders/${id}`);
const { status } = await status.json(); // 'CONFIRMED', 'PENDING', etc.</pre>
  </div>

  <div class="border border-blue-800 bg-blue-900/20 p-4 rounded">
    <div class="text-sm font-medium text-blue-300 mb-1">Try it now</div>
    <button id="tryHostedCheckout" class="mt-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm">
      Create Test Order & Redirect
    </button>
  </div>
</div>
```

---

## Technical Implementation Details

### API Endpoints Available

#### 1. Create Order
```
POST /api/v1/orders
Content-Type: application/json

{
  "merchantId": "cmhkjckgi0000qut5wxmtsw1f",
  "amount": "10.00",
  "chain": "BASE_SEPOLIA",
  "customerEmail": "customer@example.com",
  "customerName": "Product Name",
  "paymentAddress": "0x123..." // merchant wallet for this chain
}

Response:
{
  "success": true,
  "order": {
    "id": "order_xxx",
    "merchantId": "...",
    "amount": "10.00",
    "chain": "BASE_SEPOLIA",
    "status": "PENDING",
    "paymentAddress": "0x123...",
    "expiresAt": "2025-11-10T12:00:00Z"
  }
}
```

#### 2. Confirm Order (Called by widget after transaction)
```
POST /api/v1/orders/:orderId/confirm
Content-Type: application/json

{
  "txHash": "0xabc123..."
}

Response:
{
  "success": true,
  "order": { ... }
}
```

#### 3. Get Order Status
```
GET /api/v1/orders/:orderId

Response:
{
  "id": "order_xxx",
  "status": "CONFIRMED",
  "amount": "10.00",
  "chain": "BASE_SEPOLIA",
  "transactions": [
    {
      "txHash": "0xabc...",
      "status": "CONFIRMED",
      "confirmations": 12
    }
  ]
}
```

#### 4. Get Merchant Wallets
```
GET /api/v1/admin?resource=wallets&merchantId=xxx
Authorization: Bearer {token}

Response:
[
  {
    "id": "wallet_xxx",
    "chain": "BASE_SEPOLIA",
    "address": "0x123...",
    "isActive": true
  }
]
```

---

### Wallet Connection Logic (CRITICAL)

**Reference Implementation:** See `/public/dashboard.html` lines 1338-1450

#### MetaMask Connection (EVM Chains):
```javascript
// Detect MetaMask (even if Phantom is installed)
let ethereum = window.ethereum;
if (window.ethereum?.providers) {
  ethereum = window.ethereum.providers.find(p => p.isMetaMask);
}

// Request accounts
const accounts = await ethereum.request({
  method: 'eth_requestAccounts'
});

// Create provider and signer
const provider = new ethers.BrowserProvider(ethereum);
const signer = await provider.getSigner();
const address = await signer.getAddress();
```

#### Phantom Connection (Solana):
```javascript
const phantom = window.solana;
if (!phantom?.isPhantom) {
  throw new Error('Phantom wallet not found');
}

await phantom.connect();
const address = phantom.publicKey.toString();
```

#### Transaction Execution (EVM):
```javascript
// 1. Get token contract
const usdcContract = new ethers.Contract(
  tokenAddress,
  ['function transfer(address to, uint256 amount) returns (bool)'],
  signer
);

// 2. Convert amount to smallest unit (6 decimals for USDC)
const amount = ethers.parseUnits(amountString, 6);

// 3. Send transaction
const tx = await usdcContract.transfer(merchantWallet, amount);

// 4. Wait for confirmation
await tx.wait();

// 5. Update order
await fetch(`/api/v1/orders/${orderId}/confirm`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ txHash: tx.hash })
});
```

#### Transaction Execution (Solana):
See lines 1624-1843 in `/public/dashboard.html` for complete Solana SPL token transfer implementation.

---

### Chain Configurations

**Token Addresses:**
```javascript
const CHAIN_CONFIG = {
  BASE_SEPOLIA: {
    chainId: '0x14a34',
    chainName: 'Base Sepolia',
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorerUrls: ['https://sepolia.basescan.org'],
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    tokens: {
      USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      USDT: '', // not available
      EURC: ''  // not available
    }
  },
  BASE_MAINNET: {
    chainId: '0x2105',
    chainName: 'Base',
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org'],
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    tokens: {
      USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      USDT: '',
      EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42'
    }
  },
  SOLANA_DEVNET: {
    rpcUrl: 'https://api.devnet.solana.com',
    tokens: {
      USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      USDT: '',
      EURC: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr'
    }
  },
  SOLANA_MAINNET: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    tokens: {
      USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      EURC: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr'
    }
  }
  // ... other chains
};
```

---

## Checklist for Lovable Agent

### Phase 1: Update Checkout Widget ✅
- [ ] Update `/public/checkout-widget.js` to include real wallet connections
- [ ] Add MetaMask detection and connection logic
- [ ] Add Phantom detection and connection logic
- [ ] Implement EVM token transfer (using ethers.js)
- [ ] Implement Solana SPL token transfer
- [ ] Add chain selection dropdown
- [ ] Add loading states and error handling
- [ ] Test widget on standalone HTML page

### Phase 2: Create Hosted Checkout Page ✅
- [ ] Create `/public/checkout.html`
- [ ] Parse URL parameters (orderId, merchantId, amount, chain)
- [ ] Fetch order details from API
- [ ] Display payment information
- [ ] Implement wallet connection UI
- [ ] Execute transaction on correct chain
- [ ] Show transaction confirmation
- [ ] Add redirect back to merchant site
- [ ] Mobile responsive design

### Phase 3: Enhance Developer Documentation ✅
- [ ] Add "Checkout Integration" section to Developer tab
- [ ] Add "Quick Start Guide" with step-by-step instructions
- [ ] Add widget configuration reference table
- [ ] Add hosted checkout flow documentation
- [ ] Add interactive "Try it now" buttons
- [ ] Add code examples for all integration methods
- [ ] Add troubleshooting section
- [ ] Add example HTML page template

### Phase 4: Testing ✅
- [ ] Test embedded widget on demo page
- [ ] Test hosted checkout with all chains
- [ ] Test MetaMask connection with Phantom installed
- [ ] Test Phantom connection with MetaMask installed
- [ ] Test mobile responsiveness
- [ ] Test error scenarios (wallet not found, insufficient funds, etc.)
- [ ] Verify transaction confirmations update order status

---

## File Structure

```
stablepay/
├── public/
│   ├── dashboard.html          # Merchant dashboard (reference for wallet logic)
│   ├── checkout.html           # NEW: Hosted checkout page
│   ├── checkout-widget.js      # UPDATE: Embedded widget with real transactions
│   └── demo-integration.html   # NEW: Example integration for merchants
├── api/
│   └── v1/
│       ├── orders.js           # Order endpoints (already working)
│       └── checkout.js         # Checkout session creation (optional)
└── INTEGRATION_SPEC.md         # This file
```

---

## Success Criteria

✅ **Merchant can:**
1. Configure wallets in dashboard
2. Copy widget code from Developer tab
3. Paste into their website
4. Customer sees payment UI
5. Customer connects MetaMask/Phantom
6. Customer approves transaction
7. Transaction confirms on-chain
8. Order status updates to CONFIRMED
9. Merchant sees order in Orders tab

✅ **Or alternatively:**
1. Create order via API
2. Redirect customer to hosted checkout
3. Customer completes payment
4. Customer redirects back to merchant site
5. Merchant checks order status
6. Order shows CONFIRMED with transaction hash

---

## Questions for You

1. **Widget vs Hosted:** Do you want to prioritize the embedded widget or hosted checkout first?
2. **Chain Selection:** Should customers be able to choose which chain to pay on, or should it be pre-selected by merchant?
3. **Token Selection:** Support USDC only for now, or also USDT/EURC?
4. **Webhooks:** Do you want real-time webhooks when payments confirm? (This would require additional backend work)
5. **Mobile:** Should we create a mobile-optimized version or responsive design is enough?

---

## Next Steps

1. Review this spec
2. Clarify any questions
3. I'll create a clean demo page showing the working integration
4. You can give this spec + the demo to Lovable agent
5. Lovable agent implements the widget/checkout based on this spec
6. We test and iterate

Ready to proceed?
