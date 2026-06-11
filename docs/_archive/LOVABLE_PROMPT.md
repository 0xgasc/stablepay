# StablePay Checkout Widget - Implementation Prompt

## What You're Building

A checkout widget that accepts USDC payments on **Base Sepolia (testnet)** and **Solana Devnet** only. The backend is 100% done - you just need to build the frontend widget that connects wallets and executes transactions.

## CRITICAL CLARIFICATION: How This Works

**The merchant (Unlock) embeds the widget on their website.**

When a customer clicks "Pay Now":

1. ✅ Widget **opens MetaMask/Phantom popup** (browser wallet extension)
2. ✅ Customer **approves the transaction** in their wallet
3. ✅ Transaction **confirms on blockchain**
4. ✅ Widget **writes to StablePay database** via API:
   - `POST /api/v1/orders/:id/confirm` with `txHash`
   - Creates row in `Transactions` table
   - Updates `Orders` table to `status="CONFIRMED"`
5. ✅ Widget **emits JavaScript event** `stablepay:payment.success`
6. ✅ Merchant (Unlock) **listens to event** and writes to **their own database**:
   ```javascript
   document.addEventListener('stablepay:payment.success', (event) => {
       // They get: orderId, txHash, amount, customerWallet
       // They write to THEIR database (IMEI unlocks, etc.)
   });
   ```

**Result:**
- ✅ StablePay database has the order + transaction
- ✅ Merchant database has their own records (linked by orderId)
- ✅ Customer's wallet has the blockchain receipt

---

## Scope: Phase 1 (Base + Solana USDC Only)

- ✅ Support **Base Sepolia** (testnet) with MetaMask
- ✅ Support **Solana Devnet** with Phantom
- ✅ **USDC only** (no other tokens)
- ✅ Embedded widget (`<script>` tag integration)
- ✅ Hosted checkout page (`/checkout?orderId=xxx`)
- ❌ No mainnet (testnet only for now)
- ❌ No other chains (Ethereum, Polygon, Arbitrum - later)
- ❌ No other tokens (USDT, EURC - later)

**Estimated Time:** 4-6 hours

---

## Files to Create/Modify

### 1. `/public/checkout-widget.js` (UPDATE - Main Widget)
**Status:** Exists but has placeholder code
**What to do:** Replace with real wallet connections and blockchain transactions

### 2. `/public/checkout.html` (CREATE - Hosted Checkout Page)
**Status:** Doesn't exist
**What to do:** Create standalone checkout page

### 3. `/public/demo-integration.html` (UPDATE - Demo Page)
**Status:** Exists
**What to do:** Add working examples showing the widget in action

### 4. `/public/dashboard.html` (UPDATE - Developer Tab Documentation)
**Status:** Exists
**What to do:** Add quick start guide and integration docs to Developer tab (lines 284-500)

---

## Step-by-Step Implementation

### Part 1: Update Checkout Widget (`/public/checkout-widget.js`)

**Current Code:** Has card payment UI (placeholder) - **REPLACE EVERYTHING**
**Reference:** Copy working code from `/public/dashboard.html` lines 1338-1933

#### CRITICAL: What the widget needs to do:

**The widget is embedded on the merchant's website. When the customer clicks "Pay Now":**

1. ✅ **Opens MetaMask/Phantom popup** (browser wallet extension)
2. ✅ Customer sees: "Send 10 USDC to 0x9GW4bqr..." in their wallet
3. ✅ Customer clicks "Confirm" in their wallet
4. ✅ Transaction broadcasts to blockchain
5. ✅ Widget gets transaction hash (e.g., "0xabc123...")
6. ✅ **Writes to YOUR database** via `POST /api/v1/orders/:id/confirm`
   - Creates 1 row in `Transactions` table with txHash
   - Updates `Orders` table status to `CONFIRMED`
7. ✅ **Merchant (Unlock) can write to THEIR database** - they get the `orderId` and `txHash` from the success event
8. ✅ Shows success message

**No StablePay-hosted UI.** Customer only sees the merchant's website + their wallet popup.

```javascript
class StablePayCheckout {
    constructor(options) {
        this.merchantId = options.merchantId;
        this.amount = options.amount;
        this.chain = options.chain || 'BASE_SEPOLIA'; // Default to Base
    }

    async init() {
        // 1. Render payment UI (inline or modal - merchant chooses)
        this.renderUI();

        // 2. Attach click handlers
        this.attachHandlers();
    }

    async processPayment() {
        // STEP 1: Connect wallet (triggers MetaMask/Phantom popup)
        const wallet = this.chain === 'SOLANA_DEVNET'
            ? await this.connectPhantom()
            : await this.connectMetaMask();

        // STEP 2: Fetch merchant's wallet address
        const merchantWallet = await this.getMerchantWallet();

        // STEP 3: Create order
        const order = await this.createOrder(merchantWallet);

        // STEP 4: Execute blockchain transaction
        const txHash = this.chain === 'SOLANA_DEVNET'
            ? await this.executeSolanaPayment(wallet, order.id, merchantWallet)
            : await this.executeEVMPayment(wallet, order.id, merchantWallet);

        // STEP 5: Confirm order
        await this.confirmOrder(order.id, txHash);

        // STEP 6: Show success
        this.showSuccess(order.id, txHash);

        // STEP 7: Emit event for merchant's website
        // THEY can listen to this event and write to THEIR database
        this.emit('payment.success', {
            orderId: order.id,
            txHash: txHash,
            amount: this.amount,
            chain: this.chain,
            merchantWallet: merchantWallet,
            customerWallet: wallet.address
        });

        // At this point:
        // ✅ YOUR database has the order (CONFIRMED) and transaction (txHash)
        // ✅ THEIR database can have whatever they want (they listen to the event)
    }

    async connectMetaMask() {
        // COPY FROM dashboard.html lines 1338-1383
        let ethereum = window.ethereum;
        if (window.ethereum?.providers) {
            ethereum = window.ethereum.providers.find(p => p.isMetaMask);
        }

        const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
        const provider = new ethers.BrowserProvider(ethereum);
        const signer = await provider.getSigner();

        return { provider, signer, address: await signer.getAddress() };
    }

    async connectPhantom() {
        // COPY FROM dashboard.html lines 1385-1407
        const phantom = window.solana;
        await phantom.connect();
        return { provider: phantom, address: phantom.publicKey.toString() };
    }

    async getMerchantWallet() {
        const response = await fetch(`/api/v1/admin?resource=wallets&merchantId=${this.merchantId}`);
        const wallets = await response.json();
        const wallet = wallets.find(w => w.chain === this.chain && w.isActive);
        return wallet.address;
    }

    async createOrder(merchantWallet) {
        const response = await fetch('/api/v1/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchantId: this.merchantId,
                amount: this.amount,
                chain: this.chain,
                customerName: 'Widget Payment',
                paymentAddress: merchantWallet
            })
        });
        const { order } = await response.json();
        return order;
    }

    async executeEVMPayment(wallet, orderId, merchantWallet) {
        // COPY FROM dashboard.html lines 1466-1635
        // Key points:
        // - USDC address: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
        // - Chain ID: 0x14a34 (Base Sepolia)
        // - Switch network if needed
        // - Transfer USDC using ethers.js
        // - Return tx.hash
    }

    async executeSolanaPayment(wallet, orderId, merchantWallet) {
        // COPY FROM dashboard.html lines 1637-1933
        // Key points:
        // - USDC mint: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
        // - RPC: https://api.devnet.solana.com
        // - Create SPL token transfer
        // - Return signature
    }

    async confirmOrder(orderId, txHash) {
        await fetch(`/api/v1/orders/${orderId}/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txHash })
        });
    }
}
```

**UI Requirements:**
- Show amount in USDC
- Show chain selector (Base Sepolia / Solana Devnet)
- "Connect Wallet" button → **triggers MetaMask/Phantom browser popup**
- "Pay Now" button (shows after wallet connected) → **triggers transaction in wallet**
- Loading states while transaction confirms
- Success message with transaction hash + link to block explorer
- Error messages (wallet not found, insufficient funds, etc.)
- Dark theme matching StablePay dashboard

**How Merchant (Unlock) Uses It:**

```html
<!-- On their website (e.g., checkout page for IMEI unlock) -->
<script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>

<div class="stablepay-checkout"
     data-merchant="cmhkjckgi0000qut5wxmtsw1f"
     data-amount="10.00"
     data-chain="BASE_SEPOLIA">
</div>

<script>
// Listen for successful payment
document.querySelector('.stablepay-checkout').addEventListener('stablepay:payment.success', (event) => {
    const { orderId, txHash, amount } = event.detail;

    // Now THEY write to THEIR database
    fetch('/their-api/unlock-imei', {
        method: 'POST',
        body: JSON.stringify({
            imei: '123456789',
            paymentOrderId: orderId,
            paymentTxHash: txHash,
            amountPaid: amount,
            status: 'paid'
        })
    });

    // YOUR database already has:
    // - Orders table: { id: orderId, status: "CONFIRMED" }
    // - Transactions table: { txHash, orderId, amount, ... }
});
</script>
```

---

### Part 2: Create Hosted Checkout Page (`/public/checkout.html`)

**What it does:**
1. Read `orderId` from URL query parameter
2. Fetch order details from API
3. Show payment amount and merchant name
4. Connect wallet and execute transaction
5. Show success/failure

**Structure:**
```html
<!DOCTYPE html>
<html>
<head>
    <title>StablePay Checkout</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js"></script>
    <script src="https://unpkg.com/@solana/web3.js@latest/lib/index.iife.min.js"></script>
</head>
<body class="bg-slate-900 text-white">
    <div id="checkout-container" class="max-w-md mx-auto mt-20">
        <!-- Payment card -->
        <div class="bg-slate-950 border border-slate-800 rounded-lg p-8">
            <h1 class="text-2xl font-bold mb-6">Complete Payment</h1>

            <div id="order-details">
                <!-- Amount, merchant, chain -->
            </div>

            <button id="connectWalletBtn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded">
                Connect Wallet
            </button>

            <div id="status"></div>
        </div>
    </div>

    <script>
        // Parse orderId from URL
        const params = new URLSearchParams(window.location.search);
        const orderId = params.get('orderId');

        // Fetch order details
        async function loadOrder() {
            const response = await fetch(`/api/v1/orders/${orderId}`);
            const order = await response.json();
            // Display order details
            // Show connect wallet button
        }

        // Use same wallet connection logic from widget
        // Execute payment
        // Confirm order
        // Show success
    </script>
</body>
</html>
```

---

### Part 3: Update Demo Page (`/public/demo-integration.html`)

**Add working examples:**
1. Embedded widget example (actually works)
2. Hosted checkout example (create order + redirect)
3. Show code snippets for integration

---

### Part 4: Update Dashboard Developer Tab (`/public/dashboard.html`)

**Location:** Lines 284-500 (Developer tab content)

**Add these sections:**

#### A. Quick Start Guide
```html
<div class="bg-slate-950 border border-slate-800 p-6 mb-6">
    <h3 class="text-lg font-semibold text-white mb-4">Quick Start - Embedded Widget</h3>

    <div class="space-y-4">
        <div>
            <div class="text-sm font-medium text-slate-300 mb-2">1. Add the script to your HTML</div>
            <div class="bg-gray-900 p-3 rounded overflow-x-auto">
                <pre class="text-xs text-green-400 font-mono">&lt;script src="https://stablepay-nine.vercel.app/checkout-widget.js"&gt;&lt;/script&gt;</pre>
            </div>
        </div>

        <div>
            <div class="text-sm font-medium text-slate-300 mb-2">2. Add the checkout div</div>
            <div class="bg-gray-900 p-3 rounded overflow-x-auto">
                <pre class="text-xs text-green-400 font-mono">&lt;div class="stablepay-checkout"
     data-merchant="<span id="merchantIdPlaceholder">YOUR_MERCHANT_ID</span>"
     data-amount="10.00"
     data-chain="BASE_SEPOLIA"&gt;
&lt;/div&gt;</pre>
            </div>
        </div>

        <div>
            <div class="text-sm font-medium text-slate-300 mb-2">3. Test on Base Sepolia</div>
            <p class="text-xs text-slate-400">Get testnet USDC from the Base Sepolia faucet</p>
        </div>
    </div>
</div>
```

#### B. Hosted Checkout Guide
```html
<div class="bg-slate-950 border border-slate-800 p-6 mb-6">
    <h3 class="text-lg font-semibold text-white mb-4">Hosted Checkout</h3>

    <div class="bg-gray-900 p-4 rounded mb-4">
        <pre class="text-xs text-green-400 font-mono">// 1. Create order
const response = await fetch('/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        merchantId: 'YOUR_MERCHANT_ID',
        amount: '10.00',
        chain: 'BASE_SEPOLIA',
        paymentAddress: 'YOUR_BASE_WALLET'
    })
});

const { order } = await response.json();

// 2. Redirect to checkout
window.location.href = `https://stablepay-nine.vercel.app/checkout?orderId=${order.id}`;

// 3. Customer completes payment
// 4. Check order status after redirect back</pre>
    </div>

    <button onclick="testHostedCheckout()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm">
        Try Hosted Checkout
    </button>
</div>

<script>
async function testHostedCheckout() {
    // Create test order
    const wallets = merchantWallets; // from existing dashboard code
    const baseWallet = wallets.find(w => w.chain === 'BASE_SEPOLIA');

    if (!baseWallet) {
        alert('Please configure a Base Sepolia wallet first');
        return;
    }

    const response = await fetch('/api/v1/orders', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionStorage.getItem('merchantToken')}`
        },
        body: JSON.stringify({
            merchantId: currentMerchant.id,
            amount: '5.00',
            chain: 'BASE_SEPOLIA',
            customerName: 'Test Checkout',
            paymentAddress: baseWallet.address
        })
    });

    const { order } = await response.json();
    window.open(`/checkout?orderId=${order.id}`, '_blank');
}
</script>
```

---

## Key Code to Copy

### MetaMask Connection (Lines 1338-1383 in dashboard.html)
```javascript
let ethereum = window.ethereum;
if (window.ethereum?.providers) {
    ethereum = window.ethereum.providers.find(p => p.isMetaMask);
}

const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
const provider = new ethers.BrowserProvider(ethereum);
const signer = await provider.getSigner();
const address = await signer.getAddress();
```

### EVM Payment (Lines 1466-1635 in dashboard.html)
```javascript
// Switch to Base Sepolia if needed
const chainConfig = {
    chainId: '0x14a34',
    chainName: 'Base Sepolia',
    rpcUrls: ['https://sepolia.base.org'],
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }
};

const network = await provider.getNetwork();
if (network.chainId !== BigInt(parseInt(chainConfig.chainId, 16))) {
    await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainConfig.chainId }]
    });
}

// Transfer USDC
const usdcAddress = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const usdcContract = new ethers.Contract(
    usdcAddress,
    ['function transfer(address to, uint256 amount) returns (bool)'],
    signer
);

const amount = ethers.parseUnits(amountString, 6); // USDC has 6 decimals
const tx = await usdcContract.transfer(merchantWallet, amount);
await tx.wait();

return tx.hash;
```

### Phantom Connection (Lines 1385-1407 in dashboard.html)
```javascript
const phantom = window.solana;
await phantom.connect();
const address = phantom.publicKey.toString();
```

### Solana Payment (Lines 1637-1933 in dashboard.html)
```javascript
const connection = new solanaWeb3.Connection('https://api.devnet.solana.com');
const usdcMint = new solanaWeb3.PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

// Get associated token accounts
// Create destination account if needed
// Transfer SPL tokens
// Return signature
```

---

## API Endpoints (Already Working)

### Get Merchant Wallets
```
GET /api/v1/admin?resource=wallets&merchantId=xxx
Returns: [{ chain, address, isActive }]
```

### Create Order
```
POST /api/v1/orders
Body: { merchantId, amount, chain, paymentAddress }
Returns: { order: { id, status: "PENDING" } }
```

### Confirm Order
```
POST /api/v1/orders/:id/confirm
Body: { txHash }
Returns: { order: { status: "CONFIRMED" } }
```

---

## Testing Checklist

### Base Sepolia Testing
1. ✅ Install MetaMask
2. ✅ Switch to Base Sepolia network (chainId: 0x14a34)
3. ✅ Add USDC token: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
4. ✅ Get testnet ETH (for gas)
5. ✅ Get testnet USDC
6. ✅ Open demo page
7. ✅ Click "Pay Now"
8. ✅ Approve transaction in MetaMask
9. ✅ Verify order shows as CONFIRMED in dashboard

### Solana Devnet Testing
1. ✅ Install Phantom
2. ✅ Switch to Devnet
3. ✅ Get devnet SOL (for fees)
4. ✅ Get devnet USDC
5. ✅ Open demo page
6. ✅ Click "Pay Now"
7. ✅ Approve in Phantom
8. ✅ Verify order confirmed

---

## Dependencies Already Loaded

The dashboard already loads these libraries - use the same versions:

```html
<!-- EVM/Ethereum -->
<script src="https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js"></script>

<!-- Solana -->
<script src="https://unpkg.com/@solana/web3.js@latest/lib/index.iife.min.js"></script>

<!-- Tailwind CSS -->
<script src="https://cdn.tailwindcss.com"></script>
```

---

## Success Criteria

✅ Merchant can copy widget code from Developer tab
✅ Widget works on merchant's website
✅ Customer can connect MetaMask (Base) or Phantom (Solana)
✅ Customer can complete USDC payment
✅ Transaction confirms on blockchain
✅ Order updates to CONFIRMED in database
✅ Merchant sees payment in Orders tab

✅ Hosted checkout works (create order → redirect → pay → redirect back)
✅ Demo page shows both integration methods working

---

## What You DON'T Need to Build

❌ Backend API (already done)
❌ Database schema (already done)
❌ Merchant dashboard (already done)
❌ Wallet configuration UI (already done)
❌ Multi-chain support beyond Base + Solana (later)
❌ Mainnet support (later)
❌ Other tokens besides USDC (later)
❌ Refunds (later)
❌ Token swaps (later)

---

## Estimated Breakdown

- Update checkout widget: **2 hours**
- Create hosted checkout page: **1.5 hours**
- Update demo page: **30 minutes**
- Add Developer tab docs: **1 hour**
- Testing both chains: **1 hour**

**Total: 5-6 hours**

---

## Questions?

All the working code is in `/public/dashboard.html` - specifically the "Test Payment" button and its wallet connection logic. Just copy that code into the widget and hosted checkout page.

The API is production-ready. Just call the endpoints and your Orders/Transactions tables will update automatically.

Ready to build? 🚀
