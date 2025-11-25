# Integration Tests Addendum

**Add these tests to TESTING_CHECKLIST.md before section "6. Integration Testing"**

---

## Merchant Onboarding & Setup Testing

### Test: New Merchant Signup

**Steps**:
1. **Sign Up**
   - [ ] Visit https://stablepay-nine.vercel.app/signup.html
   - [ ] Enter email, company name, password
   - [ ] Click "Sign Up"
   - [ ] Account created with PENDING status

2. **Admin Approval** (Enterprise Admin)
   - [ ] Login to enterprise admin panel
   - [ ] Find new merchant in pending list
   - [ ] Approve merchant
   - [ ] Status changes to ACTIVE

3. **Merchant Login**
   - [ ] Login with merchant credentials
   - [ ] Dashboard loads successfully
   - [ ] Merchant ID visible in Developer tab

---

### Test: Wallet Configuration

**Steps**:
1. **Navigate to Wallets Tab**
   - [ ] Click "Wallets" in dashboard
   - [ ] All supported chains visible

2. **Configure Base Sepolia**
   - [ ] Toggle Base Sepolia ON
   - [ ] Paste EVM wallet address
   - [ ] Click "Save Configuration"
   - [ ] Success message appears
   - [ ] Wallet saved in database

3. **Configure Solana Devnet**
   - [ ] Toggle Solana Devnet ON
   - [ ] Paste Solana wallet address
   - [ ] Save configuration
   - [ ] Wallet saved successfully

4. **Verify Wallets**
   - [ ] Refresh page
   - [ ] Wallets still configured
   - [ ] Addresses display correctly

---

### Test: Developer Tab Code Snippets

**Steps**:
- [ ] Navigate to Developer tab
- [ ] Merchant ID displayed
- [ ] Code snippets auto-generated with merchant ID
- [ ] HTML example present
- [ ] JavaScript example present
- [ ] Copy button works

---

## Payment Flow Integration Testing

### Test: Hosted Payment Page (/crypto-pay.html)

**Prerequisites**:
- [ ] Merchant configured with wallet on Base Sepolia
- [ ] Customer has MetaMask with USDC on Base Sepolia

**Steps**:

1. **Create Order via API**
```bash
curl -X POST https://stablepay-nine.vercel.app/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "YOUR_MERCHANT_ID",
    "amount": "5.00",
    "chain": "BASE_SEPOLIA",
    "paymentAddress": "YOUR_WALLET_ADDRESS",
    "customerEmail": "test@customer.com",
    "customerName": "Test Customer"
  }'
```
   - [ ] Order created successfully
   - [ ] Note the order ID

2. **Open Payment Page**
   - [ ] Visit: `https://stablepay-nine.vercel.app/crypto-pay.html?orderId=ORDER_ID`
   - [ ] Page loads successfully
   - [ ] Order summary shows correct amount
   - [ ] Product name displays (if provided)
   - [ ] Testnet banner visible

3. **Connect Wallet**
   - [ ] Click "Connect Wallet"
   - [ ] MetaMask popup appears
   - [ ] Select account and connect
   - [ ] Wallet address displayed
   - [ ] USDC balances load for all chains
   - [ ] Base Sepolia balance shows

4. **Enter Customer Info**
   - [ ] Customer info section appears after wallet connect
   - [ ] Email pre-filled (if provided in order)
   - [ ] Can edit email
   - [ ] Name field visible

5. **Select Payment Chain**
   - [ ] Chain selector shows Base Sepolia
   - [ ] Shows available USDC balance
   - [ ] Select Base Sepolia

6. **Execute Payment**
   - [ ] "Pay Now" button appears
   - [ ] Click "Pay Now"
   - [ ] MetaMask transaction popup
   - [ ] Transaction details correct:
     - [ ] Recipient: Merchant wallet
     - [ ] Amount: 5 USDC (5000000 with 6 decimals)
   - [ ] Approve transaction
   - [ ] Processing indicator shows
   - [ ] Wait for confirmation (~5-10 seconds)

7. **Payment Confirmation**
   - [ ] Success message appears
   - [ ] Transaction hash displayed
   - [ ] Link to BaseScan works
   - [ ] "View Receipt" or redirect option

8. **Verify in Dashboard**
   - [ ] Merchant logs into dashboard
   - [ ] Order appears in Orders tab
   - [ ] Status is CONFIRMED
   - [ ] Transaction hash matches
   - [ ] Customer email/name visible
   - [ ] BaseScan link works

9. **Verify On-Chain**
   - [ ] Open BaseScan with tx hash
   - [ ] Transaction confirmed
   - [ ] USDC transfer to merchant wallet
   - [ ] Correct amount (5 USDC)

---

### Test: Unlock Integration Simulation

**Simulate how Unlock merchant integrates**

**Backend Test**:
```javascript
// Test creating order from "Unlock's backend"
const createUnlockOrder = async () => {
  const response = await fetch('https://stablepay-nine.vercel.app/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantId: 'cmhkjckgi0000qut5wxmtsw1f', // Unlock's merchant ID
      amount: '10.00',
      chain: 'BASE_SEPOLIA',
      paymentAddress: '0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D', // Unlock's wallet
      customerEmail: 'premium@customer.com',
      customerName: 'Premium User'
    })
  });

  const { order } = await response.json();
  const paymentUrl = `https://stablepay-nine.vercel.app/crypto-pay.html?orderId=${order.id}`;

  return { orderId: order.id, paymentUrl };
};
```

**Test Steps**:
1. **Create Order**
   - [ ] Run createUnlockOrder()
   - [ ] Order created for Unlock merchant
   - [ ] Payment URL generated

2. **Customer Payment**
   - [ ] Open payment URL
   - [ ] Connect customer wallet
   - [ ] Complete payment (10 USDC)
   - [ ] Payment confirms

3. **Verify Unlock Receives**
   - [ ] Check Unlock's wallet: `0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D`
   - [ ] 10 USDC received
   - [ ] Transaction visible on BaseScan

4. **Verify Unlock Dashboard**
   - [ ] Login as Unlock merchant (unlock@unlock.com)
   - [ ] Order visible in dashboard
   - [ ] Status: CONFIRMED
   - [ ] Amount: 10 USDC
   - [ ] Can issue refund if needed

---

### Test: Custom Integration (Manual Payment)

**Test building custom payment UI**

**Steps**:
1. **Create Order via API** (same as hosted payment test)

2. **Custom UI Payment** (using browser console)
```javascript
// In browser console on any page with MetaMask
async function testCustomPayment() {
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();

  const usdcAddress = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Base Sepolia
  const merchantAddress = 'YOUR_WALLET_ADDRESS';

  const usdcABI = [
    'function transfer(address to, uint256 amount) returns (bool)'
  ];

  const usdc = new ethers.Contract(usdcAddress, usdcABI, signer);
  const amount = ethers.parseUnits('5.00', 6);

  const tx = await usdc.transfer(merchantAddress, amount);
  console.log('TX Hash:', tx.hash);

  await tx.wait();
  console.log('Confirmed!');

  return tx.hash;
}

// Execute
const txHash = await testCustomPayment();
```

3. **Confirm Order**
```javascript
// Notify StablePay of payment
await fetch(`https://stablepay-nine.vercel.app/api/v1/orders/ORDER_ID/confirm`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ txHash: txHash })
});
```

4. **Verify**
   - [ ] Order status updates to CONFIRMED
   - [ ] Transaction recorded in database
   - [ ] Visible in merchant dashboard

---

## Update Critical Path Tests

**Add to "Critical Path Tests (Must Pass)" section**:
- [ ] New merchant signup and wallet configuration
- [ ] Hosted payment page full flow (crypto-pay.html)
- [ ] Unlock integration simulation works
- [ ] Payment received in merchant wallet on-chain

---

## Integration Test Summary

| Test | Duration | Critical |
|------|----------|----------|
| Merchant signup & wallet config | 10 min | ✅ Yes |
| Hosted payment page flow | 15 min | ✅ Yes |
| Unlock integration simulation | 10 min | ✅ Yes |
| Custom integration (manual) | 15 min | ⚠️ Optional |
| **Total** | **50 min** | **3 critical** |

---

**Note**: These tests should be run BEFORE the refund and trust center tests, as they establish the baseline payment flow that refunds depend on.
