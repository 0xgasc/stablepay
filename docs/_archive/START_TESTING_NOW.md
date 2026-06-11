# 🧪 Start Testing Now - Step-by-Step Guide

## Current Status
**Production URL**: https://stablepay-nine.vercel.app
**Your Goal**: Test all new features (Refunds + Trust Center)
**Time Needed**: ~2 hours for critical tests

---

## ⚙️ Pre-Testing Setup (10 minutes)

### Step 1: Install Wallets

**MetaMask (for Base/Ethereum)**:
1. Install: https://metamask.io/download/
2. Create wallet or import existing
3. **SAVE YOUR SEED PHRASE SECURELY**

**Phantom (for Solana)** (Optional):
1. Install: https://phantom.app/download
2. Create wallet or import existing
3. **SAVE YOUR SEED PHRASE SECURELY**

---

### Step 2: Add Base Sepolia Network to MetaMask

1. Open MetaMask
2. Click network dropdown (top left)
3. Click "Add Network"
4. Click "Add a network manually"
5. Enter these details:

```
Network Name: Base Sepolia
RPC URL: https://sepolia.base.org
Chain ID: 84532
Currency Symbol: ETH
Block Explorer: https://sepolia.basescan.org
```

6. Click "Save"
7. Switch to Base Sepolia network

---

### Step 3: Get Test Tokens

**Get Sepolia ETH (for gas)**:
1. Go to: https://www.alchemy.com/faucets/base-sepolia
2. Paste your MetaMask wallet address
3. Click "Send Me ETH"
4. Wait 10-30 seconds
5. Check MetaMask - should see ~0.1 ETH

**Get USDC on Base Sepolia**:
1. Go to: https://faucet.circle.com/
2. Select "Base Sepolia"
3. Paste your wallet address
4. Complete captcha
5. Click "Get USDC"
6. Wait ~30 seconds
7. **Verify**: Go to BaseScan, search your address, you should see USDC

Alternative if Circle faucet doesn't work:
```
1. Go to: https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e#writeContract
2. Connect MetaMask
3. Find "mint" function
4. Enter your address and amount (e.g., 50000000 = 50 USDC with 6 decimals)
5. Click Write
```

---

### Step 4: Verify Your Setup

**Check in MetaMask**:
- [ ] Connected to Base Sepolia network
- [ ] Have some ETH (at least 0.01)
- [ ] Have some USDC (at least 10)

**Your wallet addresses**:
- MetaMask address: `0x...` (copy from MetaMask)
- Write it down: ___________________________

---

## 🚀 Test 1: Trust Center Page (5 minutes)

### Visit Trust Center
1. Go to: https://stablepay-nine.vercel.app/trust.html

### Test Checklist
- [ ] Page loads without errors
- [ ] Hero section shows "Your Security is Our Priority"
- [ ] 4 trust badges display (Non-Custodial, Encrypted, Uptime, GDPR)
- [ ] Click first section "Security & Compliance" - it expands
- [ ] Click second section "Privacy & Data Protection" - first closes, second opens
- [ ] Test all 7 sections - they all expand/collapse smoothly
- [ ] Scroll to footer - all 4 columns visible
- [ ] Click security@stablepay.io - opens mail client
- [ ] Click "Home" in header - goes to landing page

### Mobile Test (Optional)
- [ ] Resize browser to mobile width (< 768px)
- [ ] Trust badges stack vertically
- [ ] All sections still work
- [ ] No horizontal scroll

**✅ If all checks pass, Trust Center is working!**

---

## 🚀 Test 2: Landing Page Updates (5 minutes)

### Visit Homepage
1. Go to: https://stablepay-nine.vercel.app/

### Test Checklist
- [ ] "Security" link in navigation (top right)
- [ ] Click "Security" - goes to trust center
- [ ] Go back to homepage
- [ ] Scroll down - see "Built with Security & Trust" section
- [ ] 4 trust badges visible
- [ ] 3 security detail cards (Encryption, Infrastructure, Blockchain)
- [ ] Click "View Full Trust Center →" - goes to /trust.html
- [ ] Scroll to footer - 4 columns with Security section
- [ ] Click "Trust Center" in footer - goes to /trust.html

**✅ If all checks pass, Landing Page is updated!**

---

## 🚀 Test 3: Create Merchant Account (10 minutes)

### Sign Up
1. Go to: https://stablepay-nine.vercel.app/signup.html
2. Enter details:
   - Email: `test-merchant-${Date.now()}@test.com` (use unique email)
   - Company: "Test Company"
   - Contact Name: "Test User"
   - Password: "TestPass123!"
3. Click "Sign Up"

**Expected**: "Account created! Wait for approval" or similar message

### Approve Your Account (Need Admin Access)

**Option A: If you have admin credentials**:
1. Go to: https://stablepay-nine.vercel.app/enterprise-admin.html
2. Login with admin credentials
3. Find your test merchant in pending list
4. Click "Approve"

**Option B: Use existing Unlock merchant**:
Skip signup and use:
- Email: unlock@unlock.com
- Password: (you should know this)
- Merchant ID: cmhkjckgi0000qut5wxmtsw1f

**We'll use Unlock merchant for simplicity**

### Login to Dashboard
1. Go to: https://stablepay-nine.vercel.app/login.html
2. Enter Unlock credentials
3. Click "Login"

**Expected**:
- [ ] Dashboard loads
- [ ] Shows "Welcome back, Unlock" or similar
- [ ] Tabs visible: Orders, Wallets, Developer

---

## 🚀 Test 4: Configure Test Wallet (5 minutes)

### Go to Wallets Tab
1. Click "Wallets" tab in dashboard

### Configure Base Sepolia
1. Find "Base Sepolia" row
2. Toggle switch to ON (if not already)
3. Paste **YOUR MetaMask address** (0x...)
4. Scroll down
5. Click "Save Configuration"

**Expected**:
- [ ] Success message appears
- [ ] Wallet saved

**IMPORTANT**: Use YOUR wallet address (not Unlock's), so YOU receive the test payment

### Copy Your Merchant ID
1. Click "Developer" tab
2. Find "Merchant ID"
3. Copy it (e.g., `cmhkjckgi0000qut5wxmtsw1f`)
4. Save it: _______________________________

---

## 🚀 Test 5: Create Test Order & Payment (15 minutes)

### Create Order via API

**Open Terminal** and run:

```bash
curl -X POST https://stablepay-nine.vercel.app/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "YOUR_MERCHANT_ID_HERE",
    "amount": "5.00",
    "chain": "BASE_SEPOLIA",
    "paymentAddress": "YOUR_METAMASK_ADDRESS_HERE",
    "customerEmail": "customer@test.com",
    "customerName": "Test Customer"
  }'
```

**Replace**:
- `YOUR_MERCHANT_ID_HERE` - with your merchant ID from Developer tab
- `YOUR_METAMASK_ADDRESS_HERE` - with your MetaMask address

**Expected Response**:
```json
{
  "success": true,
  "order": {
    "id": "clxyz123...",
    "status": "PENDING",
    "amount": "5.00",
    ...
  }
}
```

**Copy the Order ID**: _______________________________

---

### Open Payment Page

1. Open browser
2. Go to: `https://stablepay-nine.vercel.app/crypto-pay.html?orderId=YOUR_ORDER_ID`
   - Replace `YOUR_ORDER_ID` with the ID from API response

**Expected**:
- [ ] Payment page loads
- [ ] Shows "Complete Your Purchase"
- [ ] Order summary shows $5.00 USDC
- [ ] Testnet banner at top

---

### Complete Payment

**Step 1: Connect Wallet**
1. Click "Connect Wallet" button
2. MetaMask popup appears
3. Select your account
4. Click "Connect"

**Expected**:
- [ ] Wallet address shows on page
- [ ] USDC balances load
- [ ] Base Sepolia shows your USDC amount

**Step 2: Enter Customer Info**
1. Customer info section appears
2. Email should be pre-filled: `customer@test.com`
3. Name should be pre-filled: `Test Customer`

**Step 3: Pay**
1. Scroll down to payment section
2. Chain selector should show "Base Sepolia"
3. Click "Pay Now" button

**Expected**:
- [ ] MetaMask popup appears
- [ ] Shows transaction details:
  - To: Your wallet address
  - Amount: ~5 USDC
- [ ] Gas fee shown (should be small, ~$0.01)

**Step 4: Approve Transaction**
1. Review transaction in MetaMask
2. Click "Confirm"
3. Wait 5-10 seconds

**Expected**:
- [ ] Page shows "Processing transaction..."
- [ ] Then shows "Payment Successful!" or similar
- [ ] Transaction hash displayed
- [ ] Link to BaseScan

---

### Verify Payment

**Check BaseScan**:
1. Click the BaseScan link on payment page
2. OR go to: https://sepolia.basescan.org/
3. Search for your transaction hash

**Expected**:
- [ ] Transaction confirmed (green checkmark)
- [ ] Shows USDC transfer
- [ ] From: Customer address
- [ ] To: Your wallet address
- [ ] Amount: 5 USDC

**Check Your Wallet**:
1. Open MetaMask
2. Check USDC balance
3. Should have increased by 5 USDC

**Check Dashboard**:
1. Go back to dashboard: https://stablepay-nine.vercel.app/dashboard.html
2. Click "Orders" tab
3. Look for your $5 order

**Expected**:
- [ ] Order shows in list
- [ ] Status: CONFIRMED (green)
- [ ] Amount: 5 USDC
- [ ] Transaction hash visible
- [ ] Customer email: customer@test.com
- [ ] Click BaseScan link - opens transaction

**✅ If all checks pass, Payment Flow is working!**

---

## 🚀 Test 6: Single Refund (15 minutes)

### Open Refund Modal
1. In dashboard Orders tab
2. Find your $5 CONFIRMED order
3. Look for "Refund" button in Actions column
4. Click "Refund"

**Expected**:
- [ ] Refund modal opens
- [ ] Order ID filled (read-only)
- [ ] Original amount: 5.00 USDC
- [ ] Chain: BASE_SEPOLIA
- [ ] Customer wallet pre-filled (the address that paid)
- [ ] Refund amount defaults to 5.00
- [ ] "Execute Refund" button DISABLED (wallet not connected)

---

### Connect Wallet for Refund
1. In refund modal, find "Connect Your Wallet" section
2. Click "MetaMask" button

**Expected**:
- [ ] MetaMask popup appears
- [ ] Select your account (same one with the USDC)
- [ ] Click "Connect"
- [ ] Wallet address shows in modal
- [ ] "Execute Refund" button becomes ENABLED

---

### Execute Refund

**Full Refund Test**:
1. Refund amount: Keep as 5.00 (full amount)
2. Reason: Enter "Testing refund system"
3. Customer wallet: Should be pre-filled
4. Click "Execute Refund"

**Expected**:
- [ ] Button shows "Processing..."
- [ ] MetaMask popup appears
- [ ] Transaction shows:
  - To: Customer address (address that originally paid)
  - Amount: 5 USDC
- [ ] Approve transaction
- [ ] Wait 5-10 seconds
- [ ] Success message: "Refund executed successfully!"
- [ ] Transaction hash shown
- [ ] Modal closes

---

### Verify Refund

**Check Dashboard**:
1. Orders tab should refresh
2. Look for your order

**Expected**:
- [ ] Order still shows
- [ ] May have refund indicator (check if implemented)

**Check Refunds** (if available):
1. Look for "Refunds" tab or section
2. Should show your refund

**Expected**:
- [ ] Refund listed
- [ ] Status: COMPLETED
- [ ] Amount: 5.00 USDC
- [ ] Transaction hash present

**Check BaseScan**:
1. Click refund transaction hash
2. OR search on https://sepolia.basescan.org/

**Expected**:
- [ ] Transaction confirmed
- [ ] USDC transfer
- [ ] From: Your wallet
- [ ] To: Customer wallet
- [ ] Amount: 5 USDC

**Check Customer Wallet Balance**:
(If you have access to customer wallet)
- [ ] Customer received 5 USDC back

**✅ If all checks pass, Single Refund is working!**

---

## 🚀 Test 7: Batch Refund (20 minutes)

### Create 3 More Test Orders

**Run this 3 times** (create 3 orders):

```bash
# Order 1
curl -X POST https://stablepay-nine.vercel.app/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "YOUR_MERCHANT_ID",
    "amount": "2.00",
    "chain": "BASE_SEPOLIA",
    "paymentAddress": "YOUR_WALLET_ADDRESS",
    "customerEmail": "batch1@test.com"
  }'

# Order 2
curl -X POST https://stablepay-nine.vercel.app/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "YOUR_MERCHANT_ID",
    "amount": "3.00",
    "chain": "BASE_SEPOLIA",
    "paymentAddress": "YOUR_WALLET_ADDRESS",
    "customerEmail": "batch2@test.com"
  }'

# Order 3
curl -X POST https://stablepay-nine.vercel.app/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "YOUR_MERCHANT_ID",
    "amount": "4.00",
    "chain": "BASE_SEPOLIA",
    "paymentAddress": "YOUR_WALLET_ADDRESS",
    "customerEmail": "batch3@test.com"
  }'
```

**Copy all 3 Order IDs**:
1. ___________________________
2. ___________________________
3. ___________________________

---

### Pay All 3 Orders

For each order:
1. Open: `https://stablepay-nine.vercel.app/crypto-pay.html?orderId=ORDER_ID`
2. Connect wallet
3. Click "Pay Now"
4. Approve in MetaMask
5. Wait for confirmation

**After all 3**: Check dashboard, should have 3 CONFIRMED orders ($2, $3, $4)

---

### Add Orders to Batch

1. Go to dashboard Orders tab
2. Scroll down to "Batch Refund" section (should be visible)
3. Find your 3 orders in the table
4. Click "+ Batch" button on Order 1 ($2)

**Expected**:
- [ ] Batch refund section shows order
- [ ] Order count: 1
- [ ] Total: $2.00 USDC

5. Click "+ Batch" on Order 2 ($3)

**Expected**:
- [ ] Order added
- [ ] Order count: 2
- [ ] Total: $5.00 USDC

6. Click "+ Batch" on Order 3 ($4)

**Expected**:
- [ ] Order added
- [ ] Order count: 3
- [ ] Total: $9.00 USDC
- [ ] All 3 orders listed
- [ ] Each shows amount and chain

---

### Execute Batch Refund

1. Review batch section
2. Verify total is $9.00
3. Click "Execute Batch Refund"

**Expected**:
- [ ] MetaMask popup appears
- [ ] **Transaction is to Multicall3 contract**: `0xcA11bde05977b3631167028862bE2a173976CA11`
- [ ] Gas estimate shown (should be much less than 3 individual refunds)
- [ ] Approve transaction
- [ ] Processing indicator
- [ ] Wait 10-15 seconds
- [ ] Success message: "Batch refund executed successfully!"
- [ ] Message shows: "3 refunds processed"
- [ ] Transaction hash displayed
- [ ] Batch section clears (count back to 0)

---

### Verify Batch Refund

**Check BaseScan**:
1. Open transaction hash on https://sepolia.basescan.org/
2. Click "Internal Txns" tab

**Expected**:
- [ ] See 3 internal USDC transfers
- [ ] Each transfer goes to different customer address
- [ ] Amounts: 2 USDC, 3 USDC, 4 USDC

**Check Dashboard Refunds**:
1. Look for refunds section

**Expected**:
- [ ] 3 new refunds
- [ ] All with same transaction hash
- [ ] All status: COMPLETED
- [ ] Amounts: 2, 3, 4 USDC

**Check Customer Wallets**:
(If you have access)
- [ ] Each received their respective refund amount

**Gas Comparison**:
1. Note gas used for batch refund
2. Compare to: 3 × 50,000 = 150,000 gas (if done individually)
3. Batch should be much less (60-85% savings)

**✅ If all checks pass, Batch Refund is working!**

---

## 🚀 Test 8: Refund API (10 minutes)

### Test Refund Stats Endpoint

```bash
curl "https://stablepay-nine.vercel.app/api/refunds/stats?merchantId=YOUR_MERCHANT_ID"
```

**Expected Response**:
```json
{
  "total": 4,
  "pending": 0,
  "completed": 4,
  "failed": 0,
  "totalRefunded": "14.00"
}
```

**Verify**:
- [ ] Total matches number of refunds you made (1 single + 3 batch = 4)
- [ ] Completed is 4
- [ ] Total refunded is $14 (5 + 2 + 3 + 4)

---

### Test Get Refunds Endpoint

```bash
curl "https://stablepay-nine.vercel.app/api/refunds?merchantId=YOUR_MERCHANT_ID"
```

**Expected**:
- [ ] Returns array of refund objects
- [ ] Each has: id, orderId, amount, reason, status, refundTxHash
- [ ] All statuses are COMPLETED
- [ ] Transaction hashes present

**✅ If all checks pass, Refund API is working!**

---

## 📊 Testing Summary

### Results Checklist

Mark what works:
- [ ] ✅ Trust Center page (all sections work)
- [ ] ✅ Landing page trust signals
- [ ] ✅ Merchant dashboard loads
- [ ] ✅ Wallet configuration saves
- [ ] ✅ Payment flow (crypto-pay.html)
- [ ] ✅ Payment received on-chain
- [ ] ✅ Order confirmed in dashboard
- [ ] ✅ Single refund executed
- [ ] ✅ Refund received by customer
- [ ] ✅ Batch refund executed (3 orders)
- [ ] ✅ All batch refunds confirmed
- [ ] ✅ Refund API endpoints work
- [ ] ✅ Refund stats accurate

### Issues Found

Document any bugs:
```
1. [Bug description]
   - Steps to reproduce
   - Expected vs Actual
   - Screenshot/error if available

2. [Bug description]
   ...
```

---

## 🎉 If Everything Passes

### You're Ready for Production!

Next steps:
1. Update token addresses to mainnet (in code)
2. Update Solana cluster to mainnet-beta
3. Test with $1 real transaction
4. Launch and announce
5. Onboard first merchants

---

## 🆘 If Something Fails

### Common Issues & Fixes

**Payment not confirming**:
- Wait 30 seconds (blockchain can be slow)
- Check transaction on BaseScan
- Verify you have enough ETH for gas

**Refund button disabled**:
- Make sure wallet is connected
- Try disconnecting and reconnecting

**MetaMask not connecting**:
- Make sure you're on Base Sepolia network
- Clear browser cache
- Try different browser

**USDC balance not showing**:
- Add USDC token to MetaMask manually:
  - Contract: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
  - Symbol: USDC
  - Decimals: 6

---

## 📸 Screenshot Recommendations

Take screenshots of:
1. Successful payment confirmation
2. Order in dashboard (CONFIRMED status)
3. Refund modal with wallet connected
4. Batch refund section with 3 orders
5. BaseScan showing batch refund internal transactions
6. Refund stats API response

---

## ⏱️ Time Tracking

Actual time spent:
- Setup: ___ min
- Trust Center: ___ min
- Payment flow: ___ min
- Single refund: ___ min
- Batch refund: ___ min
- API testing: ___ min
- **Total**: ___ min

---

## 🎯 Success!

If you've completed all tests successfully:

**🎊 CONGRATULATIONS! 🎊**

You've fully tested:
- ✅ Refund system (single + batch)
- ✅ Trust center
- ✅ Payment flow
- ✅ Multi-chain support
- ✅ Non-custodial payments

**StablePay is production-ready!**

Next: Share results and plan launch strategy! 🚀

---

**Questions during testing?**
- Check [TROUBLESHOOTING.md](public/docs/TROUBLESHOOTING.md)
- Review [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md)
- Document issues for next session
