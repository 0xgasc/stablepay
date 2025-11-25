# StablePay Testing Checklist - Refund System & Trust Center

## Overview
Complete testing checklist for new features implemented in this session:
1. Refund System (Single + Batch)
2. Trust Center Page
3. Landing Page Updates

---

## Pre-Testing Setup

### Environment Setup
- [ ] Vercel deployment successful
- [ ] Database migrations applied (`npx prisma db push`)
- [ ] Environment variables configured
- [ ] Access to testnet wallets with funds
  - [ ] MetaMask installed with Base Sepolia, Ethereum Sepolia
  - [ ] Phantom installed with Solana Devnet
  - [ ] Test USDC in wallets (get from faucets)

### Test Wallets Needed
```
MetaMask (Base Sepolia):
- Merchant wallet: [Your address with test USDC]
- Customer wallet: [Separate address for testing]

Phantom (Solana Devnet):
- Merchant wallet: [Your address with test USDC]
- Customer wallet: [Separate address for testing]
```

### Faucets for Test USDC
- Base Sepolia USDC: https://faucet.circle.com/
- Ethereum Sepolia USDC: https://faucet.circle.com/
- Solana Devnet USDC: https://spl-token-faucet.com/

---

## 1. Refund API Testing

### Test 1.1: Create Refund (POST /api/refunds)
**Purpose**: Verify refund creation with validation

**Prerequisites**:
- [ ] At least one confirmed order exists in database

**Steps**:
```bash
# Test valid refund creation
curl -X POST https://stablepay-nine.vercel.app/api/refunds \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "YOUR_ORDER_ID",
    "amount": "10.00",
    "reason": "Customer requested refund",
    "status": "PENDING"
  }'
```

**Expected Results**:
- [ ] Status 201 Created
- [ ] Response contains refund object with id
- [ ] Refund stored in database
- [ ] `createdAt` and `updatedAt` timestamps present

**Test Edge Cases**:
```bash
# Test 1: Refund amount exceeds order amount (should fail)
curl -X POST https://stablepay-nine.vercel.app/api/refunds \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "YOUR_ORDER_ID",
    "amount": "99999.00",
    "reason": "Test excessive amount",
    "status": "PENDING"
  }'
```
- [ ] Status 400 Bad Request
- [ ] Error message: "Refund amount cannot exceed original order amount"

```bash
# Test 2: Invalid order ID (should fail)
curl -X POST https://stablepay-nine.vercel.app/api/refunds \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "invalid_order_id_123",
    "amount": "10.00",
    "reason": "Test",
    "status": "PENDING"
  }'
```
- [ ] Status 404 Not Found
- [ ] Error message: "Order not found"

```bash
# Test 3: Missing required fields (should fail)
curl -X POST https://stablepay-nine.vercel.app/api/refunds \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "YOUR_ORDER_ID"
  }'
```
- [ ] Status 400 Bad Request
- [ ] Zod validation error details returned

---

### Test 1.2: Update Refund (PATCH /api/refunds/:id)
**Purpose**: Verify refund status updates and tx hash recording

**Steps**:
```bash
# Update refund status
curl -X PATCH https://stablepay-nine.vercel.app/api/refunds/YOUR_REFUND_ID \
  -H "Content-Type: application/json" \
  -d '{
    "status": "COMPLETED",
    "refundTxHash": "0xabc123def456..."
  }'
```

**Expected Results**:
- [ ] Status 200 OK
- [ ] Refund status updated to COMPLETED
- [ ] Transaction hash stored correctly
- [ ] `updatedAt` timestamp updated

**Test Edge Cases**:
- [ ] Invalid refund ID returns 404
- [ ] Invalid status enum value returns 400
- [ ] Partial update (only status) works
- [ ] Partial update (only txHash) works

---

### Test 1.3: Get Refunds (GET /api/refunds)
**Purpose**: Verify refund listing and filtering

**Steps**:
```bash
# Get all refunds
curl https://stablepay-nine.vercel.app/api/refunds

# Get refunds by merchant ID
curl "https://stablepay-nine.vercel.app/api/refunds?merchantId=YOUR_MERCHANT_ID"

# Get refunds by order ID
curl "https://stablepay-nine.vercel.app/api/refunds?orderId=YOUR_ORDER_ID"
```

**Expected Results**:
- [ ] Returns array of refunds
- [ ] Includes related order information
- [ ] Filtering by merchantId works
- [ ] Filtering by orderId works
- [ ] Empty array if no refunds found

---

### Test 1.4: Get Refund Stats (GET /api/refunds/stats)
**Purpose**: Verify refund statistics calculation

**Steps**:
```bash
# Get stats for merchant
curl "https://stablepay-nine.vercel.app/api/refunds/stats?merchantId=YOUR_MERCHANT_ID"
```

**Expected Results**:
- [ ] Returns stats object with:
  - [ ] `total`: Total refund count
  - [ ] `pending`: Pending refund count
  - [ ] `completed`: Completed refund count
  - [ ] `failed`: Failed refund count
  - [ ] `totalRefunded`: Sum of all completed refunds
- [ ] Calculations are accurate

---

## 2. Single Refund UI Testing

### Test 2.1: Refund Modal - EVM Chains (Base Sepolia)

**Prerequisites**:
- [ ] Logged into merchant dashboard
- [ ] At least one CONFIRMED order on Base Sepolia
- [ ] MetaMask installed and connected to Base Sepolia
- [ ] Merchant wallet has test USDC

**Steps**:
1. **Open Refund Modal**
   - [ ] Navigate to Orders tab
   - [ ] Find confirmed order
   - [ ] Click "Refund" button
   - [ ] Modal opens successfully

2. **Verify Pre-populated Data**
   - [ ] Order ID is filled (read-only)
   - [ ] Original amount is filled (read-only)
   - [ ] Chain is filled (read-only)
   - [ ] Customer wallet address auto-populated from transaction
   - [ ] Refund amount defaults to full amount
   - [ ] Execute button is DISABLED (wallet not connected)

3. **Connect MetaMask Wallet**
   - [ ] Click "MetaMask" button in wallet connection section
   - [ ] MetaMask popup appears
   - [ ] Select merchant wallet address
   - [ ] Click "Connect"
   - [ ] Connected wallet address displayed
   - [ ] Execute button becomes ENABLED

4. **Test Full Refund**
   - [ ] Leave refund amount as original amount
   - [ ] Enter reason: "Test full refund"
   - [ ] Click "Execute Refund"
   - [ ] Button shows "Processing..."
   - [ ] MetaMask popup for transaction approval
   - [ ] Approve transaction in MetaMask
   - [ ] Transaction confirmed on blockchain
   - [ ] Success alert with transaction hash
   - [ ] Modal closes
   - [ ] Order table refreshes

5. **Verify Refund Record**
   - [ ] Check database for refund record
   - [ ] Status is COMPLETED
   - [ ] Transaction hash is stored
   - [ ] Amount matches
   - [ ] Reason is stored

6. **Verify On-Chain**
   - [ ] Open BaseScan Sepolia
   - [ ] Search for transaction hash
   - [ ] Transaction confirmed
   - [ ] USDC transfer to customer address
   - [ ] Correct amount transferred

---

### Test 2.2: Partial Refund - Base Sepolia

**Steps**:
1. **Open Refund Modal**
   - [ ] Select different confirmed order
   - [ ] Click "Refund" button

2. **Connect Wallet**
   - [ ] Connect MetaMask (if not already)

3. **Test Partial Refund**
   - [ ] Change refund amount to 50% of original
   - [ ] Enter reason: "Partial refund - 50%"
   - [ ] Click "Execute Refund"
   - [ ] Approve in MetaMask
   - [ ] Success confirmation

4. **Verify Partial Amount**
   - [ ] Check transaction on BaseScan
   - [ ] Verify amount is 50% of original
   - [ ] Database refund record shows partial amount

---

### Test 2.3: Refund Modal - Solana Devnet

**Prerequisites**:
- [ ] At least one CONFIRMED order on Solana Devnet
- [ ] Phantom wallet installed
- [ ] Merchant wallet has USDC on Solana Devnet

**Steps**:
1. **Open Refund Modal**
   - [ ] Select Solana order
   - [ ] Click "Refund" button
   - [ ] Modal opens

2. **Connect Phantom Wallet**
   - [ ] Click "Phantom" button
   - [ ] Phantom popup appears
   - [ ] Approve connection
   - [ ] Wallet address displayed
   - [ ] Execute button enabled

3. **Execute Solana Refund**
   - [ ] Enter refund amount
   - [ ] Enter reason: "Solana test refund"
   - [ ] Click "Execute Refund"
   - [ ] Phantom transaction approval popup
   - [ ] Approve transaction
   - [ ] Transaction confirmed
   - [ ] Success alert with signature

4. **Verify On-Chain**
   - [ ] Check transaction on Solscan Devnet
   - [ ] SPL token transfer confirmed
   - [ ] Correct USDC amount
   - [ ] To correct customer address

---

### Test 2.4: Refund Modal - Error Handling

**Test Insufficient Balance**:
- [ ] Try refund with wallet that has no USDC
- [ ] MetaMask/Phantom shows error
- [ ] Error message displayed to user
- [ ] Refund status NOT changed to COMPLETED

**Test Network Mismatch**:
- [ ] Open refund for Base Sepolia order
- [ ] Connect MetaMask on wrong network (e.g., Ethereum Mainnet)
- [ ] Error message about network mismatch
- [ ] Prompt to switch network

**Test Disconnected Wallet**:
- [ ] Open refund modal
- [ ] Click "Disconnect" after connecting
- [ ] Execute button becomes disabled
- [ ] Can't execute refund

**Test Missing Fields**:
- [ ] Leave reason field empty
- [ ] Click "Execute Refund"
- [ ] Alert: "Please provide a reason for the refund"

- [ ] Leave customer wallet empty
- [ ] Click "Execute Refund"
- [ ] Alert: "Please provide a customer wallet address"

**Test Invalid Amount**:
- [ ] Enter 0 as refund amount
- [ ] Click "Execute Refund"
- [ ] Alert: "Please enter a valid refund amount"

- [ ] Enter negative amount
- [ ] Browser validation prevents input

---

## 3. Batch Refund Testing

### Test 3.1: Add Orders to Batch

**Prerequisites**:
- [ ] Multiple CONFIRMED orders on same chain (Base Sepolia)
- [ ] Orders have customer wallet addresses

**Steps**:
1. **Add First Order**
   - [ ] Click "+ Batch" button on first order
   - [ ] Batch refund section appears (no longer empty)
   - [ ] Order appears in batch list
   - [ ] Order count shows "1"
   - [ ] Total amount shows order amount

2. **Add Second Order**
   - [ ] Click "+ Batch" on second order
   - [ ] Order added to batch list
   - [ ] Order count shows "2"
   - [ ] Total amount updates (sum of both)

3. **Add Third Order**
   - [ ] Add third order to batch
   - [ ] All 3 orders visible in list
   - [ ] Order count shows "3"
   - [ ] Total amount correct

4. **Test Duplicate Prevention**
   - [ ] Click "+ Batch" on order already in batch
   - [ ] Alert: "Order already added to batch refund"
   - [ ] Order not duplicated in list

---

### Test 3.2: Batch Refund Validation

**Test Mixed Chains (Should Fail)**:
- [ ] Add Base Sepolia order to batch
- [ ] Add Solana order to batch
- [ ] Click "Execute Batch Refund"
- [ ] Alert: "Batch refunds must be on the same chain"
- [ ] Lists chains: "Base Sepolia, Solana Devnet"
- [ ] No transaction executed

**Test Solana Orders (Should Fail)**:
- [ ] Clear batch
- [ ] Try to add Solana order to batch
- [ ] "+ Batch" button should NOT be visible for Solana orders
- [ ] Only EVM orders show batch button

---

### Test 3.3: Execute Batch Refund

**Prerequisites**:
- [ ] 3-5 orders from same EVM chain in batch
- [ ] Merchant wallet has sufficient USDC for all refunds
- [ ] Merchant wallet has ETH/gas for transaction

**Steps**:
1. **Review Batch**
   - [ ] Verify all orders listed correctly
   - [ ] Total amount is accurate
   - [ ] All orders from same chain

2. **Execute Batch**
   - [ ] Click "Execute Batch Refund"
   - [ ] MetaMask popup appears
   - [ ] Transaction is to Multicall3 contract (0xcA11bde05977b3631167028862bE2a173976CA11)
   - [ ] Gas estimate shows (should be lower than individual refunds)
   - [ ] Approve transaction
   - [ ] Wait for confirmation

3. **Verify Success**
   - [ ] Success alert with transaction hash
   - [ ] Message shows number of refunds processed
   - [ ] Batch section cleared
   - [ ] Order count back to "0"
   - [ ] Orders table refreshed

4. **Verify Database Records**
   - [ ] All orders have refund records created
   - [ ] All refunds have same transaction hash
   - [ ] All statuses are COMPLETED
   - [ ] Reasons include tx hash reference

5. **Verify On-Chain**
   - [ ] Open transaction on BaseScan
   - [ ] Single transaction to Multicall3
   - [ ] Internal transactions show multiple USDC transfers
   - [ ] Each transfer goes to correct customer
   - [ ] Amounts are correct

6. **Verify Gas Savings**
   - [ ] Note gas used for batch transaction
   - [ ] Compare to: (number of refunds × 50,000 gas)
   - [ ] Should be significantly less (60-85% savings)

---

### Test 3.4: Batch Refund - Remove Orders

**Steps**:
- [ ] Add 3 orders to batch
- [ ] Click "Remove" on second order
- [ ] Order removed from list
- [ ] Count decrements to "2"
- [ ] Total amount updates (minus removed order)
- [ ] Can still execute batch with remaining orders

---

### Test 3.5: Batch Refund - Clear All

**Steps**:
- [ ] Add multiple orders to batch
- [ ] Click "Clear Selection"
- [ ] Confirmation dialog appears
- [ ] Confirm clearing
- [ ] All orders removed
- [ ] Batch section shows empty state
- [ ] Count shows "0"
- [ ] Total shows "0"

---

## 4. Trust Center Page Testing

### Test 4.1: Page Load & Navigation

**Steps**:
1. **Access Trust Center**
   - [ ] Visit https://stablepay-nine.vercel.app/trust.html
   - [ ] Page loads successfully
   - [ ] No console errors

2. **Hero Section**
   - [ ] Lock emoji (🔒) displays
   - [ ] Heading: "Your Security is Our Priority"
   - [ ] Subtitle text readable
   - [ ] "View Security Practices →" button visible
   - [ ] Button links to #security anchor

3. **Trust Badges Section**
   - [ ] 4 badges displayed in grid
   - [ ] Non-Custodial badge (🛡️)
   - [ ] Encrypted badge (🔐)
   - [ ] 99.9% Uptime badge (⚡)
   - [ ] GDPR Ready badge (📊)
   - [ ] All descriptions visible

4. **Header Navigation**
   - [ ] StablePay logo visible
   - [ ] Links: Home, Dashboard, Trust Center
   - [ ] Trust Center link is active/highlighted
   - [ ] All links work correctly

5. **Footer**
   - [ ] 4-column layout displays
   - [ ] All links present and clickable
   - [ ] Email links work (mailto:)
   - [ ] GitHub link present
   - [ ] Copyright text visible

---

### Test 4.2: Accordion Sections

**Test Each Section Opens/Closes**:

1. **Security & Compliance**
   - [ ] Section visible
   - [ ] Click header to expand
   - [ ] Content slides open smoothly
   - [ ] Icon changes from "+" to "−"
   - [ ] Content fully readable
   - [ ] Click header again to close
   - [ ] Content collapses smoothly
   - [ ] Icon changes back to "+"

2. **Privacy & Data Protection**
   - [ ] Expands/collapses correctly
   - [ ] "What we collect" vs "What we DON'T collect" grid visible
   - [ ] Green checkmarks and red X's display

3. **How StablePay Works**
   - [ ] Expands/collapses correctly
   - [ ] 4-step payment flow visible
   - [ ] Numbered circles (1-4) display
   - [ ] Green info box at bottom visible

4. **Blockchain Security**
   - [ ] Expands/collapses correctly
   - [ ] EVM chains listed
   - [ ] Solana listed
   - [ ] Two-column grid layout

5. **Operational Security**
   - [ ] Expands/collapses correctly
   - [ ] All 3 subsections visible

6. **Merchant Protection**
   - [ ] Expands/collapses correctly
   - [ ] Refund management mentioned

7. **Transparency**
   - [ ] Expands/collapses correctly
   - [ ] security@stablepay.io email link works
   - [ ] Email link opens mail client

**Test Accordion Behavior**:
- [ ] First section (Security & Compliance) opens by default on page load
- [ ] Opening one section closes others (accordion behavior)
- [ ] Smooth animations during expand/collapse
- [ ] No layout shifts or jumps

---

### Test 4.3: Mobile Responsiveness - Trust Center

**Test on Mobile Device or Resize Browser**:
- [ ] Page width < 768px (mobile)
- [ ] Trust badges stack vertically (1 column)
- [ ] Accordion sections full width
- [ ] Content readable without horizontal scroll
- [ ] Footer stacks vertically (1 column)
- [ ] All buttons/links easily tappable
- [ ] Text size appropriate for mobile

**Test on Tablet** (768px - 1024px):
- [ ] Trust badges in 2 columns
- [ ] Footer in 2 columns
- [ ] Content flows properly

**Test on Desktop** (>1024px):
- [ ] Trust badges in 4 columns
- [ ] Footer in 4 columns
- [ ] Content properly centered
- [ ] Max width respected

---

## 5. Landing Page Updates Testing

### Test 5.1: Navigation Security Link

**Steps**:
- [ ] Visit https://stablepay-nine.vercel.app/
- [ ] "Security" link visible in header
- [ ] Click "Security" link
- [ ] Redirects to /trust.html
- [ ] Page loads correctly

---

### Test 5.2: Trust & Security Section

**Steps**:
1. **Scroll to Section**
   - [ ] Section appears after features, before pricing
   - [ ] Border separator visible
   - [ ] Dark background (bg-black)

2. **Heading & CTA**
   - [ ] "Built with Security & Trust" heading
   - [ ] Subtitle text readable
   - [ ] "View Full Trust Center →" link visible
   - [ ] Link goes to /trust.html

3. **Trust Badges Grid**
   - [ ] 4 badges displayed
   - [ ] Same badges as trust center
   - [ ] Emojis display correctly
   - [ ] Descriptions visible

4. **Security Details Grid**
   - [ ] 3 columns: Data Encryption, Infrastructure Security, Blockchain Security
   - [ ] All checkmarks (✓) display
   - [ ] Feature cards have hover effect
   - [ ] Content readable

---

### Test 5.3: Enhanced Footer

**Steps**:
1. **Layout**
   - [ ] 4-column layout on desktop
   - [ ] Columns: StablePay, Product, Security, Contact

2. **Product Column**
   - [ ] Dashboard link works
   - [ ] Pricing link (/#pricing) scrolls to pricing section
   - [ ] Sign Up link works

3. **Security Column**
   - [ ] Trust Center link works
   - [ ] Security Practices link (trust.html#security) works
   - [ ] Privacy Policy link present

4. **Contact Column**
   - [ ] security@stablepay.io opens mail client
   - [ ] support@stablepay.io opens mail client
   - [ ] GitHub link present

5. **Copyright**
   - [ ] Border separator visible
   - [ ] "Developed by G.S © 2025 StablePay" text visible

---

### Test 5.4: Mobile - Landing Page

**Resize to Mobile**:
- [ ] Trust section badges stack vertically
- [ ] Security details stack vertically (1 column)
- [ ] Footer stacks vertically (1 column)
- [ ] All sections readable
- [ ] No horizontal scroll

---

## 6. Integration Testing

### Test 6.1: End-to-End Refund Flow

**Complete Flow from Payment to Refund**:

1. **Create Order**
   - [ ] Create test payment order via dashboard
   - [ ] Get payment link
   - [ ] Note order ID

2. **Customer Pays**
   - [ ] Open payment link in incognito window
   - [ ] Connect customer wallet (MetaMask)
   - [ ] Complete USDC payment
   - [ ] Transaction confirms

3. **Verify Order Confirmation**
   - [ ] Order status changes to CONFIRMED
   - [ ] Transaction hash recorded
   - [ ] Customer wallet address captured

4. **Process Refund**
   - [ ] Merchant opens dashboard
   - [ ] Opens refund modal for order
   - [ ] Customer wallet auto-filled correctly
   - [ ] Connect merchant wallet
   - [ ] Execute refund
   - [ ] Refund completes successfully

5. **Verify Customer Receives**
   - [ ] Check customer wallet balance
   - [ ] USDC refund received
   - [ ] Amount matches refund amount

6. **Verify Dashboard Updates**
   - [ ] Order shows refund status/indicator
   - [ ] Refund appears in refund list
   - [ ] Stats update correctly

---

### Test 6.2: Multi-Order Batch Flow

**Complete Flow with Multiple Orders**:

1. **Create 3 Test Orders**
   - [ ] Create 3 payment orders (same chain)
   - [ ] All paid by customers
   - [ ] All confirmed in dashboard

2. **Add to Batch**
   - [ ] Add all 3 to batch refund
   - [ ] Verify total amount

3. **Execute Batch**
   - [ ] Connect wallet
   - [ ] Execute batch refund
   - [ ] Single transaction processes all 3

4. **Verify All Customers**
   - [ ] Customer 1 receives refund
   - [ ] Customer 2 receives refund
   - [ ] Customer 3 receives refund
   - [ ] All amounts correct

---

## 7. Cross-Browser Testing

### Test 7.1: Chrome
- [ ] Dashboard loads
- [ ] Refund modal works
- [ ] MetaMask connects
- [ ] Trust center displays correctly
- [ ] Landing page updates visible

### Test 7.2: Firefox
- [ ] All features work
- [ ] Wallet connections work
- [ ] Accordions function

### Test 7.3: Safari
- [ ] All features work
- [ ] Web3 wallet extensions work
- [ ] Layout correct

### Test 7.4: Mobile Safari (iOS)
- [ ] Responsive design works
- [ ] Touch interactions smooth
- [ ] Phantom wallet connects (if available)

### Test 7.5: Chrome Mobile (Android)
- [ ] All responsive features work
- [ ] Wallet apps can connect

---

## 8. Performance Testing

### Test 8.1: Page Load Times
- [ ] Trust center loads in < 2 seconds
- [ ] Landing page loads in < 2 seconds
- [ ] Dashboard loads in < 3 seconds
- [ ] No layout shift (CLS score good)

### Test 8.2: API Response Times
- [ ] GET /api/refunds responds < 500ms
- [ ] POST /api/refunds responds < 500ms
- [ ] GET /api/refunds/stats responds < 500ms

### Test 8.3: Large Dataset
- [ ] Create 20+ refund records
- [ ] Dashboard still responsive
- [ ] Filtering works quickly
- [ ] Batch refund UI handles 10+ orders

---

## 9. Security Testing

### Test 9.1: Input Validation
- [ ] SQL injection attempts rejected (Prisma protects)
- [ ] XSS attempts sanitized
- [ ] Invalid JSON returns 400
- [ ] Malformed requests handled gracefully

### Test 9.2: Authentication
- [ ] Unauthenticated requests handled appropriately
- [ ] Can't access other merchant's refunds
- [ ] API keys validated (if implemented)

### Test 9.3: Wallet Security
- [ ] Private keys never exposed
- [ ] Transaction signing client-side only
- [ ] No wallet credentials stored
- [ ] Disconnect wallet works properly

---

## 10. Error Scenarios

### Test 10.1: Network Errors
- [ ] Wallet not connected error handled
- [ ] Transaction rejected by user handled
- [ ] Network congestion timeout handled
- [ ] RPC endpoint failure handled

### Test 10.2: Database Errors
- [ ] Database connection failure shows user-friendly error
- [ ] Duplicate refund creation prevented
- [ ] Foreign key violations handled

### Test 10.3: Blockchain Errors
- [ ] Insufficient gas handled
- [ ] Token approval required handled
- [ ] Wrong network error clear
- [ ] Transaction revert handled

---

## Testing Summary Checklist

### Critical Path Tests (Must Pass)
- [ ] Create refund via API
- [ ] Execute single EVM refund via UI
- [ ] Execute batch refund (3+ orders)
- [ ] Trust center page loads and works
- [ ] Landing page trust section visible
- [ ] Mobile responsive on all pages

### Important Tests (Should Pass)
- [ ] Solana refund works
- [ ] Partial refund works
- [ ] All validation errors work
- [ ] Stats endpoint accurate
- [ ] All accordions work
- [ ] Footer links work

### Nice to Have Tests (Good to Pass)
- [ ] Cross-browser compatibility
- [ ] Performance benchmarks
- [ ] Large dataset handling
- [ ] All error scenarios handled

---

## Bug Reporting Template

If you find issues, document them like this:

```
**Bug**: [Short description]

**Steps to Reproduce**:
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Expected**: [What should happen]
**Actual**: [What actually happened]

**Environment**:
- Browser: [Chrome/Firefox/Safari]
- Network: [Base Sepolia/Solana Devnet]
- Device: [Desktop/Mobile]

**Screenshot/Error**: [Paste error or screenshot]

**Priority**: [Critical/High/Medium/Low]
```

---

## Quick Test Commands

```bash
# Test refund creation
curl -X POST https://stablepay-nine.vercel.app/api/refunds \
  -H "Content-Type: application/json" \
  -d '{"orderId":"ORDER_ID","amount":"10","reason":"Test"}'

# Test refund stats
curl https://stablepay-nine.vercel.app/api/refunds/stats

# Check deployment
curl https://stablepay-nine.vercel.app/trust.html | grep "Security"

# Check database connection
curl https://stablepay-nine.vercel.app/api/merchants
```

---

## After Testing

### If All Tests Pass ✅
- [ ] Deploy to production
- [ ] Update documentation with any findings
- [ ] Announce launch
- [ ] Monitor for 24 hours

### If Tests Fail ❌
- [ ] Document all failures
- [ ] Prioritize by severity
- [ ] Fix critical bugs first
- [ ] Re-test after fixes
- [ ] Repeat until all critical tests pass

---

**Estimated Testing Time**: 4-6 hours for complete checklist
**Minimum Viable Testing**: ~2 hours (critical path only)

Good luck with testing! 🧪
