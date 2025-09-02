# StablePay - Multi-Chain USDC Payment Platform 🚀

A modern Web3 payment platform that accepts USDC stablecoin payments on multiple blockchain networks. Features a complete e-commerce flow with product selection, wallet integration, and real-time payment processing.

## 🌟 Features

- **🛍️ Product Store**: Beautiful demo store with multiple products and pricing tiers
- **🔗 Multi-Chain Support**: Accept USDC on Base Sepolia and Ethereum Sepolia (testnet ready)
- **👛 Web3 Wallet Integration**: Seamless MetaMask connection and transaction signing
- **💰 Real-time Balance Display**: Check USDC balance across all supported chains
- **📱 Mobile Responsive**: Fully optimized for mobile, tablet, and desktop
- **🔍 Transaction Tracking**: Monitor payment status with blockchain explorers
- **🎨 Modern UI**: Gradient designs with smooth animations
- **🔒 Secure**: Environment-based configuration for sensitive data

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- MetaMask wallet browser extension
- Testnet ETH and USDC tokens

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/stablepay.git
cd stablepay

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Generate Prisma client
npx prisma generate

# Push database schema
npx prisma db push

# Start development server
npm run dev
```

### Access the Application

- 🛍️ **Store**: http://localhost:3000/public/store.html
- 💳 **Direct Payment**: http://localhost:3000/public/crypto-pay.html
- 🏥 **Health Check**: http://localhost:3000/api/health

## 📁 Project Structure

```
stablepay/
├── src/
│   ├── index.ts                 # Express server
│   ├── routes/
│   │   ├── orders.ts           # Order management API
│   │   └── refunds.ts          # Refund processing API
│   ├── services/
│   │   ├── orderService.ts     # Order business logic
│   │   ├── blockchainService.ts # Blockchain scanning
│   │   └── refundService.ts    # Refund logic
│   ├── config/
│   │   ├── database.ts         # Prisma client setup
│   │   └── chains.ts           # Blockchain configurations
│   └── types/
│       └── index.ts            # TypeScript definitions
├── public/
│   ├── store.html              # Product selection page
│   ├── crypto-pay.html         # Payment checkout page
│   └── pay.html                # Legacy payment interface
├── prisma/
│   └── schema.prisma           # Database schema
├── dashboard/                  # Next.js admin panel (optional)
└── package.json
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file with:

```env
# Database (Supabase PostgreSQL)
DATABASE_URL="postgresql://user:pass@host:port/db?pgbouncer=true"

# Server
PORT=3000
NODE_ENV=development

# Blockchain RPC URLs
BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
ETHEREUM_SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_KEY"

# USDC Contract Addresses
USDC_BASE_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
USDC_ETHEREUM_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"

# Payment Receiving Address
PAYMENT_ADDRESS_BASE_SEPOLIA="0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF"
PAYMENT_ADDRESS_ETHEREUM_SEPOLIA="0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF"

# Security
JWT_SECRET="your-secret-key"
ADMIN_PASSWORD="secure-password"
```

## 🧪 Getting Testnet Tokens

1. **Base Sepolia ETH**: 
   - https://faucet.quicknode.com/base/sepolia
   - https://www.alchemy.com/faucets/base-sepolia

2. **Ethereum Sepolia ETH**:
   - https://sepoliafaucet.com
   - https://www.alchemy.com/faucets/ethereum-sepolia

3. **USDC Testnet Tokens**:
   - https://faucet.circle.com/ (Select Base Sepolia or Ethereum Sepolia)

## 📱 Usage Flow

### Customer Experience

1. **Browse Products** 🛍️
   - Visit store page
   - Choose from 4 products (0.1, 0.25, 0.5, 1.0 USDC)

2. **Select Payment Method** 💳
   - Credit Card (coming soon)
   - Pay with Stablecoins (active)

3. **Connect Wallet** 👛
   - Click "Connect Wallet"
   - Approve MetaMask connection

4. **Complete Payment** ✅
   - Select payment chain
   - Confirm transaction
   - View on block explorer

### API Endpoints

```http
# Create Order
POST /api/orders
{
  "amount": 1.0,
  "chain": "BASE_SEPOLIA",
  "productId": "A",
  "productName": "Starter Package"
}

# Get Order
GET /api/orders/:orderId

# List Orders
GET /api/orders

# Create Refund
POST /api/refunds
{
  "orderId": "...",
  "reason": "Customer request"
}
```

## 🚢 Deployment Options

### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables in Vercel dashboard
```

### Railway

1. Connect GitHub repository
2. Add PostgreSQL database
3. Set environment variables
4. Deploy automatically

### Render

1. Create Web Service
2. Connect GitHub repo
3. Set build command: `npm run build`
4. Set start command: `npm start`

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## 🛠️ Development

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build TypeScript
npm start           # Start production server
npm run db:push     # Push schema to database
npm run db:studio   # Open Prisma Studio
```

### Testing Payments

1. Start local server: `npm run dev`
2. Open store: http://localhost:3000/public/store.html
3. Select product and pay with stablecoins
4. Connect wallet with testnet USDC
5. Complete transaction

## 🔒 Security Best Practices

- ✅ Never commit `.env` files
- ✅ Use environment variables for sensitive data
- ✅ Implement rate limiting on APIs
- ✅ Validate all user inputs
- ✅ Use HTTPS in production
- ✅ Regular dependency updates
- ✅ Monitor for suspicious transactions

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- [Ethers.js](https://ethers.org/) - Ethereum library
- [Prisma](https://www.prisma.io/) - Database ORM
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Supabase](https://supabase.com/) - Database hosting
- [Circle](https://www.circle.com/) - USDC infrastructure

## 📞 Support

- GitHub Issues: [Create an issue](https://github.com/yourusername/stablepay/issues)
- Email: support@stablepay.io

---

⚠️ **Important**: This is currently configured for TESTNET use only. Do not send real funds to these addresses.

🚀 **Live Demo**: Coming soon!

Built with ❤️ by the StablePay team