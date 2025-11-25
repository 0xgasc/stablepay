# StablePay API Documentation

Complete reference for integrating StablePay programmatically.

**Base URL:** `https://stablepay-nine.vercel.app/api/v1`

---

## Table of Contents

- [Authentication](#authentication)
- [Orders](#orders)
- [Transactions](#transactions)
- [Merchants](#merchants)
- [Wallets](#wallets)
- [Webhooks](#webhooks-coming-soon)
- [Error Codes](#error-codes)

---

## Authentication

Most endpoints are public (no auth required). Merchant-specific endpoints require an API token.

### Get API Token

1. Log into your [dashboard](https://stablepay-nine.vercel.app/dashboard.html)
2. Go to **Developer** tab
3. Copy your **Login Token**

### Using the Token

```javascript
fetch('https://stablepay-nine.vercel.app/api/v1/admin?resource=orders', {
  headers: {
    'Authorization': `Bearer YOUR_LOGIN_TOKEN`
  }
});
```

---

## Orders

### Create Order

Create a new payment order.

**Endpoint:** `POST /orders`

**Request:**
```json
{
  "merchantId": "cmhkjckgi0000qut5wxmtsw1f",
  "amount": "10.00",
  "chain": "BASE_MAINNET",
  "customerEmail": "customer@example.com",
  "customerName": "Premium Plan",
  "paymentAddress": "0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `merchantId` | string | ✅ Yes | Your merchant ID from dashboard |
| `amount` | string | ✅ Yes | Payment amount (e.g., "10.00") |
| `chain` | string | ✅ Yes | Blockchain network (see [Chains](#supported-chains)) |
| `paymentAddress` | string | ✅ Yes | Your wallet address for this chain |
| `customerEmail` | string | ❌ No | Customer's email |
| `customerName` | string | ❌ No | Order description/product name |

**Response:**
```json
{
  "success": true,
  "order": {
    "id": "cmhxxx123abc",
    "merchantId": "cmhkjckgi0000qut5wxmtsw1f",
    "amount": "10.00",
    "chain": "BASE_MAINNET",
    "status": "PENDING",
    "paymentAddress": "0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D",
    "customerEmail": "customer@example.com",
    "customerName": "Premium Plan",
    "expiresAt": "2025-11-10T13:00:00Z",
    "createdAt": "2025-11-10T12:00:00Z",
    "updatedAt": "2025-11-10T12:00:00Z"
  }
}
```

**Example:**
```javascript
const response = await fetch('https://stablepay-nine.vercel.app/api/v1/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    merchantId: 'cmhkjckgi0000qut5wxmtsw1f',
    amount: '49.99',
    chain: 'BASE_MAINNET',
    customerEmail: 'user@example.com',
    customerName: 'Pro Subscription',
    paymentAddress: '0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D'
  })
});

const { order } = await response.json();
console.log('Order ID:', order.id);
```

---

### Get Order

Retrieve order details and status.

**Endpoint:** `GET /orders/:orderId`

**Response:**
```json
{
  "id": "cmhxxx123abc",
  "merchantId": "cmhkjckgi0000qut5wxmtsw1f",
  "amount": "10.00",
  "chain": "BASE_MAINNET",
  "status": "CONFIRMED",
  "paymentAddress": "0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D",
  "customerEmail": "customer@example.com",
  "transactions": [
    {
      "id": "txn_abc456",
      "txHash": "0xdef789...",
      "status": "CONFIRMED",
      "amount": "10.00",
      "fromAddress": "0x123...",
      "toAddress": "0x9e9...",
      "confirmations": 12,
      "blockTimestamp": "2025-11-10T12:05:00Z"
    }
  ],
  "createdAt": "2025-11-10T12:00:00Z",
  "updatedAt": "2025-11-10T12:05:30Z"
}
```

**Example:**
```javascript
const response = await fetch(`https://stablepay-nine.vercel.app/api/v1/orders/${orderId}`);
const order = await response.json();

if (order.status === 'CONFIRMED') {
  console.log('Payment confirmed!');
  console.log('Transaction:', order.transactions[0].txHash);
}
```

---

### Confirm Order

Mark an order as confirmed after blockchain transaction.

**Endpoint:** `POST /orders/:orderId/confirm`

**Request:**
```json
{
  "txHash": "0xabc123def456..."
}
```

**Response:**
```json
{
  "success": true,
  "order": {
    "id": "cmhxxx123abc",
    "status": "CONFIRMED",
    "updatedAt": "2025-11-10T12:05:30Z"
  }
}
```

**Example:**
```javascript
// After customer completes blockchain transaction
const response = await fetch(`https://stablepay-nine.vercel.app/api/v1/orders/${orderId}/confirm`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    txHash: '0xabc123def456789...'
  })
});

const { order } = await response.json();
console.log('Order confirmed:', order.status);
```

**Note:** This endpoint also:
- Creates a `Transaction` record in the database
- Updates order status to `CONFIRMED`
- Stores blockchain transaction details

---

### List Orders

Get all orders for a merchant.

**Endpoint:** `GET /admin?resource=orders`

**Headers:**
```
Authorization: Bearer YOUR_LOGIN_TOKEN
```

**Response:**
```json
{
  "orders": [
    {
      "id": "cmhxxx123abc",
      "amount": "10.00",
      "chain": "BASE_MAINNET",
      "status": "CONFIRMED",
      "customerEmail": "customer@example.com",
      "createdAt": "2025-11-10T12:00:00Z",
      "transactions": [...]
    }
  ]
}
```

**Example:**
```javascript
const response = await fetch('https://stablepay-nine.vercel.app/api/v1/admin?resource=orders', {
  headers: {
    'Authorization': `Bearer ${yourLoginToken}`
  }
});

const { orders } = await response.json();
console.log(`Total orders: ${orders.length}`);
```

---

## Transactions

### Get Transaction

Retrieve blockchain transaction details.

**Endpoint:** `GET /admin?resource=transactions`

**Headers:**
```
Authorization: Bearer YOUR_LOGIN_TOKEN
```

**Response:**
```json
{
  "transactions": [
    {
      "id": "txn_abc123",
      "orderId": "cmhxxx123abc",
      "txHash": "0xdef789...",
      "chain": "BASE_MAINNET",
      "status": "CONFIRMED",
      "amount": "10.00",
      "fromAddress": "0x123...",
      "toAddress": "0x9e9...",
      "confirmations": 24,
      "blockTimestamp": "2025-11-10T12:05:00Z",
      "createdAt": "2025-11-10T12:05:30Z"
    }
  ]
}
```

---

## Merchants

### Get Merchant Info

Retrieve merchant account details.

**Endpoint:** `GET /admin?resource=merchants`

**Headers:**
```
Authorization: Bearer YOUR_LOGIN_TOKEN
```

**Response:**
```json
{
  "merchants": [
    {
      "id": "cmhkjckgi0000qut5wxmtsw1f",
      "email": "merchant@example.com",
      "companyName": "Acme Inc",
      "contactName": "John Doe",
      "plan": "STARTER",
      "paymentMode": "DIRECT",
      "networkMode": "MAINNET",
      "isActive": true,
      "setupCompleted": true,
      "wallets": [...],
      "createdAt": "2025-11-01T00:00:00Z"
    }
  ]
}
```

---

## Wallets

### Get Merchant Wallets

Retrieve configured wallet addresses.

**Endpoint:** `GET /admin?resource=wallets&merchantId=YOUR_MERCHANT_ID`

**Response:**
```json
[
  {
    "id": "wallet_abc123",
    "merchantId": "cmhkjckgi0000qut5wxmtsw1f",
    "chain": "BASE_MAINNET",
    "address": "0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D",
    "isActive": true,
    "createdAt": "2025-11-01T00:00:00Z"
  },
  {
    "id": "wallet_def456",
    "chain": "SOLANA_MAINNET",
    "address": "9GW4bqrYugG8sRdMVC5zNwM6ZAm69ztevPadT3RCFqH2",
    "isActive": true,
    "createdAt": "2025-11-01T00:00:00Z"
  }
]
```

**Example:**
```javascript
const response = await fetch(
  `https://stablepay-nine.vercel.app/api/v1/admin?resource=wallets&merchantId=${merchantId}`
);

const wallets = await response.json();
const baseWallet = wallets.find(w => w.chain === 'BASE_MAINNET');
console.log('Base wallet:', baseWallet.address);
```

---

## Supported Chains

### Mainnets (Production)

| Chain ID | Name | Network | Token Contract |
|----------|------|---------|----------------|
| `BASE_MAINNET` | Base | Ethereum L2 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `SOLANA_MAINNET` | Solana | Solana | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `ETH_MAINNET` | Ethereum | Ethereum | Coming soon |
| `POLYGON_MAINNET` | Polygon | Polygon | Coming soon |
| `ARBITRUM_MAINNET` | Arbitrum | Arbitrum | Coming soon |

### Testnets (Testing)

| Chain ID | Name | Network | Token Contract |
|----------|------|---------|----------------|
| `BASE_SEPOLIA` | Base Sepolia | Ethereum L2 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| `SOLANA_DEVNET` | Solana Devnet | Solana | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

---

## Webhooks (Coming Soon)

Get real-time notifications when payments are received.

**Events:**
- `order.created` - New order created
- `order.confirmed` - Payment confirmed on blockchain
- `order.expired` - Order expired without payment
- `transaction.confirmed` - Blockchain transaction confirmed

**Example Webhook Payload:**
```json
{
  "event": "order.confirmed",
  "data": {
    "orderId": "cmhxxx123abc",
    "amount": "10.00",
    "chain": "BASE_MAINNET",
    "txHash": "0xdef789...",
    "timestamp": "2025-11-10T12:05:30Z"
  }
}
```

---

## Error Codes

### HTTP Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| `200` | OK | Request successful |
| `201` | Created | Resource created successfully |
| `400` | Bad Request | Invalid request parameters |
| `401` | Unauthorized | Missing or invalid authentication |
| `404` | Not Found | Resource not found |
| `500` | Server Error | Internal server error |

### Error Response Format

```json
{
  "error": "Merchant not found",
  "code": "MERCHANT_NOT_FOUND",
  "details": {
    "merchantId": "invalid_id"
  }
}
```

### Common Errors

**Merchant not found:**
```json
{
  "error": "Merchant not found",
  "code": "MERCHANT_NOT_FOUND"
}
```
→ Check your merchant ID is correct

**Missing required fields:**
```json
{
  "error": "Missing required fields",
  "required": ["merchantId", "amount", "chain", "paymentAddress"]
}
```
→ Include all required fields in request

**Invalid chain:**
```json
{
  "error": "Unsupported chain",
  "supported": ["BASE_MAINNET", "SOLANA_MAINNET", ...]
}
```
→ Use a supported chain ID

**Wallet not configured:**
```json
{
  "error": "No wallet configured for BASE_MAINNET"
}
```
→ Add wallet address in dashboard

---

## Rate Limits

**Current Limits:**
- 100 requests per minute per IP
- 1000 requests per hour per merchant

**Rate Limit Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1699564800
```

---

## Complete Integration Example

Here's a full example of creating an order, processing payment, and confirming:

```javascript
// Step 1: Create order
async function createOrder(amount, chain) {
  const response = await fetch('https://stablepay-nine.vercel.app/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantId: 'YOUR_MERCHANT_ID',
      amount: amount,
      chain: chain,
      customerEmail: 'customer@example.com',
      customerName: 'Product Purchase',
      paymentAddress: 'YOUR_WALLET_ADDRESS'
    })
  });

  const { order } = await response.json();
  return order;
}

// Step 2: Connect wallet (MetaMask example)
async function connectWallet() {
  const accounts = await window.ethereum.request({
    method: 'eth_requestAccounts'
  });

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  return { provider, signer, address: accounts[0] };
}

// Step 3: Execute blockchain transaction
async function executePayment(order, wallet) {
  const usdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base USDC

  const usdcContract = new ethers.Contract(
    usdcAddress,
    ['function transfer(address to, uint256 amount) returns (bool)'],
    wallet.signer
  );

  const amount = ethers.parseUnits(order.amount, 6); // USDC has 6 decimals
  const tx = await usdcContract.transfer(order.paymentAddress, amount);

  await tx.wait(); // Wait for confirmation

  return tx.hash;
}

// Step 4: Confirm order
async function confirmOrder(orderId, txHash) {
  const response = await fetch(
    `https://stablepay-nine.vercel.app/api/v1/orders/${orderId}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash })
    }
  );

  const { order } = await response.json();
  return order;
}

// Complete flow
async function processPayment() {
  try {
    // 1. Create order
    const order = await createOrder('10.00', 'BASE_MAINNET');
    console.log('Order created:', order.id);

    // 2. Connect wallet
    const wallet = await connectWallet();
    console.log('Wallet connected:', wallet.address);

    // 3. Execute payment
    const txHash = await executePayment(order, wallet);
    console.log('Transaction sent:', txHash);

    // 4. Confirm order
    const confirmedOrder = await confirmOrder(order.id, txHash);
    console.log('Payment confirmed!', confirmedOrder.status);

    // 5. Update your database
    await fetch('/your-api/complete-purchase', {
      method: 'POST',
      body: JSON.stringify({
        orderId: order.id,
        txHash: txHash,
        status: 'completed'
      })
    });

  } catch (error) {
    console.error('Payment failed:', error);
  }
}
```

---

## Testing with cURL

### Create Order
```bash
curl -X POST https://stablepay-nine.vercel.app/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "YOUR_MERCHANT_ID",
    "amount": "10.00",
    "chain": "BASE_SEPOLIA",
    "customerEmail": "test@example.com",
    "customerName": "Test Order",
    "paymentAddress": "0x9e9Ebf31018EAeddB50E52085f4CCB4367235f2D"
  }'
```

### Get Order
```bash
curl https://stablepay-nine.vercel.app/api/v1/orders/cmhxxx123abc
```

### Confirm Order
```bash
curl -X POST https://stablepay-nine.vercel.app/api/v1/orders/cmhxxx123abc/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "txHash": "0xabc123def456..."
  }'
```

### Get Merchant Wallets
```bash
curl 'https://stablepay-nine.vercel.app/api/v1/admin?resource=wallets&merchantId=YOUR_MERCHANT_ID'
```

---

## SDK & Libraries

Official SDKs coming soon:

- 🟡 JavaScript/TypeScript SDK (in development)
- 🔵 Python SDK (planned)
- 🟢 Ruby SDK (planned)
- 🔴 PHP SDK (planned)

Meanwhile, use standard HTTP requests (fetch, axios, etc.)

---

## Support

- **Email:** support@stablepay.com
- **Documentation:** [Full Docs](./GETTING_STARTED.md)
- **Status:** [status.stablepay.com](https://status.stablepay.com)

---

**Happy building!** 🚀
