import Anthropic from '@anthropic-ai/sdk';
import { ethers } from 'ethers';
import { db } from '../config/database';
import { logger } from '../utils/logger';

// ─── Agent wallet + chain RPC config ────────────────────────────────────────
const AGENT_WALLET_KEY = process.env.AGENT_WALLET_KEY;
const AGENT_WALLET_ADDRESS = process.env.AGENT_WALLET_ADDRESS;

const CHAIN_RPC: Record<string, { rpc: string; usdc: string }> = {
  BASE_SEPOLIA: { rpc: 'https://sepolia.base.org', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  BASE_MAINNET: { rpc: 'https://mainnet.base.org', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  ETHEREUM_SEPOLIA: { rpc: 'https://eth-sepolia.g.alchemy.com/v2/demo', usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  ETHEREUM_MAINNET: { rpc: 'https://eth.llamarpc.com', usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  POLYGON_MAINNET: { rpc: 'https://polygon-rpc.com', usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
};

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function transfer(address, uint256) returns (bool)'];

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ─── Tool definitions for Claude ────────────────────────────────────────────
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_setup_status',
    description: 'Get the current setup status of the merchant — wallets, plan, chains, tokens, and whether setup is complete. Call this at the start of a conversation or when you need to check what has been configured.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'add_wallet',
    description: 'Add or update a wallet for a specific blockchain chain. This saves the wallet address and which stablecoins the merchant wants to accept on that chain.',
    input_schema: {
      type: 'object' as const,
      properties: {
        chain: {
          type: 'string',
          enum: ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'SOLANA_MAINNET'],
          description: 'The blockchain to configure',
        },
        address: { type: 'string', description: 'The wallet address (0x... for EVM, base58 for Solana)' },
        supportedTokens: {
          type: 'array',
          items: { type: 'string', enum: ['USDC', 'USDT', 'EURC'] },
          description: 'Which stablecoins to accept on this chain. Defaults to ["USDC"]. Available: Base=USDC/EURC, Ethereum=USDC/USDT/EURC, Polygon=USDC/USDT, Arbitrum=USDC/USDT, Solana=USDC/USDT, Testnets=USDC only.',
        },
      },
      required: ['chain', 'address'],
    },
  },
  {
    name: 'update_profile',
    description: 'Update merchant profile fields like company name, network mode (TESTNET/MAINNET), or payment mode.',
    input_schema: {
      type: 'object' as const,
      properties: {
        companyName: { type: 'string', description: 'New company name' },
        networkMode: { type: 'string', enum: ['TESTNET', 'MAINNET'], description: 'Switch between testnet and mainnet' },
        contactName: { type: 'string', description: 'Contact person name' },
      },
      required: [],
    },
  },
  {
    name: 'complete_setup',
    description: 'Mark the merchant setup as complete. Only call this AFTER at least one wallet has been configured. This dismisses the setup wizard.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_widget_code',
    description: 'Generate an embeddable "Pay with Crypto" button + checkout widget code. Only amount is needed (or omit for dynamic pricing). Product name, chains, tokens are all optional.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Fixed payment amount. Omit for dynamic/variable pricing.' },
        productName: { type: 'string', description: 'Product or service name shown at checkout' },
        chains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Which chains to allow. E.g. ["BASE_MAINNET","ETHEREUM_MAINNET"]. Omit to allow all configured chains.',
        },
        tokens: {
          type: 'array',
          items: { type: 'string' },
          description: 'Which tokens to allow. E.g. ["USDC","USDT"]. Omit to allow all configured tokens.',
        },
        buttonStyle: {
          type: 'string',
          enum: ['default', 'minimal', 'custom'],
          description: 'Button style: default (styled Pay with Crypto button), minimal (just the script, merchant styles their own button), custom (inline checkout, no button).',
        },
        customerEmail: { type: 'string', description: 'Pre-fill customer email if known (optional)' },
      },
      required: [],
    },
  },
  {
    name: 'generate_checkout_link',
    description: 'Generate a shareable direct checkout link (URL) that the merchant can send to customers via email, WhatsApp, social media, etc. No code needed — just a link. Supports multiple allowed chains and tokens so the customer can choose at checkout. Can create multiple links for different products/prices.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Payment amount in USD' },
        productName: { type: 'string', description: 'What the payment is for' },
        chains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Allowed chains. E.g. ["BASE_MAINNET","ETHEREUM_MAINNET"]. Omit to allow all merchant-configured chains. Customer picks at checkout.',
        },
        tokens: {
          type: 'array',
          items: { type: 'string' },
          description: 'Allowed tokens. E.g. ["USDC","USDT"]. Omit to allow all. Customer picks at checkout.',
        },
        customerEmail: { type: 'string', description: 'Pre-fill customer email (optional)' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'save_memory',
    description: 'Save a piece of information about this merchant for future conversations. Use this to remember preferences, business context, tech stack, past issues, etc. Keys should be descriptive like "preferred_chain", "business_type", "tech_stack", "integration_notes".',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'A descriptive key for this memory (snake_case)' },
        value: { type: 'string', description: 'The information to remember' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'recall_memories',
    description: 'Recall all saved memories about this merchant. Use this at the start of conversations to personalize your responses and remember past context.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'check_my_balance',
    description: 'Check the agent\'s own wallet USDC balance on a given chain. Use this when asked about your balance or when considering sending a transaction.',
    input_schema: {
      type: 'object' as const,
      properties: {
        chain: {
          type: 'string',
          enum: ['BASE_SEPOLIA', 'BASE_MAINNET', 'ETHEREUM_MAINNET', 'ETHEREUM_SEPOLIA', 'POLYGON_MAINNET'],
          description: 'Chain to check balance on',
        },
      },
      required: ['chain'],
    },
  },
  {
    name: 'send_usdc',
    description: 'Send USDC from the agent\'s wallet to an address. Max $50 per transaction. Use sparingly and only when the merchant asks or there is a clear reason.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient address (0x...)' },
        amount: { type: 'number', description: 'Amount in USDC (max 50)' },
        chain: {
          type: 'string',
          enum: ['BASE_SEPOLIA', 'BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET'],
          description: 'Chain to send on',
        },
      },
      required: ['to', 'amount', 'chain'],
    },
  },
  {
    name: 'get_my_wallet',
    description: 'Get the agent\'s own wallet address. Share this when someone asks where to send tips or wants to know the agent\'s address.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
];

// ─── Tool execution ─────────────────────────────────────────────────────────
async function executeTool(merchantId: string, toolName: string, input: any): Promise<string> {
  switch (toolName) {
    case 'get_setup_status': {
      const m = await db.merchant.findUnique({
        where: { id: merchantId },
        include: { wallets: true, _count: { select: { orders: true } } },
      });
      if (!m) return JSON.stringify({ error: 'Merchant not found' });
      return JSON.stringify({
        companyName: m.companyName,
        contactName: m.contactName,
        email: m.email,
        plan: m.plan,
        networkMode: m.networkMode,
        setupCompleted: m.setupCompleted,
        orderCount: m._count.orders,
        wallets: m.wallets.map(w => ({
          chain: w.chain,
          address: w.address,
          tokens: w.supportedTokens,
          active: w.isActive,
        })),
      });
    }

    case 'add_wallet': {
      const { chain, address, supportedTokens } = input;
      const tokens = supportedTokens || ['USDC'];

      // Validate address format
      const isSolana = chain.startsWith('SOLANA');
      if (isSolana && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        return JSON.stringify({ error: 'Invalid Solana address. Must be base58 encoded, 32-44 characters.' });
      }
      if (!isSolana && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return JSON.stringify({ error: 'Invalid EVM address. Must start with 0x followed by 40 hex characters.' });
      }

      // Upsert wallet
      await db.merchantWallet.upsert({
        where: { merchantId_chain: { merchantId, chain } },
        update: { address, supportedTokens: tokens, isActive: true },
        create: { merchantId, chain, address, supportedTokens: tokens, isActive: true },
      });

      // Auto-switch to MAINNET mode when a mainnet wallet is added
      const isMainnet = chain.includes('MAINNET');
      if (isMainnet) {
        await db.merchant.update({
          where: { id: merchantId },
          data: { networkMode: 'MAINNET' },
        });
      }

      return JSON.stringify({ success: true, chain, address, tokens, message: `Wallet configured for ${chain} accepting ${tokens.join(', ')}${isMainnet ? '. Network mode set to MAINNET.' : ''}` });
    }

    case 'update_profile': {
      const data: any = {};
      if (input.companyName) data.companyName = input.companyName;
      if (input.contactName) data.contactName = input.contactName;
      if (input.networkMode) data.networkMode = input.networkMode;

      if (Object.keys(data).length === 0) {
        return JSON.stringify({ error: 'No fields to update' });
      }

      const updated = await db.merchant.update({ where: { id: merchantId }, data });
      return JSON.stringify({ success: true, updated: Object.keys(data), message: `Profile updated: ${Object.keys(data).join(', ')}` });
    }

    case 'complete_setup': {
      const walletCount = await db.merchantWallet.count({ where: { merchantId } });
      if (walletCount === 0) {
        return JSON.stringify({ error: 'Cannot complete setup — no wallets configured yet. Add at least one wallet first.' });
      }
      await db.merchant.update({ where: { id: merchantId }, data: { setupCompleted: true } });
      return JSON.stringify({ success: true, message: 'Setup marked as complete! The dashboard is now fully accessible.' });
    }

    case 'get_widget_code': {
      const m = await db.merchant.findUnique({
        where: { id: merchantId },
        include: { wallets: true },
      });

      if (!m?.wallets?.length) {
        return JSON.stringify({ error: 'No wallets configured yet. Add at least one wallet first.' });
      }

      const style = input.buttonStyle || 'default';
      const configParams: string[] = [`merchantId: '${merchantId}'`];

      if (input.amount) configParams.push(`amount: ${input.amount}`);
      if (input.productName) configParams.push(`productName: '${input.productName}'`);
      if (input.customerEmail) configParams.push(`customerEmail: '${input.customerEmail}'`);
      if (input.chains?.length) configParams.push(`allowedChains: ${JSON.stringify(input.chains)}`);
      if (input.tokens?.length) configParams.push(`allowedTokens: ${JSON.stringify(input.tokens)}`);
      configParams.push(`onSuccess: (data) => {\n      // Payment confirmed! data contains orderId, txHash, amount\n      console.log('Payment confirmed!', data);\n      // Redirect or show confirmation\n    }`);
      configParams.push(`onCancel: () => {\n      console.log('Payment cancelled');\n    }`);

      const paramsStr = configParams.join(',\n    ');

      let code: string;
      if (style === 'minimal') {
        code = `<!-- Add this script to your page -->\n<script src="https://wetakestables.shop/checkout-widget.js"></script>\n\n<!-- Call this from your own button/link -->\n<script>\nfunction openPayment() {\n  StablePay.checkout({\n    ${paramsStr}\n  });\n}\n</script>`;
      } else if (style === 'custom') {
        code = `<!-- Inline checkout (no button — opens immediately) -->\n<script src="https://wetakestables.shop/checkout-widget.js"></script>\n<script>\nStablePay.checkout({\n  ${paramsStr}\n});\n</script>`;
      } else {
        code = `<!-- Pay with Crypto button -->\n<script src="https://wetakestables.shop/checkout-widget.js"></script>\n<button onclick="StablePay.checkout({\n  ${paramsStr}\n})" style="background:#000;color:#fff;padding:12px 24px;font-weight:bold;font-size:14px;border:2px solid #000;cursor:pointer;font-family:sans-serif;">Pay with Crypto</button>`;
      }

      const configuredChains = m.wallets.filter(w => w.isActive).map(w => w.chain);
      return JSON.stringify({
        success: true,
        code,
        configuredChains,
        note: input.chains
          ? `Checkout restricted to: ${input.chains.join(', ')}`
          : `Checkout will show all configured chains: ${configuredChains.join(', ')}`,
      });
    }

    case 'generate_checkout_link': {
      const params = new URLSearchParams();
      params.set('merchantId', merchantId);
      params.set('amount', input.amount.toString());
      if (input.productName) params.set('productName', input.productName);
      if (input.chains?.length) params.set('chains', input.chains.join(','));
      if (input.tokens?.length) params.set('tokens', input.tokens.join(','));
      if (input.customerEmail) params.set('customerEmail', input.customerEmail);

      const link = `https://wetakestables.shop/crypto-pay.html?${params.toString()}`;

      const chainsNote = input.chains?.length
        ? `Allowed chains: ${input.chains.join(', ')}`
        : 'Customer can choose any chain you have configured';
      const tokensNote = input.tokens?.length
        ? `Allowed tokens: ${input.tokens.join(', ')}`
        : 'Customer can choose any token available on the selected chain';

      return JSON.stringify({
        success: true,
        link,
        amount: input.amount,
        productName: input.productName || null,
        chains: chainsNote,
        tokens: tokensNote,
        note: 'Share this link anywhere — WhatsApp, email, social media, QR code. Customer clicks, picks their chain/token, and pays.',
      });
    }

    case 'save_memory': {
      const { key, value } = input;
      await db.agentMemory.upsert({
        where: { merchantId_key: { merchantId, key } },
        update: { value },
        create: { merchantId, key, value },
      });
      return JSON.stringify({ success: true, message: `Remembered: ${key}` });
    }

    case 'recall_memories': {
      const memories = await db.agentMemory.findMany({
        where: { merchantId },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      });
      if (memories.length === 0) {
        return JSON.stringify({ memories: [], message: 'No saved memories for this merchant yet.' });
      }
      return JSON.stringify({
        memories: memories.map(m => ({ key: m.key, value: m.value, updated: m.updatedAt })),
      });
    }

    case 'check_my_balance': {
      if (!AGENT_WALLET_ADDRESS) return JSON.stringify({ error: 'Agent wallet not configured' });
      const chainConf = CHAIN_RPC[input.chain];
      if (!chainConf) return JSON.stringify({ error: `Unsupported chain: ${input.chain}` });

      try {
        const provider = new ethers.JsonRpcProvider(chainConf.rpc);
        const usdc = new ethers.Contract(chainConf.usdc, ERC20_ABI, provider);
        const balance = await usdc.balanceOf(AGENT_WALLET_ADDRESS);
        const formatted = ethers.formatUnits(balance, 6);
        return JSON.stringify({ address: AGENT_WALLET_ADDRESS, chain: input.chain, usdc_balance: formatted });
      } catch (err: any) {
        return JSON.stringify({ error: `Failed to check balance: ${err.message}` });
      }
    }

    case 'send_usdc': {
      if (!AGENT_WALLET_KEY) return JSON.stringify({ error: 'Agent wallet not configured' });
      const { to, amount, chain } = input;

      if (amount > 50) return JSON.stringify({ error: 'Max $50 per transaction. Nice try though.' });
      if (amount <= 0) return JSON.stringify({ error: 'Amount must be positive' });
      if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return JSON.stringify({ error: 'Invalid address' });

      const chainConf = CHAIN_RPC[chain];
      if (!chainConf) return JSON.stringify({ error: `Unsupported chain: ${chain}` });

      try {
        const provider = new ethers.JsonRpcProvider(chainConf.rpc);
        const wallet = new ethers.Wallet(AGENT_WALLET_KEY, provider);
        const usdc = new ethers.Contract(chainConf.usdc, ERC20_ABI, wallet);
        const amountRaw = ethers.parseUnits(amount.toString(), 6);
        const tx = await usdc.transfer(to, amountRaw);
        return JSON.stringify({ success: true, txHash: tx.hash, amount, to, chain, message: `Sent $${amount} USDC to ${to.slice(0, 8)}...` });
      } catch (err: any) {
        return JSON.stringify({ error: `Transaction failed: ${err.message}` });
      }
    }

    case 'get_my_wallet': {
      return JSON.stringify({
        address: AGENT_WALLET_ADDRESS || 'Not configured',
        message: AGENT_WALLET_ADDRESS
          ? `My wallet address is ${AGENT_WALLET_ADDRESS}. You can send tips here on any EVM chain (Base, Ethereum, Polygon, Arbitrum).`
          : 'Agent wallet not configured yet.',
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ─── System prompt ──────────────────────────────────────────────────────────
function buildSystemPrompt(merchant: any): string {
  return `You are the WeTakeStables assistant — a friendly, thorough guide that helps merchants accept stablecoin payments. You work for wetakestables.shop.

## Your Personality
- Patient and clear. Many merchants are NOT crypto-native. Never assume knowledge.
- Explain concepts simply when needed: "A stablecoin is a cryptocurrency that stays at $1 — like a digital dollar."
- Take ACTION with your tools. Don't just give instructions — actually configure things.
- Ask ONE question at a time. Never dump a wall of options.
- Celebrate progress. Be warm.
- Keep responses under 150 words unless showing code.

## Onboarding Decision Tree

At the START of every new conversation, call get_setup_status AND recall_memories.

### Step 1: Assess their level
Ask: "Before we dive in — how familiar are you with crypto wallets?" Then branch:

**Level 0 — "What's a wallet?"**
- Explain simply: "A crypto wallet is like a bank account for digital money. You'll need one to receive payments. The most popular is MetaMask — it's a free browser extension."
- Walk them through: download MetaMask → create wallet → copy their address
- Explain: "Your wallet address is like your bank account number — safe to share. Your private key/seed phrase is like your password — NEVER share it."
- Once they have an address, continue to Step 2

**Level 1 — "I have a wallet but I'm new to this"**
- Ask for their wallet address
- Explain what stablecoins are if needed
- Recommend simple setup: Base chain + USDC only (cheapest, fastest)
- Continue to Step 2

**Level 2 — "I know crypto, let's go"**
- Ask which chains and tokens they want
- Skip explanations, move fast
- Continue to Step 2

### Step 2: Wallet Setup
- Ask for their EVM wallet address (works on Base, Ethereum, Polygon, Arbitrum — explain this)
- If they also want Solana, they'll need a separate Solana wallet address
- Ask which stablecoins to accept per chain:
  - **USDC** — most popular, backed by Circle, available everywhere. Recommend this for everyone.
  - **USDT** — highest trading volume, by Tether. Good for high-volume merchants.
  - **EURC** — Euro stablecoin by Circle. Great if they have European customers.
- Use add_wallet for each chain they want. Confirm each one.
- For beginners: just set up Base + USDC. They can add more later.

### Step 3: Integration
Ask: "Do you have a website or app where customers check out, or do you need simple payment links?"

**Option A: "I have a site/app with a checkout" (THIS IS THE MAIN USE CASE)**
We are a payment gateway — like Stripe but for stablecoins. Our job is to plug into their existing checkout so every transaction flows through us automatically.

1. Ask: "What's your site built with?" (React, Next.js, Shopify, WordPress, plain HTML, Python backend, etc.)
2. Then WRITE INTEGRATION CODE that:
   - Reads the cart total / order amount from THEIR system at checkout time
   - Passes it dynamically to our widget or API
   - Handles the payment confirmation callback
   - Updates their order status

**The code you write should hook into their checkout, not be a standalone button for one product.**

Framework-specific integration:

**React/Next.js**:
- Write a <CryptoCheckout> component that takes amount as a prop
- Load the widget script in useEffect
- onClick calls StablePay.checkout({ merchantId, amount: props.amount })
- onSuccess callback updates their order state / calls their API
- Show how to use it: <CryptoCheckout amount={cart.total} onPaid={handlePayment} />

**Shopify**:
- Liquid snippet that reads {{ cart.total_price | money_without_currency }}
- Adds "Pay with Crypto" as additional payment method
- On success, redirects to Shopify's order confirmation

**WordPress/WooCommerce**:
- JS that reads the WooCommerce cart total from the checkout page
- Adds crypto payment option alongside existing gateways
- On success, marks WooCommerce order as paid

**Plain HTML/JS**:
- Show how to read amount from their page (input field, data attribute, or JS variable)
- Wire it to StablePay.checkout() dynamically
- Example: amount = document.getElementById('total').textContent

**API/Backend (Node, Python, PHP)**:
- Server-to-server: POST /api/embed/checkout with { merchantId, amount, customerEmail }
- Returns { orderId, paymentAddress, expiresAt }
- Redirect customer to payment page or embed inline
- Set up webhook to receive payment confirmation at their endpoint

**The key insight**: the amount comes from THEIR system every time. We don't hardcode prices. We process whatever they send us at checkout time.

**Option B: "I just need payment links" (simple use case)**
- For WhatsApp, Instagram, email, invoicing
- Use generate_checkout_link with the amount
- Customer clicks, picks chain/token, pays
- Good for freelancers, small sellers, one-off payments

**Option C: "I'm not sure"**
- Ask: "Do customers buy from your website, or do you send them a link to pay?"
- Website → Option A. Links → Option B.

### Step 4: Complete Setup
- Once at least one wallet is configured, use complete_setup
- Summarize what was set up
- Remind them: "Payments go directly to your wallet. We never hold your money. We just charge a small fee that gets invoiced separately."
- Remind them about webhooks if they did API integration: "Set up a webhook URL in Settings to get notified when payments confirm."

## For Returning Merchants
- Check status and memories first
- Help with: adding chains/tokens, writing integration code, API questions, webhooks, troubleshooting, billing
- If they share code or describe their checkout, write integration code that hooks into it
- Be a knowledgeable support agent and developer assistant

## Stablecoins by Chain (mainnet only)
- Base: USDC, EURC
- Ethereum: USDC, USDT, EURC
- Polygon: USDC, USDT
- Arbitrum: USDC, USDT
- Solana: USDC, USDT

## Pricing (volume-based, no subscriptions)
- Under $10k/month: 1.0% per transaction
- $10k-$50k/month: 0.8%
- $50k-$250k/month: 0.5%
- $250k+/month: 0.3%
- Merchants get 100% of payments upfront. Fees accumulate and are invoiced per billing cycle.

## What We Actually Need (keep it simple!)
Our service is simple: route stablecoin payments to merchant wallets.
- **Required**: merchant wallet address + amount
- **Optional**: product name, customer email, specific chain/token restrictions
- Don't over-ask. Get the wallet set up, generate the link/code, done.
- The checkout page handles chain/token selection for the customer.
- Product names, descriptions, branding — nice to have, not needed to start accepting payments.

## Key Explanations for Non-Crypto Users
If they ask "what is...":
- **Stablecoin**: "Digital dollar. 1 USDC = $1, always. It's cryptocurrency but without the price swings."
- **Blockchain/Chain**: "The network the payment travels on. Like choosing between FedEx and UPS — different speeds and costs, same package arrives."
- **Gas fees**: "A tiny network fee (usually cents) the customer pays to send the transaction. Not charged by us."
- **Wallet address**: "Like a bank account number for crypto. Safe to share. Starts with 0x for most chains."

## Memory
- Save important context: business type, country, tech stack, crypto experience level, preferred chains, notes
- Recall at conversation start to personalize

## Your Wallet
- Address: ${process.env.AGENT_WALLET_ADDRESS || 'not configured'}
- You can check your balance and send USDC (max $50/tx)
- Tips go to your wallet. Be grateful when tipped but never ask.

## Rules
- ALWAYS use mainnet chains. Never suggest testnets.
- Validate wallet addresses before calling add_wallet.
- EVM: 0x + 40 hex chars. Solana: 32-44 base58 chars.
- Don't ask for info you can get from tools.
- If someone seems lost, slow down. Better to take 5 messages and get it right than rush and confuse them.`;
}

// ─── Main chat with tool use loop ───────────────────────────────────────────
class AgentService {
  async chat(merchantId: string, userMessage: string): Promise<string> {
    if (!anthropic) {
      return 'The AI assistant is not configured. Please set the ANTHROPIC_API_KEY environment variable.';
    }

    try {
      const merchant = await db.merchant.findUnique({
        where: { id: merchantId },
        include: { wallets: true, _count: { select: { orders: true } } },
      });

      if (!merchant) return 'Merchant not found.';

      // Load conversation history
      const history = await db.chatMessage.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });

      const messages: Anthropic.MessageParam[] = history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      messages.push({ role: 'user', content: userMessage });

      // Tool use loop — keep calling Claude until we get a final text response
      let finalText = '';
      let loopMessages = [...messages];
      let iterations = 0;
      const MAX_ITERATIONS = 5;

      while (iterations < MAX_ITERATIONS) {
        iterations++;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: buildSystemPrompt(merchant),
          messages: loopMessages,
          tools: TOOLS,
        });

        // Collect text and tool use blocks
        const textParts: string[] = [];
        const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

        for (const block of response.content) {
          if (block.type === 'text') textParts.push(block.text);
          if (block.type === 'tool_use') toolUseBlocks.push(block);
        }

        // If no tool calls, we're done
        if (toolUseBlocks.length === 0) {
          finalText = textParts.join('');
          break;
        }

        // Execute tool calls and add results
        loopMessages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolUse of toolUseBlocks) {
          const result = await executeTool(merchantId, toolUse.name, toolUse.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result,
          });
        }

        loopMessages.push({ role: 'user', content: toolResults });

        // If there was text alongside tool calls, accumulate it
        if (textParts.length > 0) {
          finalText += textParts.join('');
        }

        // If Claude signaled stop, break
        if (response.stop_reason === 'end_turn' && toolUseBlocks.length === 0) {
          break;
        }
      }

      // Save messages to DB
      await db.chatMessage.createMany({
        data: [
          { merchantId, role: 'user', content: userMessage },
          { merchantId, role: 'assistant', content: finalText },
        ],
      });

      return finalText;
    } catch (error) {
      logger.error('Agent chat error', error as Error, { merchantId });
      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  async getHistory(merchantId: string, limit = 50) {
    return db.chatMessage.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, role: true, content: true, createdAt: true },
    });
  }

  async clearHistory(merchantId: string) {
    return db.chatMessage.deleteMany({ where: { merchantId } });
  }
}

export const agentService = new AgentService();
