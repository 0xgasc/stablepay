# Troubleshooting Guide

Common issues and solutions when integrating StablePay.

---

## Table of Contents

- [Widget Not Appearing](#widget-not-appearing)
- [Wallet Connection Issues](#wallet-connection-issues)
- [Transaction Failures](#transaction-failures)
- [Order Status Issues](#order-status-issues)
- [API Errors](#api-errors)
- [Network/Chain Issues](#networkchain-issues)
- [Testing Problems](#testing-problems)

---

## Widget Not Appearing

### Problem: Widget doesn't show up on the page

**Symptoms:**
- Blank space where widget should be
- No payment button visible
- Console shows no errors

**Solutions:**

**1. Check script is loaded:**
```html
<!-- Make sure this is in your HTML -->
<script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>
```

**2. Check widget container exists:**
```html
<!-- Container must have class="stablepay-checkout" -->
<div class="stablepay-checkout"
     data-merchant="YOUR_MERCHANT_ID"
     data-amount="10.00"
     data-chain="BASE_MAINNET">
</div>
```

**3. Check for JavaScript errors:**
```javascript
// Open browser console (F12) and look for errors
console.log('Widget loaded:', typeof window.StablePayCheckout);
```

**4. Check Content Security Policy:**
```html
<!-- If using CSP, allow StablePay scripts -->
<meta http-equiv="Content-Security-Policy"
      content="script-src 'self' https://stablepay-nine.vercel.app;">
```

**5. For React/Vue/Svelte:**
```javascript
// Make sure script loads AFTER DOM is ready
useEffect(() => {
  const script = document.createElement('script');
  script.src = 'https://stablepay-nine.vercel.app/checkout-widget.js';
  script.async = true;
  document.head.appendChild(script);
}, []);
```

---

## Wallet Connection Issues

### Problem: MetaMask not connecting

**Symptoms:**
- "MetaMask not found" error
- Popup doesn't appear
- Connection fails silently

**Solutions:**

**1. Check MetaMask is installed:**
```javascript
if (typeof window.ethereum === 'undefined') {
  alert('Please install MetaMask');
  window.open('https://metamask.io/download/', '_blank');
}
```

**2. Check MetaMask is unlocked:**
- Open MetaMask extension
- Enter password if locked
- Try connecting again

**3. Both MetaMask and Phantom installed?**
```javascript
// StablePay handles this, but if custom integration:
let ethereum = window.ethereum;
if (window.ethereum?.providers) {
  ethereum = window.ethereum.providers.find(p => p.isMetaMask);
}
```

**4. Wrong network in MetaMask:**
- Open MetaMask
- Click network dropdown
- Select correct network (Base Sepolia for testnet, Base for mainnet)
- Or let StablePay switch automatically

**5. Clear MetaMask cache:**
- MetaMask → Settings → Advanced → Reset Account
- Reconnect wallet

### Problem: Phantom not connecting

**Symptoms:**
- "Phantom not found" error
- Connection timeout
- Wrong wallet detected

**Solutions:**

**1. Check Phantom is installed:**
```javascript
if (!window.solana?.isPhantom) {
  alert('Please install Phantom wallet');
  window.open('https://phantom.app/', '_blank');
}
```

**2. Check Phantom permissions:**
- Open Phantom
- Settings → Trusted Apps
- Make sure your domain is listed

**3. Wrong network in Phantom:**
- Open Phantom
- Settings → Change Network
- Select "Devnet" for testing, "Mainnet" for production

---

## Transaction Failures

### Problem: "Insufficient funds" error

**Cause:** Not enough tokens for the transaction + gas fees

**Solutions:**

**For Base (EVM):**
- Need USDC for payment
- Need ETH for gas fees (~$0.01-0.10)
- Check balances:
  ```javascript
  // Check ETH balance
  const ethBalance = await provider.getBalance(address);

  // Check USDC balance
  const usdcContract = new ethers.Contract(usdcAddress, abi, provider);
  const usdcBalance = await usdcContract.balanceOf(address);
  ```

**For Solana:**
- Need USDC for payment
- Need SOL for transaction fees (~$0.0001-0.001)
- Check balances in Phantom wallet

**Quick fix:**
1. Get testnet tokens from faucets (see [Testing](#testing-problems))
2. Or add more tokens to your wallet

### Problem: Transaction fails with "User denied transaction"

**Cause:** User clicked "Reject" in wallet

**Solutions:**

**1. Add better error handling:**
```javascript
document.querySelector('.stablepay-checkout')
  .addEventListener('stablepay:payment.failed', (event) => {
    if (event.detail.code === 4001) {
      alert('Transaction cancelled. Please try again when ready.');
    }
  });
```

**2. Improve user experience:**
- Show clear amount and recipient before transaction
- Explain gas fees
- Add "Cancel" button so users don't have to reject in wallet

### Problem: Transaction pending forever

**Symptoms:**
- Transaction shows "Pending" for >5 minutes
- No confirmation
- Block explorer shows nothing

**Solutions:**

**1. Check transaction on block explorer:**
- Base Sepolia: https://sepolia.basescan.org
- Base Mainnet: https://basescan.org
- Solana: https://explorer.solana.com

**2. Increase gas fees (EVM):**
```javascript
// In MetaMask, edit gas settings before confirming
// Or in code:
const tx = await contract.transfer(to, amount, {
  gasLimit: 100000,
  maxFeePerGas: ethers.parseUnits('2', 'gwei')
});
```

**3. Check network congestion:**
- High traffic can delay transactions
- Wait 10-15 minutes or cancel and retry with higher gas

**4. Transaction dropped:**
- If dropped, create new order
- Don't reuse old order IDs

### Problem: Transaction succeeds but order stays PENDING

**Cause:** Order confirmation API call failed

**Solutions:**

**1. Check confirmation was called:**
```javascript
// After transaction confirms, this MUST be called:
await fetch(`/api/v1/orders/${orderId}/confirm`, {
  method: 'POST',
  body: JSON.stringify({ txHash: txHash })
});
```

**2. Check API response:**
```javascript
const response = await fetch(`/api/v1/orders/${orderId}/confirm`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ txHash: txHash })
});

if (!response.ok) {
  console.error('Confirmation failed:', await response.text());
}
```

**3. Manually confirm in dashboard:**
- Go to Orders tab
- Find the order
- Click "Confirm" if transaction exists on-chain

---

## Order Status Issues

### Problem: Order shows EXPIRED

**Cause:** Orders expire after 1 hour of no payment

**Solution:**
- Create a new order
- Complete payment within 60 minutes

### Problem: Can't find order

**Solutions:**

**1. Check order ID is correct:**
```javascript
const response = await fetch(`/api/v1/orders/${orderId}`);
if (response.status === 404) {
  console.error('Order not found');
}
```

**2. Check merchant ID matches:**
```javascript
// Order must belong to the merchant
const order = await getOrder(orderId);
if (order.merchantId !== yourMerchantId) {
  console.error('Order belongs to different merchant');
}
```

**3. Check in dashboard:**
- Log into dashboard
- Go to Orders tab
- Search by order ID or transaction hash

---

## API Errors

### Error: "Merchant not found" (404)

**Cause:** Incorrect merchant ID

**Solutions:**

**1. Get correct merchant ID:**
- Log into [dashboard](https://stablepay-nine.vercel.app/dashboard.html)
- Go to Developer tab
- Copy your Merchant ID
- Format: `cmhkjckgi0000qut5wxmtsw1f` (starts with "c")

**2. Update your code:**
```javascript
const MERCHANT_ID = 'cmhkjckgi0000qut5wxmtsw1f'; // NOT your email
```

### Error: "Missing required fields" (400)

**Cause:** Request missing required parameters

**Solutions:**

**Check all required fields:**
```javascript
{
  "merchantId": "cmhkjckgi0000qut5wxmtsw1f",  // ✅ Required
  "amount": "10.00",                          // ✅ Required
  "chain": "BASE_MAINNET",                    // ✅ Required
  "paymentAddress": "0x9e9Ebf...",            // ✅ Required
  "customerEmail": "user@example.com"         // ❌ Optional
}
```

### Error: "Wallet not configured" (400)

**Cause:** No wallet address saved for the selected chain

**Solutions:**

**1. Configure wallet:**
- Go to dashboard → Wallets tab
- Enable the chain (toggle on)
- Paste your wallet address
- Click Save

**2. Check wallet is active:**
```javascript
const response = await fetch(
  `/api/v1/admin?resource=wallets&merchantId=${merchantId}`
);
const wallets = await response.json();
const baseWallet = wallets.find(w =>
  w.chain === 'BASE_MAINNET' && w.isActive
);

if (!baseWallet) {
  console.error('No active Base wallet found');
}
```

### Error: CORS / Network errors

**Symptoms:**
- `Access-Control-Allow-Origin` error
- `Failed to fetch`
- Network timeout

**Solutions:**

**1. Check API URL is correct:**
```javascript
// ✅ Correct
const url = 'https://stablepay-nine.vercel.app/api/v1/orders';

// ❌ Wrong
const url = 'http://stablepay-nine.vercel.app/api/v1/orders'; // no HTTPS
const url = 'stablepay-nine.vercel.app/api/v1/orders'; // missing protocol
```

**2. CORS is actually enabled on StablePay API, so if you see CORS errors:**
- Check browser console for real error
- Might be network/firewall issue
- Try from different network/device

**3. Check your firewall/VPN:**
- Some corporate networks block crypto sites
- Try disabling VPN
- Try from different network

---

## Network/Chain Issues

### Problem: Wrong network in wallet

**Symptoms:**
- Transaction fails with "Wrong network"
- Wallet shows different chain than expected

**Solutions:**

**1. StablePay auto-switches networks:**
- Widget automatically prompts to switch
- User must approve network switch in wallet

**2. Manual network switch (MetaMask):**
```javascript
await window.ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x2105' }] // Base Mainnet
});
```

**3. Add network if not in MetaMask:**
```javascript
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0x2105',
    chainName: 'Base',
    rpcUrls: ['https://mainnet.base.org'],
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://basescan.org']
  }]
});
```

### Problem: Token not showing in wallet

**Cause:** USDC token not added to wallet

**Solutions:**

**For MetaMask:**
1. Open MetaMask
2. Click "Import tokens"
3. Paste token address:
   - Base Mainnet: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
4. Symbol: USDC, Decimals: 6

**For Phantom:**
- Solana USDC appears automatically when you receive it
- Or search for "USDC" in token list

---

## Testing Problems

### Problem: Need testnet tokens

**Solutions:**

**Base Sepolia (testnet):**

1. **Get ETH (for gas):**
   - [Alchemy Faucet](https://www.alchemy.com/faucets/base-sepolia)
   - [QuickNode Faucet](https://faucet.quicknode.com/base/sepolia)

2. **Get USDC:**
   - Contract: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
   - [Base Sepolia Faucet](https://faucet.circle.com/) (if available)
   - Or ask in [Discord/Telegram]

**Solana Devnet:**

1. **Get SOL (for fees):**
   ```bash
   solana config set --url devnet
   solana airdrop 2
   ```

2. **Get USDC:**
   - Use [SPL Token Faucet](https://spl-token-faucet.com/)
   - Mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

### Problem: Testnet transactions not confirming

**Causes:**
- Testnet networks can be slow/unreliable
- Faucets rate-limit requests
- Network temporarily down

**Solutions:**

**1. Wait longer:**
- Testnets can take 30-60 seconds (vs 3-5 seconds on mainnet)
- Check block explorer

**2. Try different RPC:**
```javascript
// If Base Sepolia is slow, try different RPC
const provider = new ethers.JsonRpcProvider(
  'https://sepolia.base.org'
  // or: 'https://base-sepolia.blockpi.network/v1/rpc/public'
);
```

**3. Use mainnet:**
- If urgent, test on mainnet with small amounts ($0.10)
- Much faster and more reliable

---

## Browser/Device Issues

### Problem: Not working on mobile

**Solutions:**

**1. Use mobile wallet browsers:**
- MetaMask Mobile (has built-in browser)
- Phantom Mobile (has built-in browser)
- Trust Wallet browser

**2. Or use WalletConnect (coming soon)**

**3. Check responsive CSS:**
```css
.stablepay-checkout {
  max-width: 100%;
  /* Make sure widget fits on mobile */
}
```

### Problem: Not working in specific browser

**Supported browsers:**
- ✅ Chrome/Brave (recommended)
- ✅ Firefox
- ✅ Edge
- ✅ Safari (may need extension)
- ❌ Internet Explorer (not supported)

**Solutions:**

**1. Update browser to latest version**

**2. Enable JavaScript**

**3. Disable ad blockers** (may block wallet connections)

**4. Try incognito/private mode** (rules out extension conflicts)

---

## Performance Issues

### Problem: Widget loads slowly

**Solutions:**

**1. Preload script:**
```html
<link rel="preload" href="https://stablepay-nine.vercel.app/checkout-widget.js" as="script">
```

**2. Lazy load:**
```javascript
// Only load when user clicks "Pay with Crypto"
button.addEventListener('click', () => {
  const script = document.createElement('script');
  script.src = 'https://stablepay-nine.vercel.app/checkout-widget.js';
  document.head.appendChild(script);
});
```

**3. Check network:**
```bash
# Test API response time
curl -w "@curl-format.txt" -o /dev/null -s https://stablepay-nine.vercel.app/api/v1/orders
```

---

## Still Having Issues?

### Before contacting support:

**1. Check browser console (F12) for errors**

**2. Try in incognito mode**

**3. Test with different wallet/network**

**4. Verify all credentials:**
- Merchant ID is correct
- Wallet addresses are correct
- Using correct network (testnet vs mainnet)

### Get Help:

- **Email:** support@stablepay.com
- **Include:**
  - Error message (screenshot)
  - Browser console logs
  - Order ID or transaction hash (if applicable)
  - Steps to reproduce

- **Response time:** Usually within 24 hours

---

## Quick Checklist

Before going live, verify:

- [ ] Merchant account approved and active
- [ ] Wallet addresses configured for desired chains
- [ ] Testnet payments working correctly
- [ ] Event listeners set up (`stablepay:payment.success`)
- [ ] Backend saves order details
- [ ] Switched to mainnet configuration
- [ ] Updated wallet addresses to production wallets
- [ ] Tested on multiple browsers/devices
- [ ] Error handling implemented
- [ ] User instructions clear

---

**Last updated:** 2025-11-10
