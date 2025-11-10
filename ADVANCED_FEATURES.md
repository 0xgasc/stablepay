# StablePay Advanced Features - Refunds & Token Swaps

## Feature 1: Refund System

### Overview
Allow merchants to refund customers by sending stablecoins back on-chain. Optional escrow via smart contract.

### Architecture Options

#### Option A: Direct Refunds (Simple - Start Here)
- Merchant has USDC in their wallet
- Admin approves refund request
- Backend triggers transaction from merchant wallet → customer wallet
- No smart contract needed

**Pros:** Simple, fast to implement
**Cons:** Merchant needs to sign each refund, no automation

#### Option B: Escrow Contract (Advanced - Future)
- Smart contract holds payment in escrow
- After X days or merchant approval → releases to merchant
- Refund window: Customer can request refund before release
- Contract automatically sends refund if approved

**Pros:** Trustless, automated, no merchant signatures needed
**Cons:** More complex, gas costs, contract deployment

### Database Schema (Already Exists!)

```sql
-- You already have this table!
Refund {
  id              String
  orderId         String
  amount          Decimal
  reason          String
  status          RefundStatus  -- PENDING, APPROVED, REJECTED, PROCESSED
  approvedBy      String?       -- Admin who approved
  refundTxHash    String?       -- Transaction hash when sent
  createdAt       DateTime
  updatedAt       DateTime
}

enum RefundStatus {
  PENDING      -- Customer/merchant requested
  APPROVED     -- Admin approved, ready to process
  REJECTED     -- Admin rejected
  PROCESSED    -- Refund sent on-chain
}
```

### UI Flow

#### Merchant Dashboard - Orders Tab
```
[Order Details]
Amount: 10.00 USDC
Status: CONFIRMED
Customer: customer@example.com

[Refund Button] ← New button
```

#### Refund Modal
```
┌─────────────────────────────────┐
│ Refund Order                    │
├─────────────────────────────────┤
│ Order Amount: 10.00 USDC        │
│                                 │
│ Refund Amount:                  │
│ [10.00] USDC (Partial allowed) │
│                                 │
│ Reason:                         │
│ [Text area]                     │
│                                 │
│ Customer Wallet:                │
│ [0x123...] (from order tx)     │
│                                 │
│ [Request Refund] [Cancel]      │
└─────────────────────────────────┘
```

#### Admin Console - Refunds Tab (NEW)
```
Refund Requests
┌─────────────┬──────────┬─────────┬────────────┬────────┐
│ Order ID    │ Amount   │ Reason  │ Requested  │ Action │
├─────────────┼──────────┼─────────┼────────────┼────────┤
│ order_xxx   │ 10 USDC  │ Item..  │ 2m ago     │ [Approve] [Reject] │
│ order_yyy   │ 5 USDC   │ Wrong.. │ 1h ago     │ [Approve] [Reject] │
└─────────────┴──────────┴─────────┴────────────┴────────┘

[Approved] → Shows "Process Refund" button
  → Admin clicks → Backend signs transaction → Sends USDC
```

### API Endpoints (Skeleton)

```javascript
// Merchant requests refund
POST /api/v1/orders/:orderId/refund
{
  "amount": "10.00",
  "reason": "Customer requested cancellation",
  "customerWallet": "0x123..." // from original transaction
}

Response:
{
  "success": true,
  "refund": {
    "id": "refund_xxx",
    "status": "PENDING",
    "amount": "10.00"
  }
}

// Admin approves refund
POST /api/v1/admin/refunds/:refundId/approve
{
  "approvedBy": "admin@stablepay.com"
}

// Admin processes refund (sends transaction)
POST /api/v1/admin/refunds/:refundId/process
{
  "merchantSignature": "0xsig..." // or use backend wallet
}

Response:
{
  "success": true,
  "txHash": "0xabc...",
  "status": "PROCESSED"
}

// List refunds
GET /api/v1/admin/refunds?status=PENDING
GET /api/v1/orders/:orderId/refunds
```

### Smart Contract (Option B - Future)

```solidity
// StablePayEscrow.sol
contract StablePayEscrow {
    struct Payment {
        address customer;
        address merchant;
        uint256 amount;
        address token; // USDC address
        uint256 timestamp;
        bool released;
        bool refunded;
    }

    mapping(bytes32 => Payment) public payments;
    uint256 public escrowPeriod = 7 days;

    // Customer pays into escrow
    function createPayment(bytes32 orderId, address merchant, uint256 amount) external {
        IERC20(usdcAddress).transferFrom(msg.sender, address(this), amount);

        payments[orderId] = Payment({
            customer: msg.sender,
            merchant: merchant,
            amount: amount,
            token: usdcAddress,
            timestamp: block.timestamp,
            released: false,
            refunded: false
        });
    }

    // Merchant claims after escrow period
    function release(bytes32 orderId) external {
        Payment storage payment = payments[orderId];
        require(block.timestamp >= payment.timestamp + escrowPeriod, "Escrow period not over");
        require(!payment.released && !payment.refunded, "Already processed");

        payment.released = true;
        IERC20(payment.token).transfer(payment.merchant, payment.amount);
    }

    // Refund during escrow period (admin or merchant signs)
    function refund(bytes32 orderId, bytes memory signature) external {
        Payment storage payment = payments[orderId];
        require(!payment.released && !payment.refunded, "Already processed");

        // Verify signature from merchant or admin
        require(verifySignature(orderId, signature), "Invalid signature");

        payment.refunded = true;
        IERC20(payment.token).transfer(payment.customer, payment.amount);
    }
}
```

---

## Feature 2: Accept Any Token → Auto-Swap to Stablecoin

### Overview
Customer pays in ETH, MATIC, SOL, or any ERC20/SPL token → Smart contract/DEX swaps to USDC → Merchant receives USDC.

### Why This is Complex
1. **DEX Integration** - Need to integrate with Uniswap (EVM) or Jupiter (Solana)
2. **Slippage** - Token price fluctuates during swap
3. **Gas Costs** - Swap + transfer costs more gas
4. **Refunds** - Store original token amount? Or refund in USDC?

### Architecture

```
Customer                 Smart Contract              Merchant
   |                          |                         |
   |--[100 MATIC]------------>|                         |
   |                          |                         |
   |                    [Swap on Uniswap]               |
   |                    100 MATIC → 10.5 USDC           |
   |                          |                         |
   |                          |------[10 USDC]--------->|
   |                          |                         |
   |                    [Store in DB]                   |
   |                    - Order: 10 USDC                |
   |                    - Original: 100 MATIC           |
   |                    - Swap rate: 0.105              |
```

### Smart Contract (EVM - Uniswap)

```solidity
// StablePayRouter.sol
contract StablePayRouter {
    IUniswapV2Router02 public uniswapRouter;
    address public usdcAddress;

    struct Order {
        bytes32 orderId;
        address customer;
        address merchant;
        address tokenIn;      // Original token (ETH, MATIC, etc)
        uint256 amountIn;     // Original amount
        uint256 usdcAmount;   // Final USDC amount
        uint256 timestamp;
    }

    mapping(bytes32 => Order) public orders;

    // Pay with any token
    function payWithToken(
        bytes32 orderId,
        address merchant,
        address tokenIn,
        uint256 amountIn,
        uint256 minUsdcOut  // Slippage protection
    ) external {
        // Transfer token from customer
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Approve Uniswap to spend
        IERC20(tokenIn).approve(address(uniswapRouter), amountIn);

        // Swap path: tokenIn → WETH → USDC (if needed)
        address[] memory path = getSwapPath(tokenIn, usdcAddress);

        // Execute swap
        uint[] memory amounts = uniswapRouter.swapExactTokensForTokens(
            amountIn,
            minUsdcOut,        // Minimum USDC to receive
            path,
            merchant,          // Send USDC directly to merchant
            block.timestamp + 300  // 5 min deadline
        );

        uint256 usdcReceived = amounts[amounts.length - 1];

        // Store order details
        orders[orderId] = Order({
            orderId: orderId,
            customer: msg.sender,
            merchant: merchant,
            tokenIn: tokenIn,
            amountIn: amountIn,
            usdcAmount: usdcReceived,
            timestamp: block.timestamp
        });

        emit PaymentProcessed(orderId, tokenIn, amountIn, usdcReceived);
    }

    // Pay with native ETH/MATIC
    function payWithNative(
        bytes32 orderId,
        address merchant,
        uint256 minUsdcOut
    ) external payable {
        // Wrap native to WETH
        IWETH(wethAddress).deposit{value: msg.value}();

        // Same swap logic as above...
    }

    // Get quote before payment
    function getQuote(address tokenIn, uint256 amountIn) public view returns (uint256 usdcOut) {
        address[] memory path = getSwapPath(tokenIn, usdcAddress);
        uint[] memory amounts = uniswapRouter.getAmountsOut(amountIn, path);
        return amounts[amounts.length - 1];
    }
}
```

### Solana Version (Jupiter Aggregator)

```javascript
// Use Jupiter API to get best swap route
async function swapToUSDC(tokenMint, amount, userWallet) {
  // 1. Get quote from Jupiter
  const quoteResponse = await fetch(
    `https://quote-api.jup.ag/v6/quote?` +
    `inputMint=${tokenMint}&` +
    `outputMint=${USDC_MINT}&` +
    `amount=${amount}&` +
    `slippageBps=50`  // 0.5% slippage
  );

  const quote = await quoteResponse.json();

  // 2. Get swap transaction
  const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: userWallet.toString(),
      destinationWallet: merchantWallet.toString()
    })
  });

  const { swapTransaction } = await swapResponse.json();

  // 3. Sign and send
  const tx = Transaction.from(Buffer.from(swapTransaction, 'base64'));
  const signature = await userWallet.signAndSendTransaction(tx);

  return {
    signature,
    inputAmount: amount,
    outputAmount: quote.outAmount
  };
}
```

### Database Schema Updates

```prisma
model Order {
  // ... existing fields

  // New fields for token swaps
  originalToken     String?   // "ETH", "MATIC", "SOL", token address
  originalAmount    Decimal?  // Amount in original token
  swapRate          Decimal?  // Exchange rate used
  swapTxHash        String?   // Swap transaction hash (if separate from payment)
}

model SwapConfig {
  id              String   @id @default(cuid())
  chain           Chain
  dexRouter       String   // Uniswap router address
  slippageBps     Int      @default(50)  // 0.5% slippage tolerance
  isActive        Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Admin Toggle UI

```html
<!-- enterprise-admin.html - System Settings -->
<div class="bg-slate-950 border p-6">
  <h3 class="text-lg font-semibold text-white mb-4">Advanced Features</h3>

  <!-- Refunds Toggle -->
  <div class="border-b border-slate-800 pb-4 mb-4">
    <label class="flex items-center justify-between cursor-pointer">
      <div>
        <div class="font-medium text-white">Enable Refunds</div>
        <div class="text-sm text-slate-400">Allow merchants to refund orders</div>
      </div>
      <input type="checkbox" id="enableRefunds" class="toggle-switch">
    </label>

    <div id="refundsConfig" class="mt-4 pl-4 border-l-2 border-blue-600 hidden">
      <div class="space-y-3">
        <label class="block">
          <span class="text-sm text-slate-300">Refund Method</span>
          <select class="w-full mt-1 bg-slate-900 border border-slate-800 text-white p-2 rounded">
            <option value="direct">Direct Transfer (Admin Approval)</option>
            <option value="escrow">Escrow Contract (Automated)</option>
          </select>
        </label>

        <label class="block">
          <span class="text-sm text-slate-300">Max Refund Period (Days)</span>
          <input type="number" value="30" class="w-full mt-1 bg-slate-900 border border-slate-800 text-white p-2 rounded">
        </label>
      </div>
    </div>
  </div>

  <!-- Token Swaps Toggle -->
  <div>
    <label class="flex items-center justify-between cursor-pointer">
      <div>
        <div class="font-medium text-white">Accept Any Token (Auto-Swap)</div>
        <div class="text-sm text-slate-400">Allow payments in ETH, MATIC, SOL → auto-convert to USDC</div>
      </div>
      <input type="checkbox" id="enableSwaps" class="toggle-switch">
    </label>

    <div id="swapsConfig" class="mt-4 pl-4 border-l-2 border-purple-600 hidden">
      <div class="space-y-3">
        <label class="block">
          <span class="text-sm text-slate-300">Max Slippage Tolerance</span>
          <input type="number" value="0.5" step="0.1" class="w-full mt-1 bg-slate-900 border border-slate-800 text-white p-2 rounded">
          <span class="text-xs text-slate-500">% (0.5% = 50 basis points)</span>
        </label>

        <label class="flex items-center">
          <input type="checkbox" checked class="mr-2">
          <span class="text-sm text-slate-300">Use Uniswap V3 (EVM)</span>
        </label>

        <label class="flex items-center">
          <input type="checkbox" checked class="mr-2">
          <span class="text-sm text-slate-300">Use Jupiter (Solana)</span>
        </label>

        <div class="bg-yellow-900/20 border border-yellow-800 rounded p-3 mt-3">
          <div class="text-sm text-yellow-300 font-medium">⚠️ Warning</div>
          <div class="text-xs text-yellow-400 mt-1">
            Smart contract deployment required. Additional gas costs apply.
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### Merchant Dashboard Updates

```html
<!-- Show token swap info in orders table -->
<tr>
  <td>order_xxx</td>
  <td>10.00 USDC <span class="text-xs text-slate-500">(from 100 MATIC)</span></td>
  <td>BASE MAINNET</td>
  <td>CONFIRMED</td>
  <td>
    <a href="..." class="text-blue-400">0xabc... (Swap)</a>
  </td>
  <td>
    <button class="refund-btn">Refund</button>  <!-- NEW -->
  </td>
</tr>
```

---

## Implementation Phases

### Phase 1: Refunds (Direct - No Contract)
**Priority: HIGH** - Can implement immediately

1. ✅ Add "Refund" button to Orders tab
2. ✅ Create refund request modal
3. ✅ Build API endpoints (already have Refund table!)
4. ✅ Add Refunds tab to admin console
5. ✅ Admin approves → Backend sends USDC from merchant wallet
6. ✅ Add admin toggle to enable/disable feature

**Files to modify:**
- `/public/dashboard.html` - Add refund button and modal
- `/public/enterprise-admin.html` - Add refunds tab and toggle
- `/api/v1/orders.js` - Add refund endpoints
- `/src/services/orderService.ts` - Add refund logic

### Phase 2: Token Swaps (Simple Quote)
**Priority: MEDIUM** - Requires DEX integration

1. Add "Accept Any Token" toggle in admin
2. Show token selector in checkout widget
3. Get quote from Uniswap/Jupiter API
4. Display: "100 MATIC = ~10.5 USDC"
5. Customer approves swap
6. Execute swap via DEX aggregator
7. Store original token + amount in Order

**Files to create:**
- `/src/services/swapService.ts` - DEX integration
- `/contracts/StablePayRouter.sol` - Smart contract (optional)

### Phase 3: Escrow Contract
**Priority: LOW** - Advanced feature

1. Deploy escrow contract per chain
2. Payments go to contract instead of merchant wallet
3. Auto-release after X days or merchant approval
4. Refunds processed automatically by contract

---

## Next Steps - What Do You Want First?

**Option A: Start with Refunds (Recommended)**
- I'll build the refund UI, API endpoints, and admin toggle
- No smart contracts needed
- Can launch in 1-2 days

**Option B: Start with Token Swaps**
- More complex, requires DEX integration
- Need to deploy/test smart contracts
- Higher risk, more moving parts

**Option C: Do Both Skeletons**
- I'll create the UI and API structure for both
- Leave actual implementation for later
- Admin can toggle them on when ready

Which one you want me to build first? 🚀
