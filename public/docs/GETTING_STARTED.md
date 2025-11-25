# Getting Started with StablePay

**Accept USDC payments on your website in 5 minutes**

---

## What is StablePay?

StablePay lets you accept **stablecoin payments** (USDC) on multiple blockchains without writing any blockchain code. Your customers pay with their crypto wallet (MetaMask, Phantom), and funds go directly to your wallet.

**Supported Chains:**
- ✅ Base (Ethereum L2)
- ✅ Solana
- ✅ Ethereum, Polygon, Arbitrum (coming soon)

**Supported Tokens:**
- ✅ USDC (primary)
- 🔜 USDT, EURC (coming soon)

---

## Quick Start (3 Steps)

### Step 1: Create Account

1. Go to [stablepay-nine.vercel.app](https://stablepay-nine.vercel.app)
2. Click **"Sign Up"**
3. Enter your email and company details
4. Wait for account approval (usually < 24 hours)

### Step 2: Configure Wallets

1. Log into your [dashboard](https://stablepay-nine.vercel.app/dashboard.html)
2. Go to **"Wallets"** tab
3. Enable the chains you want to accept payments on
4. Paste your wallet addresses:
   - **Base**: Your Ethereum wallet address (0x...)
   - **Solana**: Your Solana wallet address (9GW...)
5. Click **"Save"**

**Important:** These are YOUR wallets where you'll receive payments. Customers send USDC directly to you.

### Step 3: Add Checkout to Your Website

Copy your **Merchant ID** from the Developer tab, then add this code to your website:

```html
<!-- Add this before closing </head> tag -->
<script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>

<!-- Add this where you want the payment button -->
<div class="stablepay-checkout"
     data-merchant="YOUR_MERCHANT_ID_HERE"
     data-amount="10.00"
     data-chain="BASE_SEPOLIA">
</div>
```

**That's it!** Your customers can now pay with USDC.

---

## Testing Your Integration

Before going live, test on **testnets** (fake money):

### Get Testnet Tokens

**For Base Sepolia (testnet):**
1. Get testnet ETH: [Alchemy Base Sepolia Faucet](https://www.alchemy.com/faucets/base-sepolia)
2. Get testnet USDC: Use [Base Sepolia USDC](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e)

**For Solana Devnet:**
1. Get devnet SOL: `solana airdrop 2`
2. Get devnet USDC: [Solana Faucet](https://faucet.solana.com/)

### Test Payment Flow

1. Open your website with the StablePay widget
2. Click **"Pay Now"**
3. Connect your MetaMask (for Base) or Phantom (for Solana)
4. Approve the transaction
5. Wait for confirmation (~3-5 seconds)
6. Check your dashboard - you should see the order as **CONFIRMED**

---

## Going to Mainnet (Production)

Once testing is complete:

1. Go to **Settings** → Change network mode to **"Mainnet"**
2. Update your wallet addresses to **production wallets**
3. Update your website code:
   ```html
   data-chain="BASE_MAINNET"  <!-- Change from BASE_SEPOLIA -->
   ```

**Security:** Your wallet's private keys stay with you. StablePay never has access to your funds.

---

## Integration Options

### Option 1: Embedded Widget (Easiest)

**Best for:** Most use cases
**Time:** 2 minutes

```html
<script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>

<div class="stablepay-checkout"
     data-merchant="YOUR_MERCHANT_ID"
     data-amount="49.99"
     data-chain="BASE_MAINNET">
</div>
```

Widget appears inline on your page. Customers click "Pay" and their wallet (MetaMask/Phantom) opens.

---

### Option 2: Hosted Checkout (Redirect)

**Best for:** Simplified checkout flow
**Time:** 5 minutes

**Step 1:** Create an order on your backend:

```javascript
// Your server
const response = await fetch('https://stablepay-nine.vercel.app/api/v1/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    merchantId: 'YOUR_MERCHANT_ID',
    amount: '49.99',
    chain: 'BASE_MAINNET',
    customerEmail: 'customer@example.com',
    customerName: 'Product Name',
    paymentAddress: 'YOUR_BASE_WALLET_ADDRESS'
  })
});

const { order } = await response.json();
```

**Step 2:** Redirect customer to StablePay checkout:

```javascript
window.location.href = `https://stablepay-nine.vercel.app/checkout?orderId=${order.id}`;
```

**Step 3:** Customer pays on StablePay's hosted page

**Step 4:** Check order status after redirect back:

```javascript
// After customer returns to your site
const statusResponse = await fetch(`https://stablepay-nine.vercel.app/api/v1/orders/${orderId}`);
const { status } = await statusResponse.json();

if (status === 'CONFIRMED') {
  // Payment successful!
}
```

---

### Option 3: Custom Integration (API)

**Best for:** Full control over UI/UX
**Time:** 30-60 minutes

See [API Documentation](./API.md) for complete reference.

**Basic flow:**
1. Create order via API
2. Show your own payment UI
3. Connect customer's wallet
4. Execute blockchain transaction
5. Confirm order via API

[View Full API Guide →](./API.md)

---

## Handling Payment Events

Listen for successful payments to update your database:

```html
<script>
document.querySelector('.stablepay-checkout').addEventListener('stablepay:payment.success', (event) => {
  const { orderId, txHash, amount, chain } = event.detail;

  // Update your database
  fetch('/your-api/process-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: orderId,
      txHash: txHash,
      amount: amount,
      status: 'paid'
    })
  });

  // Show success message
  alert('Payment successful!');
});

// Handle failures
document.querySelector('.stablepay-checkout').addEventListener('stablepay:payment.failed', (event) => {
  console.error('Payment failed:', event.detail);
  alert('Payment failed. Please try again.');
});
</script>
```

---

## Widget Configuration

All available options:

```html
<div class="stablepay-checkout"
     data-merchant="YOUR_MERCHANT_ID"          <!-- Required: Your merchant ID -->
     data-amount="10.00"                        <!-- Required: Payment amount -->
     data-chain="BASE_MAINNET"                  <!-- Optional: Default chain -->
     data-customer-email="user@example.com"     <!-- Optional: Pre-fill email -->
     data-theme="dark"                          <!-- Optional: light|dark -->
     data-button-text="Pay with Crypto">        <!-- Optional: Button label -->
</div>
```

### Supported Chains

**Testnets (for testing):**
- `BASE_SEPOLIA` - Base testnet
- `SOLANA_DEVNET` - Solana testnet
- `ETH_SEPOLIA` - Ethereum testnet (coming soon)

**Mainnets (production):**
- `BASE_MAINNET` - Base (Ethereum L2)
- `SOLANA_MAINNET` - Solana
- `ETH_MAINNET` - Ethereum (coming soon)
- `POLYGON_MAINNET` - Polygon (coming soon)
- `ARBITRUM_MAINNET` - Arbitrum (coming soon)

---

## Checking Order Status

### Via Dashboard

Go to **Orders** tab in your [dashboard](https://stablepay-nine.vercel.app/dashboard.html) to see all payments.

### Via API

```javascript
const response = await fetch(`https://stablepay-nine.vercel.app/api/v1/orders/${orderId}`);
const order = await response.json();

console.log(order.status); // PENDING | CONFIRMED | FAILED | EXPIRED
```

**Order Statuses:**
- `PENDING` - Order created, waiting for payment
- `CONFIRMED` - Payment received and confirmed on blockchain
- `FAILED` - Transaction failed
- `EXPIRED` - Order expired (no payment within 1 hour)

---

## Common Issues & Solutions

### Issue: "Merchant ID not found"
**Solution:**
1. Copy your merchant ID from the Developer tab (not the email)
2. Make sure you're logged in and account is approved
3. ID format: `cmhkjckgi0000qut5wxmtsw1f`

### Issue: "Wallet not found"
**Solution:**
1. Go to Wallets tab in dashboard
2. Enable the chain you want to use (toggle on)
3. Paste your wallet address
4. Click Save

### Issue: "MetaMask not connecting"
**Solution:**
1. Make sure MetaMask extension is installed
2. Refresh the page
3. Check that you're on the correct network
4. Try disconnecting and reconnecting

### Issue: "Transaction failed"
**Solution:**
1. Check you have enough USDC in your wallet
2. Check you have enough native token for gas (ETH for Base, SOL for Solana)
3. Try increasing gas settings in MetaMask
4. Make sure you're on the correct network

### Issue: "Order shows PENDING but I paid"
**Solution:**
1. Wait 30-60 seconds for blockchain confirmation
2. Check the transaction on block explorer (link in widget)
3. Contact support if still pending after 5 minutes

---

## Security Best Practices

1. **Never share your wallet private keys** - StablePay never asks for them
2. **Use separate wallets** for business vs personal funds
3. **Enable 2FA** on your dashboard account (coming soon)
4. **Test on testnet first** before going to mainnet
5. **Monitor your wallets** regularly via the dashboard
6. **Verify amounts** - always check the payment amount in your wallet before confirming

---

## Framework Examples

### React

```jsx
import { useEffect } from 'react';

export default function Checkout() {
  useEffect(() => {
    // Load StablePay script
    const script = document.createElement('script');
    script.src = 'https://stablepay-nine.vercel.app/checkout-widget.js';
    document.head.appendChild(script);

    // Listen for payment events
    const handleSuccess = (event) => {
      console.log('Payment successful:', event.detail);
    };

    document.addEventListener('stablepay:payment.success', handleSuccess);

    return () => {
      document.removeEventListener('stablepay:payment.success', handleSuccess);
    };
  }, []);

  return (
    <div className="stablepay-checkout"
         data-merchant="YOUR_MERCHANT_ID"
         data-amount="10.00"
         data-chain="BASE_MAINNET">
    </div>
  );
}
```

### Next.js

```jsx
'use client';

import Script from 'next/script';

export default function CheckoutPage() {
  const handlePaymentSuccess = (event) => {
    console.log('Payment:', event.detail);
    // Update your database
  };

  return (
    <>
      <Script src="https://stablepay-nine.vercel.app/checkout-widget.js" />

      <div className="stablepay-checkout"
           data-merchant={process.env.NEXT_PUBLIC_STABLEPAY_MERCHANT_ID}
           data-amount="10.00"
           data-chain="BASE_MAINNET">
      </div>
    </>
  );
}
```

### Vue

```vue
<template>
  <div class="stablepay-checkout"
       data-merchant="YOUR_MERCHANT_ID"
       data-amount="10.00"
       data-chain="BASE_MAINNET">
  </div>
</template>

<script setup>
import { onMounted } from 'vue';

onMounted(() => {
  const script = document.createElement('script');
  script.src = 'https://stablepay-nine.vercel.app/checkout-widget.js';
  document.head.appendChild(script);

  document.addEventListener('stablepay:payment.success', (event) => {
    console.log('Payment successful:', event.detail);
  });
});
</script>
```

### WordPress

Add to your theme or page:

```php
<?php
// In your template file
?>

<script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>

<div class="stablepay-checkout"
     data-merchant="<?php echo get_option('stablepay_merchant_id'); ?>"
     data-amount="<?php echo $product_price; ?>"
     data-chain="BASE_MAINNET">
</div>
```

---

## Need Help?

- 📚 **Documentation:** [Full API Docs](./API.md)
- 💬 **Support:** support@stablepay.com
- 🐛 **Report Issues:** [GitHub Issues](https://github.com/stablepay/issues)
- 💡 **Feature Requests:** [Contact Us](mailto:support@stablepay.com)

---

## What's Next?

- ✅ Test your integration on testnet
- ✅ Go live on mainnet
- 📊 Monitor your payments in the dashboard
- 🔔 Set up webhooks for real-time notifications (coming soon)
- 💰 Enable multi-chain support (accept on Base + Solana simultaneously)

**Welcome to StablePay!** 🚀
