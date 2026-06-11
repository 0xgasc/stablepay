# StablePay Refund System - Complete Design

## Overview

Merchants can issue full or partial refunds to customers by connecting their wallet and executing USDC transactions directly from the dashboard.

---

## Architecture

### Flow Diagram

```
[Customer Payment] → [Order Created] → [Transaction Confirmed]
                                              ↓
                                    [Merchant Dashboard]
                                              ↓
                              [Request Refund] → [Enter Amount]
                                              ↓
                              [Connect Merchant Wallet] (MetaMask/Phantom)
                                              ↓
                              [Execute Refund Transaction]
                                              ↓
                              [Refund Confirmed] → [Update Database]
```

---

## Key Features

### 1. Flexible Refund Policy
- **Full refunds** (100% of order amount)
- **Partial refunds** (merchant chooses amount)
- **Reason tracking** (merchant notes why)
- **Approval workflow** (optional - can be disabled)

### 2. Wallet Connection
- Merchant connects their wallet (same wallet that received payment)
- MetaMask for EVM chains (Base, Ethereum, Polygon, Arbitrum)
- Phantom for Solana
- **Security:** Transaction signed client-side, no private keys stored

### 3. Batch Refunds (Advanced)
- Select multiple orders
- Execute all refunds in one transaction batch
- Gas optimization (Multicall for EVM, versioned transactions for Solana)

---

## Database Schema (Already Exists)

```prisma
model Refund {
  id              String       @id @default(cuid())
  orderId         String
  amount          Decimal      @db.Decimal(18, 6)
  reason          String
  status          RefundStatus @default(PENDING)
  approvedBy      String?      // Optional: if approval workflow enabled
  refundTxHash    String?      // Blockchain transaction hash
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  order           Order        @relation(fields: [orderId], references: [id])
}

enum RefundStatus {
  PENDING      // Refund requested, not yet processed
  APPROVED     // Approved (if approval workflow enabled)
  REJECTED     // Rejected by merchant/admin
  PROCESSING   // Transaction being executed
  COMPLETED    // Refund sent successfully
  FAILED       // Transaction failed
}
```

---

## UI Design

### Location: Dashboard → Orders Tab

**Current State:**
- "Refund" button already exists for confirmed orders
- Modal skeleton already built (lines 635-698)

**Enhancements:**

#### 1. Refund Button (Existing)
```html
<!-- Shows for orders with status CONFIRMED or PAID -->
<button onclick="openRefundModal(orderId, amount, chain)">
    Refund
</button>
```

#### 2. Refund Modal (Enhanced)
```html
<div id="refundModal" class="modal">
    <h3>Issue Refund</h3>

    <!-- Order Info (Read-only) -->
    <div>
        <label>Order ID:</label>
        <input type="text" id="refundOrderId" readonly />

        <label>Original Amount:</label>
        <input type="text" id="refundOriginalAmount" readonly />

        <label>Customer Wallet:</label>
        <input type="text" id="refundCustomerWallet" readonly />

        <label>Chain:</label>
        <input type="text" id="refundChain" readonly />
    </div>

    <!-- Refund Details -->
    <div>
        <label>Refund Amount (USDC):</label>
        <input type="number" id="refundAmount" step="0.01"
               placeholder="Enter amount" />
        <button onclick="setFullRefund()">Full Refund</button>

        <label>Reason (optional):</label>
        <textarea id="refundReason" rows="3"
                  placeholder="E.g., Customer requested cancellation"></textarea>
    </div>

    <!-- Wallet Connection Status -->
    <div id="refundWalletStatus">
        <p>⚠️ Connect your wallet to process refund</p>
        <button onclick="connectRefundWallet()">
            Connect Wallet
        </button>
    </div>

    <!-- Refund Execution -->
    <div id="refundExecutionPanel" class="hidden">
        <div class="warning">
            ⚠️ You will send <strong id="refundAmountDisplay"></strong> USDC
            from your wallet to <strong id="refundRecipientDisplay"></strong>
        </div>

        <button onclick="executeRefund()" class="btn-danger">
            Send Refund
        </button>
    </div>

    <!-- Status Messages -->
    <div id="refundStatus"></div>
</div>
```

#### 3. Batch Refund UI (New)
```html
<div class="orders-actions">
    <button onclick="toggleBatchMode()">Batch Refund</button>
</div>

<!-- When batch mode is active -->
<table id="ordersTable">
    <thead>
        <tr>
            <th><input type="checkbox" onclick="selectAllOrders()" /></th>
            <th>Order ID</th>
            <th>Amount</th>
            <th>Customer</th>
            <!-- ... -->
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><input type="checkbox" class="order-select" data-order-id="xxx" /></td>
            <!-- ... -->
        </tr>
    </tbody>
</table>

<div id="batchRefundPanel" class="hidden">
    <p><strong id="batchRefundCount">0</strong> orders selected</p>
    <p>Total refund amount: <strong id="batchRefundTotal">0.00</strong> USDC</p>
    <button onclick="executeBatchRefund()">Process Batch Refund</button>
</div>
```

---

## Implementation

### Step 1: Connect Wallet (EVM)

```javascript
// Connect MetaMask for refund
async function connectRefundWallet() {
    try {
        let ethereum = window.ethereum;
        if (window.ethereum?.providers) {
            ethereum = window.ethereum.providers.find(p => p.isMetaMask);
        }

        const accounts = await ethereum.request({
            method: 'eth_requestAccounts'
        });

        const provider = new ethers.BrowserProvider(ethereum);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();

        // Verify this is the merchant's wallet
        const expectedWallet = merchantWallets.find(
            w => w.chain === currentRefundChain && w.isActive
        );

        if (address.toLowerCase() !== expectedWallet.address.toLowerCase()) {
            alert('⚠️ Please connect the wallet that received the original payment: ' +
                  expectedWallet.address);
            return;
        }

        // Store for refund execution
        window.refundWallet = { provider, signer, address };

        // Update UI
        document.getElementById('refundWalletStatus').innerHTML =
            `✅ Connected: ${address.slice(0, 6)}...${address.slice(-4)}`;
        document.getElementById('refundExecutionPanel').classList.remove('hidden');

    } catch (error) {
        console.error('Wallet connection error:', error);
        alert('Failed to connect wallet: ' + error.message);
    }
}
```

### Step 2: Execute Single Refund (EVM)

```javascript
async function executeRefund() {
    const orderId = document.getElementById('refundOrderId').value;
    const amount = document.getElementById('refundAmount').value;
    const reason = document.getElementById('refundReason').value;
    const chain = document.getElementById('refundChain').value;

    try {
        // Get order details
        const order = allOrders.find(o => o.id === orderId);
        if (!order || !order.transactions || order.transactions.length === 0) {
            throw new Error('No transaction found for this order');
        }

        // Customer wallet (from original transaction)
        const customerWallet = order.transactions[0].fromAddress;

        // Create refund record
        const refundResponse = await fetch('/api/v1/refunds', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sessionStorage.getItem('merchantToken')}`
            },
            body: JSON.stringify({
                orderId: orderId,
                amount: amount,
                reason: reason,
                status: 'PROCESSING'
            })
        });

        const { refund } = await refundResponse.json();

        // Update UI
        document.getElementById('refundStatus').innerHTML =
            '⏳ Executing refund transaction...';

        // Get chain config
        const chainConfig = getChainConfig(chain);
        const usdcAddress = chainConfig.tokens.USDC;

        // Execute USDC transfer
        const usdcContract = new ethers.Contract(
            usdcAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            window.refundWallet.signer
        );

        const amountInSmallestUnit = ethers.parseUnits(amount, 6);

        const tx = await usdcContract.transfer(
            customerWallet,
            amountInSmallestUnit
        );

        document.getElementById('refundStatus').innerHTML =
            `⏳ Transaction sent! Hash: ${tx.hash}<br>Waiting for confirmation...`;

        // Wait for confirmation
        const receipt = await tx.wait();

        // Update refund record
        await fetch(`/api/v1/refunds/${refund.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sessionStorage.getItem('merchantToken')}`
            },
            body: JSON.stringify({
                status: 'COMPLETED',
                refundTxHash: tx.hash
            })
        });

        // Success!
        document.getElementById('refundStatus').innerHTML =
            `✅ Refund completed!<br>
             Transaction: <a href="${chainConfig.blockExplorerUrls[0]}/tx/${tx.hash}" target="_blank">${tx.hash}</a>`;

        // Reload orders
        setTimeout(() => {
            closeRefundModal();
            loadOrders();
        }, 3000);

    } catch (error) {
        console.error('Refund execution error:', error);

        // Update refund status to failed
        document.getElementById('refundStatus').innerHTML =
            `❌ Refund failed: ${error.message}`;
    }
}
```

### Step 3: Execute Refund (Solana)

```javascript
async function executeSolanaRefund(orderId, amount, customerWallet) {
    try {
        const phantom = window.solana;
        const connection = new solanaWeb3.Connection(
            chain === 'SOLANA_MAINNET'
                ? 'https://api.mainnet-beta.solana.com'
                : 'https://api.devnet.solana.com'
        );

        const usdcMint = new solanaWeb3.PublicKey(
            chain === 'SOLANA_MAINNET'
                ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
                : '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
        );

        const fromPubkey = phantom.publicKey;
        const toPubkey = new solanaWeb3.PublicKey(customerWallet);
        const transferAmount = Math.floor(parseFloat(amount) * 1_000_000);

        // Get token accounts
        const fromTokenAccount = await getAssociatedTokenAddress(usdcMint, fromPubkey);
        const toTokenAccount = await getAssociatedTokenAddress(usdcMint, toPubkey);

        // Check if destination account exists
        const toAccountInfo = await connection.getAccountInfo(toTokenAccount);

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const transferTx = new solanaWeb3.Transaction();
        transferTx.recentBlockhash = blockhash;
        transferTx.feePayer = fromPubkey;

        // Create destination account if needed
        if (!toAccountInfo) {
            transferTx.add(
                createAssociatedTokenAccountInstruction(
                    fromPubkey,
                    toTokenAccount,
                    toPubkey,
                    usdcMint
                )
            );
        }

        // Add transfer instruction
        transferTx.add(
            createTransferInstruction(
                fromTokenAccount,
                toTokenAccount,
                fromPubkey,
                transferAmount
            )
        );

        // Sign and send
        const signedTx = await phantom.signTransaction(transferTx);
        const signature = await connection.sendRawTransaction(signedTx.serialize());

        // Wait for confirmation
        await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        });

        return signature;

    } catch (error) {
        console.error('Solana refund error:', error);
        throw error;
    }
}
```

### Step 4: Batch Refunds (EVM - Multicall)

```javascript
async function executeBatchRefund() {
    const selectedOrders = Array.from(
        document.querySelectorAll('.order-select:checked')
    ).map(cb => cb.dataset.orderId);

    if (selectedOrders.length === 0) {
        alert('Please select orders to refund');
        return;
    }

    try {
        // Create multicall contract instance
        const multicallAddress = '0xcA11bde05977b3631167028862bE2a173976CA11'; // Multicall3

        const multicallABI = [
            'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) returns (tuple(bool success, bytes returnData)[])'
        ];

        const multicall = new ethers.Contract(
            multicallAddress,
            multicallABI,
            window.refundWallet.signer
        );

        // Prepare all transfer calls
        const calls = [];
        for (const orderId of selectedOrders) {
            const order = allOrders.find(o => o.id === orderId);
            const customerWallet = order.transactions[0].fromAddress;
            const amount = ethers.parseUnits(order.amount, 6);

            const usdcInterface = new ethers.Interface([
                'function transfer(address to, uint256 amount) returns (bool)'
            ]);

            const callData = usdcInterface.encodeFunctionData('transfer', [
                customerWallet,
                amount
            ]);

            calls.push({
                target: chainConfig.tokens.USDC,
                allowFailure: false,
                callData: callData
            });
        }

        // Execute batch
        const tx = await multicall.aggregate3(calls);
        await tx.wait();

        // Update all refund records
        for (const orderId of selectedOrders) {
            await fetch('/api/v1/refunds', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionStorage.getItem('merchantToken')}`
                },
                body: JSON.stringify({
                    orderId: orderId,
                    amount: allOrders.find(o => o.id === orderId).amount,
                    reason: 'Batch refund',
                    status: 'COMPLETED',
                    refundTxHash: tx.hash
                })
            });
        }

        alert(`✅ Successfully refunded ${selectedOrders.length} orders!\nTransaction: ${tx.hash}`);
        loadOrders();

    } catch (error) {
        console.error('Batch refund error:', error);
        alert('Batch refund failed: ' + error.message);
    }
}
```

---

## API Endpoints

### Create Refund
```
POST /api/v1/refunds
Authorization: Bearer {token}

Body:
{
  "orderId": "order_123",
  "amount": "10.00",
  "reason": "Customer requested",
  "status": "PROCESSING"
}

Response:
{
  "success": true,
  "refund": {
    "id": "refund_456",
    "orderId": "order_123",
    "amount": "10.00",
    "status": "PROCESSING",
    "createdAt": "2025-11-11T..."
  }
}
```

### Update Refund
```
PATCH /api/v1/refunds/:refundId
Authorization: Bearer {token}

Body:
{
  "status": "COMPLETED",
  "refundTxHash": "0xabc123..."
}

Response:
{
  "success": true,
  "refund": {
    "id": "refund_456",
    "status": "COMPLETED",
    "refundTxHash": "0xabc123...",
    "updatedAt": "2025-11-11T..."
  }
}
```

### Get Refunds
```
GET /api/v1/refunds?merchantId={id}
Authorization: Bearer {token}

Response:
{
  "refunds": [
    {
      "id": "refund_456",
      "orderId": "order_123",
      "amount": "10.00",
      "reason": "Customer requested",
      "status": "COMPLETED",
      "refundTxHash": "0xabc123...",
      "createdAt": "2025-11-11T..."
    }
  ]
}
```

---

## Security Considerations

1. **Wallet Verification**
   - Ensure connected wallet matches the one that received payment
   - Verify merchant owns the wallet before allowing refund

2. **Amount Validation**
   - Refund amount cannot exceed original payment
   - Check merchant has sufficient USDC balance

3. **Transaction Verification**
   - Verify transaction hash on blockchain
   - Ensure refund goes to original payer

4. **Rate Limiting**
   - Prevent spam refund requests
   - Add cooldown between refunds

5. **Audit Trail**
   - Log all refund attempts
   - Store transaction hashes
   - Track who approved (if approval workflow)

---

## User Experience

### Success Flow
1. Merchant clicks "Refund" on order
2. Modal opens with pre-filled order details
3. Merchant enters refund amount and reason
4. Merchant connects wallet (MetaMask/Phantom)
5. System verifies wallet matches merchant's configured wallet
6. Merchant clicks "Send Refund"
7. Wallet popup shows transaction details
8. Merchant approves transaction
9. System waits for blockchain confirmation
10. Success message with transaction link
11. Order table updates with refund status

### Error Handling
- **Wallet not found:** "Please install MetaMask/Phantom"
- **Wrong wallet:** "Connect the wallet that received payment"
- **Insufficient balance:** "Insufficient USDC balance for refund"
- **Transaction failed:** "Refund failed. Please try again"
- **Network error:** "Connection failed. Check your internet"

---

## Testing Checklist

- [ ] Connect MetaMask for refund
- [ ] Connect Phantom for refund
- [ ] Execute full refund (100%)
- [ ] Execute partial refund (50%)
- [ ] Verify refund appears in Orders table
- [ ] Check blockchain explorer shows transaction
- [ ] Test with wrong wallet connected
- [ ] Test with insufficient balance
- [ ] Test batch refund (3 orders)
- [ ] Verify database updates correctly

---

## Next Steps

1. **Implement API endpoints** (`/src/routes/refunds.ts`)
2. **Update dashboard UI** (`/public/dashboard.html`)
3. **Add refund column to Orders table**
4. **Test on testnets** (Base Sepolia, Solana Devnet)
5. **Deploy to production**

---

**Status:** Ready for implementation
**Estimated Time:** 4-6 hours
**Priority:** High
