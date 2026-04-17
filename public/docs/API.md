# StablePay API Reference

Base URL: `https://wetakestables.shop`

All request and response bodies are JSON. All timestamps are ISO-8601 UTC.

---

## Authentication

Merchant endpoints require a Bearer token obtained from your StablePay dashboard → **Developer** tab.

```
Authorization: Bearer sp_live_...
```

Public endpoints (customer checkout, order status, receipt lookup, wallet history) need no auth.

Admin endpoints are out of scope for this document.

---

## Idempotency

State-changing endpoints accept an optional `Idempotency-Key` header. Send a unique string (UUID v4 recommended) and StablePay will return the first response for that key verbatim on retries. Keys are scoped to `(merchantId, path, key, body-hash)` and cached 24 hours.

```
Idempotency-Key: 9b3d4ab8-6ef5-4c6d-bafe-4f1a2e02a40a
```

Supported on: `POST /api/embed/checkout`, `POST /api/refunds`, `POST /api/refunds/:id/process`.

A replayed response includes the header `Idempotent-Replayed: true`.

---

## Rate Limits

| Tier | Limit |
|---|---|
| FREE | 100 requests / hour |
| STARTER | 1,000 / hour |
| PRO | 10,000 / hour |
| ENTERPRISE | Custom |
| Anonymous (per-IP) | 20–100 / hour depending on endpoint |

Exceeded limits return `429`. The response header `Retry-After` specifies seconds until reset.

---

## Chains & Tokens

All chains below are **live on mainnet**. Decimals default to 6 unless noted.

| Chain (`chain`) | Tokens (`token`) | Decimals |
|---|---|---|
| `BASE_MAINNET` | USDC, USDT, EURC | 6 |
| `ETHEREUM_MAINNET` | USDC, USDT, EURC | 6 |
| `POLYGON_MAINNET` | USDC, USDT | 6 |
| `ARBITRUM_MAINNET` | USDC, USDT | 6 |
| `BNB_MAINNET` | USDC, USDT | **18** |
| `SOLANA_MAINNET` | USDC, USDT, EURC | 6 |
| `TRON_MAINNET` | USDC, USDT | 6 |

**Orders can be chain-agnostic**: omit `chain` at creation and the customer picks their chain on the checkout page.

The scanner enforces that the token received on-chain matches `order.token` exactly — a USDC-typed order will not confirm if the customer sends USDT or EURC to the same address.

---

## Orders

### Create Order (customer checkout)

`POST /api/embed/checkout`

```json
{
  "merchantId": "cmnom9tx00000nbb6e12ewrnh",
  "amount": 49.99,
  "chain": "BASE_MAINNET",
  "token": "USDC",
  "productName": "Annual Plan",
  "externalId": "your-order-123",
  "customerEmail": "user@x.com",
  "returnUrl": "https://shop.example.com/thanks",
  "metadata": { "plan": "pro" }
}
```

`chain`, `token`, and all other fields after `amount` are optional. Omit `chain` for a chain-agnostic order (customer picks on checkout).

Response `200`:

```json
{
  "orderId": "ord_01hm...",
  "amount": 49.99,
  "chain": "BASE_MAINNET",
  "token": "USDC",
  "paymentAddress": "0x...",
  "expiresAt": "2026-04-16T18:30:00Z",
  "status": "PENDING"
}
```

Redirect the customer to `https://wetakestables.shop/checkout?orderId=<orderId>` (or embed the widget) to complete payment.

### Get Order Status (public)

`GET /api/embed/order/:orderId`

Used by the checkout widget/page to poll for confirmation. Returns the order plus any attached transactions.

### Attach TX Hash (public)

`POST /api/embed/order/:orderId/tx`

Body: `{ "txHash": "0x..." }`

Used when the customer pastes a TX hash manually. StablePay auto-verifies on-chain:

- EVM: the `Transfer` log must be emitted by the exact token contract that matches `order.token`, the destination must be the order's `paymentAddress`, and the amount must fall within ±0.1% of `order.amount`. The order flips to `CONFIRMED` only after the chain's required confirmations are reached; before that the response is `AWAITING_CONFIRMATIONS`.
- Solana: the `transferChecked` mint must match `order.token`'s SPL mint. Legacy mint-less `transfer` instructions are rejected.
- TRON: the TRC-20 contract must match `order.token`.

### List Orders (merchant)

`GET /api/orders?page=1&limit=50` — merchant auth required.

### Customer Order History (public)

`GET /api/orders/history/lookup?wallet=0x...`

Returns up to 50 recent `CONFIRMED` + `REFUNDED` orders across all merchants for the given wallet. Embed `https://wetakestables.shop/history?wallet=<address>` anywhere to link customers to their purchase history.

Rate limit: 20 req/hr per IP.

---

## Stores (multi-brand)

A merchant can operate multiple stores (brands) from one account. Each store has its own webhook URL + secret, branding (logo, colors, display name), and optional per-chain wallet routing overrides. Use stores when you run multiple brands that need isolated backend integrations or different deposit wallets.

Every existing merchant has a **"Default" store** auto-created on migration — you don't need to use stores if you don't want to.

### Create a store

`POST /api/stores` (merchant auth)

```json
{
  "slug": "flirtynlocal",
  "name": "FlirtyNLocal",
  "displayName": "FlirtyNLocal",
  "logoUrl": "https://flirtynlocal.com/logo.svg",
  "headerColor": "#FF2B6E",
  "website": "https://flirtynlocal.com",
  "webhookUrl": "https://api.flirtynlocal.com/webhooks/stablepay",
  "webhookEnabled": true
}
```

Response (webhook secret returned **exactly once**):

```json
{
  "id": "cmp2xyz...",
  "slug": "flirtynlocal",
  "name": "FlirtyNLocal",
  "webhookSecret": "e3f1a8...",
  "secretGenerated": true,
  "_secretWarning": "Store this secret now — it will never be shown again."
}
```

### Manage

- `GET /api/stores` — list active stores (`?includeArchived=1` to include archived)
- `GET /api/stores/:id` — detail (never includes `webhookSecret`)
- `PATCH /api/stores/:id` — update
- `DELETE /api/stores/:id` — soft-archive (existing orders continue; new checkouts rejected)
- `POST /api/stores/:id/webhook/rotate-secret` — returns new secret once

### Store wallet overrides

Optional: route payments for a specific chain to a different wallet for this store. By default, stores inherit the merchant's wallets.

- `POST /api/stores/:id/wallets` — body `{ chain, address, supportedTokens?, priority?, isActive? }`
- `PATCH /api/stores/:id/wallets/:walletId` — update
- `DELETE /api/stores/:id/wallets/:walletId` — revert to merchant default

### Using a store at checkout

Pass `storeId` at order creation:

**Widget:**
```html
<div class="stablepay-checkout"
  data-merchant="MERCHANT_ID"
  data-store-id="STORE_ID"
  data-amount="19.99">
</div>
```

**JS API:**
```js
StablePay.checkout({ merchantId: '...', storeId: '...', amount: 19.99 });
```

**Direct API:**
```json
POST /api/embed/checkout
{ "merchantId": "...", "storeId": "...", "amount": 19.99, "token": "USDC" }
```

When an order has `storeId`, the checkout page renders the store's branding (logo, display name, colors) — not the merchant's. Webhooks go to the store's URL, signed with the store's secret.

### Public branding endpoint

`GET /api/embed/store/:id` — public, returns `{ id, name, displayName, logoUrl, headerColor, headerTextColor, website, backButtonText, widgetConfig }`. Used by the checkout page to display store-specific branding. Returns 410 if archived.

---

## Payment Links

### Create

`POST /api/payment-links` (merchant auth)

```json
{
  "amount": 19.99,
  "token": "USDC",
  "chains": ["BASE_MAINNET", "SOLANA_MAINNET"],
  "productName": "Newsletter",
  "description": "Annual subscription",
  "externalId": "plan-nl-001",
  "storeId": "cmp2xyz..."
}
```

`chains` can be omitted or left empty — the customer will see every chain you have a wallet configured for. `storeId` is optional; when set, the link inherits the store's branding and routes webhooks to the store's URL.

Response includes `url` (e.g. `https://wetakestables.shop/pay/abc12345`). Share that URL — customers land on a branded checkout page.

Query-string customization is passed through when the customer follows the link:

- `?returnUrl=https://shop.example.com/thanks` — where the "Back" button takes the customer after payment.
- `?backButtonText=Back+to+Newsletter` — override the "Back" button label.
- `?customerEmail=user@x.com` — pre-fill the email field.
- `?logoUrl=https://...` — override the merchant logo for this session.

### List / Update / Deactivate

- `GET /api/payment-links`
- `PATCH /api/payment-links/:id`
- `DELETE /api/payment-links/:id` (soft-deactivates; orders already created still work)

---

## Refunds

### Request

`POST /api/refunds` — supports `Idempotency-Key`.

```json
{
  "orderId": "ord_...",
  "amount": 10.00,
  "reason": "Customer requested"
}
```

`amount` optional; defaults to the full order amount. Auto-approves if `amount ≤ refundAutoApproveThreshold` (merchant setting, platform default $50). Otherwise status starts `PENDING`. Refunds are only allowed within 30 days of order confirmation.

### Approve / Reject (merchant)

- `POST /api/refunds/:refundId/approve`
- `POST /api/refunds/:refundId/reject` — body `{ "reason": "..." }`

### Process (merchant — record TX hash after sending funds)

`POST /api/refunds/:refundId/process` — supports `Idempotency-Key`.

Body: `{ "txHash": "0x..." }`. Flips the order to `REFUNDED`, fires the `refund.processed` webhook, and proportionally reverses the fee on your account.

### Get

`GET /api/refunds/:refundId` — includes the customer's wallet address (where to send refunded funds).

---

## Webhooks

Configure a webhook URL in dashboard → **Developer** tab. Must be HTTPS.

### Payload

```json
{
  "event": "order.confirmed",
  "timestamp": "2026-04-16T17:45:12.123Z",
  "data": { "orderId": "ord_...", "amount": 49.99, ... }
}
```

### Headers on delivery

- `X-StablePay-Signature` — HMAC-SHA256 hex of `"<timestamp>.<body>"` using your webhook secret.
- `X-StablePay-Timestamp` — same timestamp embedded in the payload.
- `X-StablePay-Idempotency-Key` — a unique id per event (stable across retries). **Dedupe on this key.**

### Verification (Node.js)

```js
import crypto from 'crypto';

function verify(rawBody, signature, timestamp, secret) {
  // Reject anything older than 5 minutes — defeats replay attacks
  if (Math.abs(Date.now() - Date.parse(timestamp)) > 5 * 60 * 1000) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

### Verification (Python)

```python
import hmac, hashlib, time
from datetime import datetime

def verify(raw_body, signature, timestamp, secret):
    ts = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp()
    if abs(time.time() - ts) > 300: return False
    expected = hmac.new(secret.encode(), f"{timestamp}.{raw_body}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

### Events

| Event | When |
|---|---|
| `order.created` | Order created, awaiting payment |
| `order.confirmed` | Payment confirmed on-chain after required confirmations |
| `order.expired` | Order timed out with no valid payment |
| `refund.requested` | Refund was requested |
| `refund.processed` | Refund completed, funds sent to customer |
| `invoice.created`, `invoice.sent`, `invoice.viewed`, `invoice.paid`, `invoice.overdue`, `invoice.cancelled` | Invoice lifecycle |
| `receipt.created`, `receipt.sent` | Receipt lifecycle |

### Retries

Failed deliveries retry with exponential backoff: 1min → 5min → 15min → 1h → 2h. After 5 attempts, delivery is abandoned. View and manually retry logs in dashboard → **Webhooks**.

---

## Receipts

- `GET /receipt/:orderId` — public HTML receipt page (accepts either `orderId` or `receiptId`).
- `GET /api/receipts/for-order/:orderId` — returns `{ receiptId }`; creates the receipt on-demand if the order is confirmed.
- `GET /api/receipts/:receiptId` — receipt JSON.
- `GET /api/receipts/:receiptId/pdf` — PDF download.
- `POST /api/receipts/for-order/:orderId/email` — public, rate-limited (3/hr per IP). Body `{ "email": "..." }`. Sends the receipt to the given email.
- `POST /api/receipts/:receiptId/resend` (merchant auth) — resend to the order's email on file or an override `{ "email": "..." }`.

---

## Error Format

All errors return JSON:

```json
{ "error": "Order has expired", "status": "EXPIRED" }
```

Common HTTP codes:

| Code | Meaning |
|---|---|
| 400 | Validation error |
| 401 | Missing or invalid auth |
| 403 | Auth valid but not allowed for this resource |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate TX hash) |
| 429 | Rate limited (`Retry-After` header) |
| 5xx | Server error; safe to retry with the same `Idempotency-Key` |
