# StablePay - Multi-Chain USDC Payment Rail

A complete payment system for accepting USDC across multiple blockchain networks with automated transaction monitoring, order management, and refund processing.

## Features

- **Multi-Chain Support**: Accept USDC on Ethereum, Polygon, Arbitrum, Optimism, and Base
- **Automated Monitoring**: Real-time blockchain scanning for payment detection
- **Order Management**: Create, track, and manage payment orders
- **Refund System**: Configurable refund policies with approval workflow
- **Admin Dashboard**: Web interface for managing orders and processing refunds
- **Simple Customer Interface**: Easy payment order creation for end users

## Architecture

- **Backend**: Node.js/TypeScript with Express
- **Database**: PostgreSQL with Prisma ORM
- **Blockchain**: Ethers.js for multi-chain interaction
- **Frontend**: Next.js dashboard + vanilla HTML customer interface

## Quick Start

### 1. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Install dependencies
npm install

# Install dashboard dependencies
cd dashboard && npm install && cd ..
```

### 2. Configure Environment

Edit `.env` with your settings:

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/stablepay"

# RPC URLs (use Alchemy, Infura, or other providers)
ETHEREUM_RPC_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
POLYGON_RPC_URL="https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY"
# ... add other chains

# Your controlled wallet addresses for receiving payments
PAYMENT_ADDRESS_ETHEREUM="0x..."
PAYMENT_ADDRESS_POLYGON="0x..."
# ... add other chains

# USDC token contract addresses (already configured)
```

### 3. Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate
```

### 4. Start the Services

```bash
# Start the backend API (includes blockchain scanner)
npm run dev

# In another terminal, start the dashboard
cd dashboard && npm run dev
```

## API Endpoints

### Orders
- `POST /api/orders` - Create new payment order
- `GET /api/orders` - List all orders (paginated)  
- `GET /api/orders/:id` - Get order details
- `POST /api/orders/:id/confirm` - Manually confirm order

### Refunds
- `POST /api/refunds` - Create refund request
- `GET /api/refunds/pending` - Get pending refund approvals
- `GET /api/refunds/stats` - Get refund statistics
- `POST /api/refunds/:id/approve` - Approve refund
- `POST /api/refunds/:id/reject` - Reject refund

### System
- `GET /api/health` - Health check
- `GET /api/chains` - Supported chains list

## Usage Examples

### Create Payment Order

```javascript
const order = await fetch('/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amount: 100.00,
    chain: 'POLYGON',
    customerEmail: 'customer@example.com',
    expiryMinutes: 30
  })
});
```

### Request Refund

```javascript
const refund = await fetch('/api/refunds', {
  method: 'POST', 
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    orderId: 'order_id_here',
    amount: 50.00, // Optional: partial refund
    reason: 'Customer requested refund'
  })
});
```

## How It Works

1. **Order Creation**: Customer creates payment order specifying amount and chain
2. **Payment Instructions**: System provides payment address and exact USDC amount  
3. **Customer Payment**: Customer sends USDC from any wallet to provided address
4. **Blockchain Scanning**: System monitors chains every 30 seconds for incoming transfers
5. **Payment Detection**: Matches incoming transfers to pending orders by amount and address
6. **Order Confirmation**: Updates order status after sufficient confirmations
7. **Refund Processing**: Handles refund requests with configurable approval workflow

## Configuration

### Refund Policy (in `src/services/refundService.ts`)

```typescript
private policy: RefundPolicy = {
  maxRefundDays: 30,        // Maximum days to allow refunds
  allowPartialRefunds: true, // Allow partial amount refunds  
  requireApproval: true,     // Require manual approval
  autoRefundThreshold: 100,  // Auto-approve refunds under $100
};
```

### Chain Configuration

Each chain has configurable parameters in `src/config/chains.ts`:
- RPC URL
- USDC contract address  
- Payment receiving address
- Required confirmations
- Block time for scanning optimization

## Security Features

- Input validation with Zod schemas
- Helmet security headers
- CORS configuration
- Amount precision handling (6 decimals for USDC)
- Transaction hash uniqueness enforcement
- Expiration time limits on orders

## Monitoring & Maintenance

- Health check endpoint: `GET /api/health`
- Database migrations: `npm run db:migrate`
- Prisma Studio: `npm run db:studio` 
- Blockchain scanner logs payment detection events
- Admin dashboard provides real-time order/refund visibility

## Deployment Considerations

1. Use production database with connection pooling
2. Configure proper RPC provider rate limits  
3. Set up monitoring/alerting for failed blockchain scans
4. Implement proper wallet security for refund processing
5. Consider using environment-specific USDC addresses (testnet vs mainnet)

## Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality  
4. Submit pull request

## License

MIT License - see LICENSE file for details