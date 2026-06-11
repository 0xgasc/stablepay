# Checkout Widget - Exact Implementation Flow

## ⚠️ IMPORTANT: Copy This Code Exactly

The Test Payment button in `/public/dashboard.html` (lines 1338-1933) already works perfectly. This guide shows you **exactly** how to copy that logic into the checkout widget.

---

## The Complete Flow (Step-by-Step)

### Step 1: Customer Lands on Checkout Widget

```html
<!-- Merchant's website -->
<div class="stablepay-checkout"
     data-merchant="cmhkjckgi0000qut5wxmtsw1f"
     data-amount="10.00"
     data-chain="BASE_SEPOLIA">
</div>
```

Widget shows:
- Amount: $10.00 USDC
- Chain: Base Sepolia
- Button: "Connect Wallet"

---

### Step 2: Connect Wallet (MetaMask or Phantom)

#### For EVM Chains (Base, Ethereum, Polygon, Arbitrum)

**Copy from `/public/dashboard.html` lines 1338-1383:**

```javascript
// EXACT CODE - COPY THIS
async function connectMetaMask() {
    try {
        // Detect MetaMask (even if Phantom is also installed)
        let ethereum = window.ethereum;

        // If multiple providers exist, find MetaMask
        if (window.ethereum?.providers) {
            ethereum = window.ethereum.providers.find(p => p.isMetaMask);
        } else if (!window.ethereum?.isMetaMask && window.ethereum?.isPhantom) {
            // If only Phantom is installed
            alert('Please install MetaMask. Phantom is detected but MetaMask is required for EVM chains.');
            window.open('https://metamask.io/download/', '_blank');
            return null;
        }

        if (!ethereum) {
            alert('Please install MetaMask');
            window.open('https://metamask.io/download/', '_blank');
            return null;
        }

        // Request accounts
        const accounts = await ethereum.request({
            method: 'eth_requestAccounts'
        });

        if (!accounts || accounts.length === 0) {
            alert('No accounts found');
            return null;
        }

        // Create provider and signer
        const provider = new ethers.BrowserProvider(ethereum);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();

        console.log('MetaMask connected:', address);

        return {
            provider,
            signer,
            address,
            type: 'metamask'
        };
    } catch (error) {
        console.error('MetaMask connection error:', error);
        alert('Failed to connect MetaMask: ' + error.message);
        return null;
    }
}
```

#### For Solana (Solana Mainnet/Devnet)

**Copy from `/public/dashboard.html` lines 1385-1407:**

```javascript
// EXACT CODE - COPY THIS
async function connectPhantom() {
    try {
        const phantom = window.solana;

        if (!phantom?.isPhantom) {
            alert('Please install Phantom wallet');
            window.open('https://phantom.app/', '_blank');
            return null;
        }

        await phantom.connect();
        const address = phantom.publicKey.toString();

        console.log('Phantom connected:', address);

        return {
            provider: phantom,
            address,
            type: 'phantom'
        };
    } catch (error) {
        console.error('Phantom connection error:', error);
        alert('Failed to connect Phantom: ' + error.message);
        return null;
    }
}
```

**What this returns:**
```javascript
// EVM wallets return:
{
    provider: BrowserProvider,
    signer: Signer,
    address: "0x123...",
    type: "metamask"
}

// Solana wallets return:
{
    provider: PhantomProvider,
    address: "ABC123...",
    type: "phantom"
}
```

---

### Step 3: Fetch Merchant's Wallet Address

**Before** creating the order, you need to know which wallet address to send payment to:

```javascript
// Fetch merchant's configured wallets
const walletResponse = await fetch(`/api/v1/admin?resource=wallets&merchantId=${merchantId}`);
const wallets = await walletResponse.json();

// Find the wallet for the selected chain
const merchantWallet = wallets.find(w => w.chain === chain && w.isActive);

if (!merchantWallet) {
    throw new Error(`Merchant has not configured a wallet for ${chain}`);
}

console.log('Merchant wallet:', merchantWallet.address);
// Example: "0x9GW4bqr38vZ7aTNPFcLiufYnYmVmcY1y39bB5bWJ"
```

**What you get back:**
```json
[
  {
    "id": "wallet_abc123",
    "merchantId": "cmhkjckgi0000qut5wxmtsw1f",
    "chain": "BASE_SEPOLIA",
    "address": "0x9GW4bqr38vZ7aTNPFcLiufYnYmVmcY1y39bB5bWJ",
    "isActive": true,
    "createdAt": "2025-11-10T00:00:00Z"
  },
  {
    "id": "wallet_def456",
    "chain": "SOLANA_DEVNET",
    "address": "BqcX4aKvYZ...",
    "isActive": true
  }
]
```

---

### Step 4: Create Order in Database

**Now** create the order record with the merchant's wallet address:

```javascript
// API Call
const orderResponse = await fetch('/api/v1/orders', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        merchantId: 'cmhkjckgi0000qut5wxmtsw1f', // from widget data-merchant
        amount: '10.00',                          // from widget data-amount
        chain: 'BASE_SEPOLIA',                    // from widget data-chain
        customerEmail: 'customer@example.com',    // optional
        customerName: 'Widget Payment',
        paymentAddress: merchantWallet.address    // ← FROM STEP 3
    })
});

const { order } = await orderResponse.json();
// order.id = "cmhxxx123"
// order.status = "PENDING"
```

**What you get back:**
```json
{
  "success": true,
  "order": {
    "id": "cmhxxx123",
    "merchantId": "cmhkjckgi0000qut5wxmtsw1f",
    "amount": "10.00",
    "chain": "BASE_SEPOLIA",
    "status": "PENDING",
    "paymentAddress": "0x9GW4bqr...",
    "expiresAt": "2025-11-10T20:00:00Z"
  }
}
```

**Database state after this:**
- Orders table: 1 new row, status = PENDING
- Transactions table: Empty (no transaction yet)

---

### Step 5: Execute Blockchain Transaction

Now the user signs and sends the actual blockchain transaction.

#### Option A: EVM Chains (Base, Ethereum, Polygon, Arbitrum)

**Copy from `/public/dashboard.html` lines 1466-1635:**

```javascript
// EXACT CODE - COPY THIS
async function executeEVMPayment(wallet, orderId, amount, merchantWallet, chain) {
    try {
        // Get the correct Ethereum provider (MetaMask)
        let ethereum = window.ethereum;
        if (window.ethereum?.providers) {
            ethereum = window.ethereum.providers.find(p => p.isMetaMask);
        }

        // Check if MetaMask is connected
        if (!ethereum || !ethereum.isConnected()) {
            throw new Error('MetaMask disconnected');
        }

        // Get chain config
        const chainConfig = getChainConfig(chain);
        if (!chainConfig) {
            throw new Error('Chain configuration not found');
        }

        // Switch to correct network if needed
        const network = await wallet.provider.getNetwork();
        const currentChainId = network.chainId;
        const targetChainId = parseInt(chainConfig.chainId, 16);

        if (currentChainId !== BigInt(targetChainId)) {
            try {
                await ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: chainConfig.chainId }],
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    // Chain not added, add it
                    await ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: chainConfig.chainId,
                            chainName: chainConfig.chainName,
                            rpcUrls: chainConfig.rpcUrls,
                            nativeCurrency: chainConfig.nativeCurrency,
                            blockExplorerUrls: chainConfig.blockExplorerUrls
                        }]
                    });
                } else {
                    throw switchError;
                }
            }

            // Recreate provider/signer after network switch
            wallet.provider = new ethers.BrowserProvider(ethereum);
            wallet.signer = await wallet.provider.getSigner();
        }

        // Get USDC token contract
        const usdcAddress = chainConfig.tokens.USDC;
        const usdcContract = new ethers.Contract(
            usdcAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            wallet.signer
        );

        // Convert amount to smallest unit (USDC has 6 decimals)
        const amountInSmallestUnit = ethers.parseUnits(amount, 6);

        console.log('Sending transaction...');
        console.log('From:', wallet.address);
        console.log('To:', merchantWallet);
        console.log('Amount:', amount, 'USDC');

        // Execute transfer
        const tx = await usdcContract.transfer(merchantWallet, amountInSmallestUnit);

        console.log('Transaction sent:', tx.hash);
        alert('Transaction submitted! Waiting for confirmation...');

        // Wait for confirmation
        const receipt = await tx.wait();

        console.log('Transaction confirmed!', receipt);

        // Return transaction hash
        return tx.hash;

    } catch (error) {
        console.error('EVM payment error:', error);

        if (error.code === 4001) {
            throw new Error('Transaction cancelled by user');
        }

        throw error;
    }
}

// Chain configuration helper
function getChainConfig(chainId) {
    const configs = {
        'BASE_SEPOLIA': {
            chainId: '0x14a34',
            chainName: 'Base Sepolia',
            rpcUrls: ['https://sepolia.base.org'],
            blockExplorerUrls: ['https://sepolia.basescan.org'],
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            tokens: {
                USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
            }
        },
        'BASE_MAINNET': {
            chainId: '0x2105',
            chainName: 'Base',
            rpcUrls: ['https://mainnet.base.org'],
            blockExplorerUrls: ['https://basescan.org'],
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            tokens: {
                USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
            }
        }
        // Add other chains as needed
    };

    return configs[chainId];
}
```

**What happens:**
1. User sees MetaMask popup asking to sign transaction
2. Shows: "Send 10 USDC to 0x9GW4bqr..."
3. User clicks "Confirm"
4. Transaction broadcasts to blockchain
5. Code waits for confirmation
6. Returns transaction hash: `"0xabc123..."`

#### Option B: Solana (Mainnet/Devnet)

**Copy from `/public/dashboard.html` lines 1637-1933:**

```javascript
// EXACT CODE - COPY THIS
async function executeSolanaPayment(wallet, orderId, amount, merchantWallet, chain) {
    try {
        const phantom = wallet.provider;
        const connection = new solanaWeb3.Connection(
            chain === 'SOLANA_MAINNET'
                ? 'https://api.mainnet-beta.solana.com'
                : 'https://api.devnet.solana.com'
        );

        // Get token mint address
        const tokenMints = {
            'SOLANA_DEVNET': {
                USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
            },
            'SOLANA_MAINNET': {
                USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
            }
        };

        const usdcMint = new solanaWeb3.PublicKey(tokenMints[chain].USDC);
        const fromPubkey = phantom.publicKey;
        const toPubkey = new solanaWeb3.PublicKey(merchantWallet);

        // Convert amount to smallest unit (USDC has 6 decimals on Solana too)
        const transferAmount = Math.floor(parseFloat(amount) * 1_000_000);

        console.log('Solana payment details:');
        console.log('From:', fromPubkey.toString());
        console.log('To:', toPubkey.toString());
        console.log('Amount:', transferAmount, 'micro-USDC');

        // Get associated token accounts
        const TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
        const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

        // Helper to get associated token address
        async function getAssociatedTokenAddress(mint, owner) {
            const [address] = await solanaWeb3.PublicKey.findProgramAddress(
                [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
                ASSOCIATED_TOKEN_PROGRAM_ID
            );
            return address;
        }

        const fromTokenAccount = await getAssociatedTokenAddress(usdcMint, fromPubkey);
        const toTokenAccount = await getAssociatedTokenAddress(usdcMint, toPubkey);

        console.log('From token account:', fromTokenAccount.toString());
        console.log('To token account:', toTokenAccount.toString());

        // Check if accounts exist
        const fromAccountInfo = await connection.getAccountInfo(fromTokenAccount);
        const toAccountInfo = await connection.getAccountInfo(toTokenAccount);

        console.log('Source account exists:', !!fromAccountInfo);
        console.log('Destination account exists:', !!toAccountInfo);

        if (!fromAccountInfo) {
            throw new Error('Source token account does not exist! You need USDC in your Phantom wallet first.');
        }

        // Create destination token account if needed
        if (!toAccountInfo) {
            console.log('Creating destination token account...');

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

            const createAccountTx = new solanaWeb3.Transaction();
            createAccountTx.recentBlockhash = blockhash;
            createAccountTx.feePayer = fromPubkey;

            // Create associated token account instruction
            createAccountTx.add(
                new solanaWeb3.TransactionInstruction({
                    keys: [
                        { pubkey: fromPubkey, isSigner: true, isWritable: true },
                        { pubkey: toTokenAccount, isSigner: false, isWritable: true },
                        { pubkey: toPubkey, isSigner: false, isWritable: false },
                        { pubkey: usdcMint, isSigner: false, isWritable: false },
                        { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
                        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                    ],
                    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
                    data: new Uint8Array(0)
                })
            );

            const signedCreateTx = await phantom.signTransaction(createAccountTx);
            const createSig = await connection.sendRawTransaction(signedCreateTx.serialize());
            await connection.confirmTransaction({
                signature: createSig,
                blockhash,
                lastValidBlockHeight
            });

            console.log('Token account created:', createSig);
        }

        // Now send the transfer
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        const transferTx = new solanaWeb3.Transaction();
        transferTx.recentBlockhash = blockhash;
        transferTx.feePayer = fromPubkey;

        // Create transfer instruction
        const dataArr = new Uint8Array(9);
        dataArr[0] = 3; // Transfer instruction index

        // Encode amount as little-endian u64
        const amountBigInt = BigInt(transferAmount);
        for (let i = 0; i < 8; i++) {
            dataArr[1 + i] = Number((amountBigInt >> BigInt(i * 8)) & BigInt(0xFF));
        }

        transferTx.add(
            new solanaWeb3.TransactionInstruction({
                keys: [
                    { pubkey: fromTokenAccount, isSigner: false, isWritable: true },
                    { pubkey: toTokenAccount, isSigner: false, isWritable: true },
                    { pubkey: fromPubkey, isSigner: true, isWritable: false }
                ],
                programId: TOKEN_PROGRAM_ID,
                data: dataArr
            })
        );

        console.log('Requesting signature from Phantom...');

        // Sign and send
        let signature;
        const signedTx = await phantom.signTransaction(transferTx);
        signature = await connection.sendRawTransaction(signedTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        });

        console.log('Transaction sent! Signature:', signature);
        alert('Transaction submitted! Confirming...');

        // Wait for confirmation
        const confirmation = await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        });

        if (confirmation.value.err) {
            throw new Error('Transaction failed: ' + JSON.stringify(confirmation.value.err));
        }

        console.log('Transaction confirmed!', signature);

        // Return transaction signature
        return signature;

    } catch (error) {
        console.error('Solana payment error:', error);
        throw error;
    }
}
```

**What happens:**
1. User sees Phantom popup asking to approve transaction
2. Shows: "Send 10 USDC" (may need to create token account first)
3. User clicks "Approve"
4. Transaction broadcasts to Solana
5. Code waits for confirmation
6. Returns signature: `"ABC123..."`

---

### Step 6: Confirm Order in Database

**After** transaction confirms on blockchain, update the order:

```javascript
// Update order with transaction hash
const confirmResponse = await fetch(`/api/v1/orders/${orderId}/confirm`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        txHash: txHash  // "0xabc123..." or "ABC123..."
    })
});

const { order } = await confirmResponse.json();
// order.status = "CONFIRMED"
```

**What the API does:**
1. Creates a Transaction record:
   ```javascript
   {
       orderId: "cmhxxx123",
       txHash: "0xabc123...",
       chain: "BASE_SEPOLIA",
       amount: "10.00",
       fromAddress: wallet.address,
       toAddress: merchantWallet,
       status: "CONFIRMED",
       blockTimestamp: new Date(),
       confirmations: 1
   }
   ```

2. Updates Order record:
   ```javascript
   {
       id: "cmhxxx123",
       status: "CONFIRMED",  // changed from PENDING
       updatedAt: new Date()
   }
   ```

**Database state after this:**
- Orders table: status changed to CONFIRMED
- Transactions table: 1 new row with txHash

---

## Complete Widget Flow (Put It All Together)

```javascript
// In checkout-widget.js

class StablePayCheckout {
    async processPayment() {
        try {
            const merchantId = this.options.merchantId;
            const amount = this.options.amount;
            const chain = this.options.chain;

            // Step 1: Connect wallet
            let wallet;
            if (chain.includes('SOLANA')) {
                wallet = await connectPhantom();
            } else {
                wallet = await connectMetaMask();
            }

            if (!wallet) {
                throw new Error('Failed to connect wallet');
            }

            console.log('Wallet connected:', wallet.address);

            // Step 2: Fetch merchant's wallet for this chain
            const merchantWallet = await this.getMerchantWallet(merchantId, chain);

            console.log('Merchant wallet:', merchantWallet);

            // Step 3: Create order in database
            const orderResponse = await fetch('/api/v1/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    merchantId: merchantId,
                    amount: amount,
                    chain: chain,
                    customerEmail: this.options.customerEmail,
                    customerName: 'Widget Payment',
                    paymentAddress: merchantWallet  // ← merchant's wallet address
                })
            });

            const { order } = await orderResponse.json();
            const orderId = order.id;

            console.log('Order created:', orderId, '- Status:', order.status); // "PENDING"

            // Step 4: Execute blockchain transaction
            let txHash;
            if (chain.includes('SOLANA')) {
                txHash = await executeSolanaPayment(wallet, orderId, amount, merchantWallet, chain);
            } else {
                txHash = await executeEVMPayment(wallet, orderId, amount, merchantWallet, chain);
            }

            console.log('Transaction confirmed! Hash:', txHash);

            // Step 5: Confirm order in database
            const confirmResponse = await fetch(`/api/v1/orders/${orderId}/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ txHash })
            });

            const { order: confirmedOrder } = await confirmResponse.json();

            console.log('Order confirmed in database! Status:', confirmedOrder.status); // "CONFIRMED"

            // ✅ At this point:
            // - Orders table has 1 row with status="CONFIRMED"
            // - Transactions table has 1 row with the txHash
            // - Merchant can see the payment in their dashboard

            // Success!
            this.showSuccess(orderId, txHash);

            // Emit event for merchant's website
            this.emit('payment.success', {
                orderId,
                txHash,
                amount,
                chain
            });

        } catch (error) {
            console.error('Payment error:', error);
            this.showError(error.message);
            this.emit('payment.failed', error);
        }
    }

    async getMerchantWallet(merchantId, chain) {
        // Fetch merchant's configured wallets
        const response = await fetch(`/api/v1/admin?resource=wallets&merchantId=${merchantId}`);
        const wallets = await response.json();

        // Find active wallet for this chain
        const wallet = wallets.find(w => w.chain === chain && w.isActive);

        if (!wallet) {
            throw new Error(`No wallet configured for ${chain}`);
        }

        return wallet.address; // "0x123..." or "ABC123..."
    }
}
```

---

## API Endpoints Summary

### 1. Create Order
```
POST /api/v1/orders

Request:
{
  "merchantId": "cmhkjckgi0000qut5wxmtsw1f",
  "amount": "10.00",
  "chain": "BASE_SEPOLIA",
  "customerEmail": "customer@example.com",
  "customerName": "Widget Payment",
  "paymentAddress": "0x9GW4bqr..."
}

Response:
{
  "success": true,
  "order": {
    "id": "cmhxxx123",
    "status": "PENDING",
    "amount": "10.00",
    "chain": "BASE_SEPOLIA",
    ...
  }
}

Creates: 1 row in Orders table (status: PENDING)
```

### 2. Confirm Order
```
POST /api/v1/orders/:orderId/confirm

Request:
{
  "txHash": "0xabc123..."
}

Response:
{
  "success": true,
  "order": {
    "id": "cmhxxx123",
    "status": "CONFIRMED",
    ...
  }
}

Creates: 1 row in Transactions table
Updates: Orders table status → CONFIRMED
```

### 3. Get Merchant Wallets
```
GET /api/v1/admin?resource=wallets&merchantId=xxx

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

## Error Handling

```javascript
try {
    // Payment flow
} catch (error) {
    if (error.code === 4001) {
        // User cancelled in wallet
        showMessage('Payment cancelled');
    } else if (error.message.includes('insufficient funds')) {
        showMessage('Insufficient USDC balance');
    } else if (error.message.includes('wrong network')) {
        showMessage('Please switch to the correct network in your wallet');
    } else {
        showMessage('Payment failed: ' + error.message);
    }
}
```

---

## Testing Checklist

### Test on Base Sepolia (Testnet)
1. ✅ Connect MetaMask
2. ✅ Switch to Base Sepolia network
3. ✅ Get test USDC from faucet
4. ✅ Click "Pay" button
5. ✅ See MetaMask popup with correct amount
6. ✅ Confirm transaction
7. ✅ Wait for confirmation
8. ✅ See success message
9. ✅ Check Orders table: status = CONFIRMED
10. ✅ Check Transactions table: txHash present

### Test on Solana Devnet
1. ✅ Connect Phantom
2. ✅ Get devnet USDC
3. ✅ Click "Pay" button
4. ✅ See Phantom popup
5. ✅ Approve transaction
6. ✅ Wait for confirmation
7. ✅ See success message
8. ✅ Verify in database

---

## That's It!

The entire payment flow is:
1. **Connect wallet** (copy lines 1338-1407)
2. **Fetch merchant wallet** (GET /api/v1/admin?resource=wallets&merchantId=xxx)
3. **Create order** (POST /api/v1/orders with merchantWallet address)
4. **Execute transaction** (copy lines 1466-1635 for EVM or 1637-1933 for Solana)
5. **Confirm order** (POST /api/v1/orders/:id/confirm with txHash)
6. **Show success**

All the code already exists in `/public/dashboard.html`. Just copy it into the widget.

**No need to build blockchain infrastructure. Just copy the working code.** 🚀

---

## What Gets Written to Your Database Tables

### When you call `POST /api/v1/orders`:
```javascript
// Creates 1 row in Orders table:
{
  id: "cmhxxx123",
  merchantId: "cmhkjckgi0000qut5wxmtsw1f",
  amount: "10.00",
  chain: "BASE_SEPOLIA",
  status: "PENDING",
  paymentAddress: "0x9GW4bqr...",  // merchant's wallet
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 3600000)  // 1 hour from now
}
```

### When you call `POST /api/v1/orders/:id/confirm`:
```javascript
// Creates 1 row in Transactions table:
{
  id: "txn_abc456",
  orderId: "cmhxxx123",
  txHash: "0xabc123...",
  chain: "BASE_SEPOLIA",
  amount: "10.00",
  fromAddress: "0x123...",  // customer's wallet
  toAddress: "0x9GW4bqr...",  // merchant's wallet
  status: "CONFIRMED",
  blockTimestamp: new Date(),
  confirmations: 1,
  createdAt: new Date()
}

// Updates Orders table:
{
  id: "cmhxxx123",
  status: "CONFIRMED",  // ← Changed from "PENDING"
  updatedAt: new Date()
}
```

So after a successful payment, you'll have:
- **1 row in Orders table** with `status="CONFIRMED"`
- **1 row in Transactions table** with the blockchain transaction hash
- Merchant sees the payment in their dashboard Orders tab

They can store whatever they want in their own database tables - we just need these 2 writes to happen via our API.
