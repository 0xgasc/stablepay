# StablePay Documentation

Welcome to StablePay! This documentation will help you integrate USDC payments into your website in minutes.

---

## 📚 Documentation Index

### **[Getting Started Guide](./GETTING_STARTED.md)** ⭐ START HERE
Complete setup guide from account creation to your first payment. Includes:
- What is StablePay
- 3-step quick start
- Testing on testnets
- Going live on mainnet
- Security best practices

**Time to integrate:** 5-10 minutes

---

### **[API Documentation](./API.md)**
Full technical reference for the StablePay API. Includes:
- All API endpoints with examples
- Request/response formats
- Authentication
- Supported chains & tokens
- Error codes
- Complete integration example

**For:** Developers building custom integrations

---

### **[Code Examples](./EXAMPLES.md)**
Ready-to-use code for popular frameworks:
- Vanilla JavaScript
- React (with custom hooks)
- Next.js (App Router)
- Vue 3 (Composition API)
- Svelte
- WordPress
- WooCommerce
- Shopify
- Node.js/Express

**For:** Quick copy-paste integration

---

### **[Troubleshooting Guide](./TROUBLESHOOTING.md)**
Solutions to common issues:
- Widget not appearing
- Wallet connection problems
- Transaction failures
- API errors
- Network issues
- Testing problems

**For:** When things don't work as expected

---

## 🚀 Quick Links

- **Dashboard:** [https://stablepay-nine.vercel.app/dashboard.html](https://stablepay-nine.vercel.app/dashboard.html)
- **Test Widget:** Go to Developer tab → Test Payment
- **Support:** support@stablepay.com

---

## 💡 Common Use Cases

### E-commerce Store
Want to accept crypto payments on your online store?
→ See [WooCommerce Example](./EXAMPLES.md#woocommerce)

### SaaS Subscription
Want to accept crypto for monthly subscriptions?
→ See [React Example](./EXAMPLES.md#react) + [API Docs](./API.md)

### WordPress Site
Want to add crypto payments to your WordPress site?
→ See [WordPress Example](./EXAMPLES.md#wordpress)

### Custom Checkout Flow
Want full control over the payment UX?
→ See [Custom Integration](./GETTING_STARTED.md#option-3-custom-integration-api)

---

## 🎯 Integration Paths

### Path 1: Embedded Widget (Easiest) ⭐

**Time:** 2 minutes
**Difficulty:** Beginner

```html
<script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>

<div class="stablepay-checkout"
     data-merchant="YOUR_MERCHANT_ID"
     data-amount="10.00"
     data-chain="BASE_MAINNET">
</div>
```

[Full Guide →](./GETTING_STARTED.md#option-1-embedded-widget-easiest)

---

### Path 2: Hosted Checkout (Simple)

**Time:** 5 minutes
**Difficulty:** Beginner

1. Create order via API
2. Redirect customer to StablePay checkout
3. Customer pays
4. Check order status

[Full Guide →](./GETTING_STARTED.md#option-2-hosted-checkout-redirect)

---

### Path 3: Custom API Integration (Advanced)

**Time:** 30-60 minutes
**Difficulty:** Intermediate

Build your own checkout UI with full control.

[Full Guide →](./API.md)

---

## 🔑 What You Need

1. **Merchant Account**
   - Sign up at [stablepay-nine.vercel.app](https://stablepay-nine.vercel.app)
   - Wait for approval (< 24 hours)

2. **Wallet Addresses**
   - Your Base wallet (e.g., `0x123...`)
   - Your Solana wallet (e.g., `9GW4...`)
   - Configure in dashboard → Wallets tab

3. **Merchant ID**
   - Get from dashboard → Developer tab
   - Format: `cmhkjckgi0000qut5wxmtsw1f`

That's it! No private keys, no smart contracts to deploy.

---

## 🧪 Testing

### Testnet Chains (Free tokens for testing)

**Base Sepolia:**
- Get testnet ETH (for gas): [Alchemy Faucet](https://www.alchemy.com/faucets/base-sepolia)
- Get testnet USDC: [Circle Faucet](https://faucet.circle.com/)
- Widget code: `data-chain="BASE_SEPOLIA"`

**Solana Devnet:**
- Get testnet SOL: `solana airdrop 2`
- Get testnet USDC: [SPL Token Faucet](https://spl-token-faucet.com/)
- Widget code: `data-chain="SOLANA_DEVNET"`

[Full Testing Guide →](./GETTING_STARTED.md#testing-your-integration)

---

## 🌐 Supported Chains

| Chain | Mainnet | Testnet | Status |
|-------|---------|---------|--------|
| **Base** | BASE_MAINNET | BASE_SEPOLIA | ✅ Live |
| **Solana** | SOLANA_MAINNET | SOLANA_DEVNET | ✅ Live |
| Ethereum | ETH_MAINNET | ETH_SEPOLIA | 🔜 Soon |
| Polygon | POLYGON_MAINNET | POLYGON_MUMBAI | 🔜 Soon |
| Arbitrum | ARBITRUM_MAINNET | ARBITRUM_SEPOLIA | 🔜 Soon |

---

## 💰 Supported Tokens

| Token | Chains | Status |
|-------|--------|--------|
| **USDC** | Base, Solana | ✅ Live |
| USDT | Base, Ethereum, Solana | 🔜 Soon |
| EURC | Base, Ethereum | 🔜 Soon |

---

## ❓ FAQs

**Q: Do I need to write smart contracts?**
A: No! StablePay handles all blockchain interactions. Just add our widget.

**Q: Where do payments go?**
A: Directly to YOUR wallet addresses. StablePay never holds your funds.

**Q: What about gas fees?**
A: Customers pay gas fees (very low on Base/Solana). You receive the full USDC amount.

**Q: Can I accept other cryptocurrencies?**
A: Currently USDC only. Other stablecoins coming soon.

**Q: What if a transaction fails?**
A: Orders expire after 1 hour. Customer can retry or you can issue a refund.

**Q: Do you support refunds?**
A: Yes! Refund system available in dashboard. [Learn more →](./GETTING_STARTED.md)

[More FAQs →](./TROUBLESHOOTING.md)

---

## 📞 Support

**Email:** support@stablepay.com
**Response Time:** Usually within 24 hours

**Before contacting support:**
1. Check [Troubleshooting Guide](./TROUBLESHOOTING.md)
2. Verify credentials (merchant ID, wallet addresses)
3. Test on testnet first

**Include in your message:**
- Error message (screenshot)
- Order ID or transaction hash
- Steps to reproduce

---

## 🔐 Security

- ✅ Your wallet private keys stay with you
- ✅ Payments go directly to your wallets
- ✅ Open-source wallet integrations (MetaMask, Phantom)
- ✅ No StablePay custody of funds
- ✅ Blockchain-verified transactions

[Security Best Practices →](./GETTING_STARTED.md#security-best-practices)

---

## 🎓 Learning Resources

### Video Tutorials (Coming Soon)
- Setting up your first payment
- Testing on testnets
- Going live on mainnet

### Blog Posts
- Why accept crypto payments?
- USDC vs traditional payments
- Multi-chain payment strategies

---

## 🗺️ Roadmap

**Q1 2025:**
- ✅ Base + Solana support
- ✅ USDC payments
- 🔜 Webhooks
- 🔜 Multi-token support (USDT, EURC)

**Q2 2025:**
- Ethereum, Polygon, Arbitrum support
- Subscription payments
- Invoice system
- Mobile SDK

**Q3 2025:**
- Fiat on/off ramps
- Payment analytics dashboard
- Dispute resolution

---

## 📄 License

StablePay is proprietary software. Contact us for licensing inquiries.

---

**Ready to get started?** → [Getting Started Guide](./GETTING_STARTED.md)

**Need help?** → support@stablepay.com

**Happy Building!** 🚀
