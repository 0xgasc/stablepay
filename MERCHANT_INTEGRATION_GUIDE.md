# StablePay Merchant Integration Guide

## Complete Setup & Integration Documentation

This guide covers everything from merchant signup to accepting your first payment, including the Unlock integration example.

---

## Table of Contents

1. [Merchant Onboarding](#merchant-onboarding)
2. [Payment Modal Setup](#payment-modal-setup)
3. [Integration Methods](#integration-methods)
4. [Real Example: Unlock Integration](#real-example-unlock-integration)
5. [Testing Your Integration](#testing-your-integration)
6. [Going Live (Production)](#going-live-production)
7. [Refund Management](#refund-management)

---

## Merchant Onboarding

### Step 1: Create Merchant Account

1. **Sign Up**
   - Visit: https://stablepay-nine.vercel.app/signup.html
   - Enter merchant details:
     - Email (e.g., unlock@unlock.com)
     - Company name (e.g., Unlock)
     - Contact name
     - Password

2. **Wait for Approval**
   - Account created in PENDING status
   - Admin approves via enterprise admin panel
   - You'll receive email confirmation (if configured)

3. **Login to Dashboard**
   - Visit: https://stablepay-nine.vercel.app/login.html
   - Enter credentials
   - Access merchant dashboard

---

### Step 2: Configure Wallets

**Important**: StablePay is NON-CUSTODIAL. Payments go directly to YOUR wallets.

1. **Navigate to Wallets Tab**
   - Click "Wallets" in dashboard
   - You'll see all supported chains

2. **Enable Chains & Add Addresses**

   **For Base Sepolia (Testnet)**:
   - Toggle: ON
   - Paste your EVM wallet address (0x...)
   - Example: `0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D`

   **For Base Mainnet (Production)**:
   - Toggle: ON
   - Paste your EVM wallet address (0x...)
   - Same address works for all EVM chains

   **For Solana Devnet (Testnet)**:
   - Toggle: ON
   - Paste your Solana wallet address (starts with letter/number)
   - Example: `9GW4bqrYugG8sRdMVC5zNwM6ZAm69ztevPadT3RCFqH2`

   **For Solana Mainnet (Production)**:
   - Toggle: ON
   - Paste your Solana wallet address

3. **Click "Save Configuration"**
   - Wallets are now active
   - You can receive payments on enabled chains

---

### Step 3: Get Your Merchant ID

1. **Go to Developer Tab**
   - Find your Merchant ID (e.g., `cmhkjckgi0000qut5wxmtsw1f`)
   - Copy this - you'll need it for integration

2. **Review Auto-Generated Code**
   - Dashboard shows code snippets for your specific merchant ID
   - Copy-paste ready examples

---

## Payment Modal Setup

### Method 1: Hosted Payment Page (Easiest)

**Use the `/crypto-pay.html` page with URL parameters**

#### Generate Payment Link

```javascript
// Your backend creates order via API
const order = await fetch('https://stablepay-nine.vercel.app/api/v1/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    merchantId: 'YOUR_MERCHANT_ID',
    amount: '10.00',
    chain: 'BASE_SEPOLIA',
    paymentAddress: '0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D',
    customerEmail: 'customer@example.com', // optional
    customerName: 'John Doe' // optional
  })
});

const { order: { id } } = await order.json();

// Redirect customer to payment page
const paymentUrl = `https://stablepay-nine.vercel.app/crypto-pay.html?orderId=${id}`;
window.location.href = paymentUrl;
```

#### What Happens

1. Customer lands on StablePay payment page
2. Sees order summary (amount, product)
3. Connects wallet (MetaMask or Phantom)
4. Reviews transaction details
5. Approves payment in wallet
6. Transaction confirms on blockchain
7. Redirected back to your site (if you provide returnUrl)

---

### Method 2: Embedded Widget (Coming Soon)

```html
<!-- Add script to your page -->
<script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>

<!-- Add widget where you want payment button -->
<div class="stablepay-checkout"
     data-merchant="YOUR_MERCHANT_ID"
     data-amount="10.00"
     data-chain="BASE_SEPOLIA">
</div>
```

**Note**: Widget is in development. Use hosted page for now.

---

### Method 3: Custom Integration (Advanced)

Build your own payment UI using StablePay API.

**Step-by-step flow**:

1. **Create Order** (Backend)
```javascript
POST /api/v1/orders
{
  "merchantId": "YOUR_MERCHANT_ID",
  "amount": "10.00",
  "chain": "BASE_SEPOLIA",
  "paymentAddress": "0x9e9Ebf...",
  "customerEmail": "customer@example.com"
}

// Response
{
  "success": true,
  "order": {
    "id": "clxyz123",
    "status": "PENDING",
    "amount": "10.00",
    "chain": "BASE_SEPOLIA",
    "paymentAddress": "0x9e9Ebf...",
    "expiresAt": "2025-01-13T12:00:00Z"
  }
}
```

2. **Show Payment UI** (Frontend)
```html
<!-- Your custom payment modal -->
<div id="payment-modal">
  <h2>Pay $10.00 USDC</h2>
  <p>Send to: 0x9e9Ebf...</p>
  <button onclick="connectWallet()">Connect Wallet & Pay</button>
</div>
```

3. **Execute Payment** (Frontend with ethers.js)
```javascript
async function connectWallet() {
  // Connect MetaMask
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();

  // USDC contract on Base Sepolia
  const usdcAddress = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
  const usdcABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
  ];

  const usdc = new ethers.Contract(usdcAddress, usdcABI, signer);

  // Transfer USDC (6 decimals)
  const amount = ethers.parseUnits('10.00', 6);
  const tx = await usdc.transfer('0x9e9Ebf...', amount);

  console.log('Transaction sent:', tx.hash);

  // Wait for confirmation
  await tx.wait();
  console.log('Transaction confirmed!');

  // Notify StablePay
  await confirmOrder(orderId, tx.hash);
}
```

4. **Confirm Order** (Frontend to Backend)
```javascript
async function confirmOrder(orderId, txHash) {
  await fetch(`https://stablepay-nine.vercel.app/api/v1/orders/${orderId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHash })
  });

  // Order status now CONFIRMED
  // Redirect to success page
  window.location.href = '/thank-you';
}
```

---

## Real Example: Unlock Integration

**Merchant**: Unlock (unlock@unlock.com)
**Merchant ID**: `cmhkjckgi0000qut5wxmtsw1f`

### Unlock's Setup

1. **Wallets Configured**:
   - Base Sepolia: `0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D`
   - Solana Devnet: `9GW4bqrYugG8sRdMVC5zNwM6ZAm69ztevPadT3RCFqH2`
   - Solana Mainnet: `9GW4bqrYugG8sRdMVC5zNwM6ZAm69ztevPadT3RCFqH2`

2. **Product**: Unlock Premium Access ($10 USDC)

3. **Integration Method**: Hosted Payment Page

### Unlock's Implementation

**Backend (Node.js/Express)**:
```javascript
// unlock-backend/routes/checkout.js
const express = require('express');
const router = express.Router();

router.post('/checkout', async (req, res) => {
  const { userId, product } = req.body;

  // Create order in StablePay
  const response = await fetch('https://stablepay-nine.vercel.app/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantId: 'cmhkjckgi0000qut5wxmtsw1f',
      amount: '10.00',
      chain: 'BASE_SEPOLIA', // or get from user selection
      paymentAddress: '0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D',
      customerEmail: req.user.email,
      customerName: req.user.name
    })
  });

  const { order } = await response.json();

  // Save order reference in your DB
  await db.orders.create({
    userId,
    stablePayOrderId: order.id,
    product,
    amount: 10.00,
    status: 'PENDING'
  });

  // Return payment URL
  res.json({
    paymentUrl: `https://stablepay-nine.vercel.app/crypto-pay.html?orderId=${order.id}`
  });
});

module.exports = router;
```

**Frontend (React)**:
```jsx
// unlock-frontend/components/PremiumUpgrade.jsx
import { useState } from 'react';

export default function PremiumUpgrade() {
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);

    // Call your backend
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        product: 'PREMIUM_ACCESS'
      })
    });

    const { paymentUrl } = await response.json();

    // Redirect to StablePay
    window.location.href = paymentUrl;
  };

  return (
    <div>
      <h2>Upgrade to Premium</h2>
      <p>$10 USDC/month - Pay with crypto</p>
      <button onClick={handleUpgrade} disabled={loading}>
        {loading ? 'Processing...' : 'Pay with USDC'}
      </button>
    </div>
  );
}
```

**Webhook Handler** (Optional - for automatic fulfillment):
```javascript
// unlock-backend/routes/webhooks.js
router.post('/stablepay-webhook', async (req, res) => {
  const { orderId, status, txHash } = req.body;

  // Verify webhook signature (implement this)
  // if (!verifySignature(req)) return res.status(401).send('Invalid signature');

  if (status === 'CONFIRMED') {
    // Find order in your DB
    const order = await db.orders.findOne({ stablePayOrderId: orderId });

    // Grant access to user
    await db.users.update(order.userId, {
      isPremium: true,
      premiumExpiresAt: new Date(Date.now() + 30*24*60*60*1000) // 30 days
    });

    // Update order status
    await db.orders.update(order.id, { status: 'COMPLETED' });

    // Send confirmation email
    await sendEmail(order.userId, 'Premium Access Activated!');
  }

  res.json({ success: true });
});
```

### Unlock's Results

✅ **Successfully processed payments from customers**
✅ **Received USDC directly in wallet** (0x9e9Ebf...)
✅ **Automatic access granted** via webhook
✅ **No custody risk** - funds never held by StablePay
✅ **Instant settlement** - USDC available immediately

---

## Integration Methods Comparison

| Method | Difficulty | Time to Setup | Customization | Best For |
|--------|-----------|---------------|---------------|----------|
| **Hosted Page** | Easy | 5 minutes | Low | Quick start, MVPs |
| **Embedded Widget** | Easy | 10 minutes | Medium | E-commerce sites |
| **Custom API** | Advanced | 1-2 hours | Full | SaaS, custom UX |

**Recommendation**: Start with hosted page, migrate to custom later if needed.

---

## Testing Your Integration

### Prerequisites

1. **MetaMask Installed**: https://metamask.io/
2. **Switch to Base Sepolia**:
   - Network Name: Base Sepolia
   - RPC URL: https://sepolia.base.org
   - Chain ID: 84532
   - Currency: ETH
   - Block Explorer: https://sepolia.basescan.org

3. **Get Test Tokens**:
   - Sepolia ETH (gas): https://www.alchemy.com/faucets/base-sepolia
   - USDC on Base Sepolia: https://faucet.circle.com/

### Test Flow

1. **Create Test Order**
   ```bash
   curl -X POST https://stablepay-nine.vercel.app/api/v1/orders \
     -H "Content-Type: application/json" \
     -d '{
       "merchantId": "YOUR_MERCHANT_ID",
       "amount": "1.00",
       "chain": "BASE_SEPOLIA",
       "paymentAddress": "YOUR_WALLET_ADDRESS",
       "customerEmail": "test@test.com"
     }'
   ```

2. **Get Order ID from Response**

3. **Open Payment Page**
   ```
   https://stablepay-nine.vercel.app/crypto-pay.html?orderId=ORDER_ID
   ```

4. **Complete Payment**
   - Connect MetaMask
   - Review transaction
   - Approve in wallet
   - Wait for confirmation (~5-10 seconds)

5. **Verify in Dashboard**
   - Login to dashboard
   - Check Orders tab
   - Order should show CONFIRMED status
   - Transaction hash visible
   - Click to view on BaseScan

### Troubleshooting

**Wallet not connecting?**
- Make sure you're on the correct network (Base Sepolia)
- Clear browser cache
- Try different browser

**Transaction failing?**
- Check USDC balance (need at least order amount)
- Check ETH balance (need ~$0.05 for gas)
- Verify you're sending to correct address

**Order not confirming?**
- Wait 15 seconds (blockchain confirmation time)
- Check transaction on BaseScan
- Verify transaction hash matches order

---

## Going Live (Production)

### Checklist Before Launch

- [ ] **Update Network Mode**
  - Dashboard → Settings → Network Mode: MAINNET

- [ ] **Configure Production Wallets**
  - Enable Base Mainnet (not Sepolia)
  - Enable Solana Mainnet (not Devnet)
  - Use production wallet addresses

- [ ] **Update Your Code**
  ```javascript
  // Change from
  chain: 'BASE_SEPOLIA'

  // To
  chain: 'BASE_MAINNET'
  ```

- [ ] **Test with Small Amount**
  - Send $1 USDC test payment on mainnet
  - Verify you receive it in your wallet
  - Confirm order shows in dashboard

- [ ] **Set Up Monitoring**
  - Check dashboard daily for new orders
  - Set up email notifications (if available)
  - Monitor wallet for incoming payments

### Production Wallet Security

⚠️ **CRITICAL SECURITY**:

1. **Use Hardware Wallet** (Ledger, Trezor)
   - Don't use hot wallet for large amounts
   - Store private keys securely

2. **Multi-Sig Wallet** (for high volume)
   - Use Gnosis Safe or similar
   - Require 2-3 signatures for withdrawals

3. **Regular Withdrawals**
   - Don't accumulate large amounts
   - Transfer to cold storage regularly

4. **Backup Your Keys**
   - Write down seed phrase
   - Store in multiple secure locations
   - NEVER share with anyone

---

## Refund Management

### Single Refund

1. **Navigate to Orders Tab**
2. **Find Confirmed Order**
3. **Click "Refund" Button**
4. **Refund Modal Opens**:
   - Connect your wallet (MetaMask/Phantom)
   - Enter refund amount (full or partial)
   - Enter reason for refund
   - Customer wallet auto-filled from original transaction
5. **Click "Execute Refund"**
6. **Approve in Wallet**
7. **Refund Processed**
   - USDC sent back to customer
   - Transaction hash recorded
   - Refund appears in dashboard

### Batch Refund (EVM Only)

1. **Select Multiple Orders**
   - Click "+ Batch" on each order
   - Orders added to batch section

2. **Review Batch**
   - See total refund amount
   - Verify all orders

3. **Execute Batch**
   - Click "Execute Batch Refund"
   - Connect wallet
   - Single transaction processes all refunds
   - **Gas savings**: 60-85% vs individual refunds

4. **Verify Refunds**
   - All customers receive USDC
   - Single transaction hash for all
   - All refund records created

### Refund Best Practices

- ✅ Issue refunds within 24 hours of request
- ✅ Use partial refunds for disputes
- ✅ Keep records of refund reasons
- ✅ Batch refunds to save gas costs
- ✅ Verify customer wallet before refunding
- ❌ Don't refund to different wallet than original

---

## API Reference (Quick)

### Create Order
```
POST /api/v1/orders
Body: { merchantId, amount, chain, paymentAddress, customerEmail?, customerName? }
```

### Get Order
```
GET /api/v1/orders/:orderId
```

### Confirm Order
```
POST /api/v1/orders/:orderId/confirm
Body: { txHash }
```

### Get Merchant Orders
```
GET /api/v1/merchants/:merchantId/orders
```

### Create Refund
```
POST /api/refunds
Body: { orderId, amount, reason, status }
```

### Get Refunds
```
GET /api/refunds?merchantId=YOUR_ID
```

**Full API docs**: See `/public/docs/API.md`

---

## Support

**Security Issues**: security@stablepay.io
**Integration Help**: support@stablepay.io
**Documentation**: https://stablepay-nine.vercel.app/docs/
**Status Page**: https://stablepay-nine.vercel.app (check uptime)

---

## Summary

✅ **Non-custodial** - You control your funds
✅ **Multi-chain** - Base, Solana, Ethereum, Polygon, Arbitrum
✅ **Instant settlement** - USDC hits your wallet in seconds
✅ **No chargebacks** - Blockchain transactions are final
✅ **Built-in refunds** - Easy refund management
✅ **0.5% fees** - 83% cheaper than Stripe

**Get started**: https://stablepay-nine.vercel.app/signup.html

---

**Last Updated**: January 13, 2025
**Version**: 2.0 (with Refunds & Trust Center)
