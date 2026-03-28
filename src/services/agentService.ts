import Anthropic from '@anthropic-ai/sdk';
import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import { db } from '../config/database';
import { logger } from '../utils/logger';

// ─── Encryption for managed wallet keys ─────────────────────────────────────
const ENCRYPTION_KEY = process.env.JWT_SECRET || process.env.AGENT_WALLET_KEY || 'default-key-change-me';

function encryptKey(privateKey: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptKey(encrypted: string): string {
  const [ivHex, encData] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

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
          description: 'Which stablecoins to accept on this chain. Defaults to ["USDC"]. Available: Base=USDC/EURC, Ethereum=USDC/USDT/EURC, Polygon=USDC/USDT, Arbitrum=USDC/USDT, Solana=USDC/USDT.',
        },
        priority: {
          type: 'number',
          description: 'Display order in checkout. Lower = shown first. 0 = top priority. Ask the merchant which chain they want as default.',
        },
      },
      required: ['chain', 'address'],
    },
  },
  {
    name: 'set_chain_priority',
    description: 'Reorder which chains appear first in the customer checkout. Pass an array of chains in desired order — first = default/top.',
    input_schema: {
      type: 'object' as const,
      properties: {
        chainOrder: {
          type: 'array',
          items: { type: 'string' },
          description: 'Chains in priority order. E.g. ["BASE_MAINNET", "ETHEREUM_MAINNET", "POLYGON_MAINNET"]. First = shown first to customers.',
        },
      },
      required: ['chainOrder'],
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
    name: 'get_onboarding_progress',
    description: 'Get a checklist of the merchant\'s onboarding progress. Shows what\'s done and what\'s remaining. Call this to understand where they are and what to guide them through next.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'configure_settings',
    description: 'Set up webhook URL, success redirect URL, cancel redirect URL, or toggle webhook events. Use this when the merchant provides these URLs during integration setup.',
    input_schema: {
      type: 'object' as const,
      properties: {
        webhookUrl: { type: 'string', description: 'HTTPS URL where we POST payment confirmations (e.g. https://their-site.com/api/webhooks/stablepay)' },
        successUrl: { type: 'string', description: 'URL where customer is redirected after successful payment' },
        cancelUrl: { type: 'string', description: 'URL where customer goes if they cancel payment' },
        webhookEnabled: { type: 'boolean', description: 'Enable/disable webhook delivery' },
      },
      required: [],
    },
  },
  {
    name: 'create_managed_wallet',
    description: 'Create a managed wallet for a merchant who doesn\'t have their own crypto wallet yet. We generate and hold the keys for them. Always urge them to set up their own wallet ASAP for security. This is a temporary convenience — not a long-term solution.',
    input_schema: {
      type: 'object' as const,
      properties: {
        chains: {
          type: 'array',
          items: { type: 'string', enum: ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'SOLANA_MAINNET'] },
          description: 'Which chains to create managed wallets for. One EVM key works on all EVM chains. Solana gets a separate keypair automatically.',
        },
        tokens: {
          type: 'array',
          items: { type: 'string', enum: ['USDC', 'USDT', 'EURC'] },
          description: 'Which tokens to accept on each chain. Defaults to ["USDC"].',
        },
      },
      required: ['chains'],
    },
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
  {
    name: 'withdraw_managed_wallet',
    description: 'Withdraw funds from a merchant\'s managed wallet to an external address. Use when a merchant with a managed wallet wants to move their funds out. Requires the destination address, amount, chain, and token.',
    input_schema: {
      type: 'object' as const,
      properties: {
        toAddress: { type: 'string', description: 'Destination wallet address (0x... for EVM)' },
        amount: { type: 'number', description: 'Amount to withdraw' },
        chain: { type: 'string', enum: ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET'], description: 'Chain to withdraw on' },
        token: { type: 'string', enum: ['USDC', 'USDT', 'EURC'], description: 'Token to withdraw. Defaults to USDC.' },
      },
      required: ['toAddress', 'amount', 'chain'],
    },
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
        wallets: m.wallets.sort((a, b) => a.priority - b.priority).map(w => ({
          chain: w.chain,
          address: w.address,
          tokens: w.supportedTokens,
          active: w.isActive,
          priority: w.priority,
        })),
      });
    }

    case 'add_wallet': {
      const { chain, address, supportedTokens, priority } = input;
      const tokens = supportedTokens || ['USDC'];

      // Validate address format
      const isSolana = chain.startsWith('SOLANA');
      if (isSolana && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
        return JSON.stringify({ error: 'Invalid Solana address. Must be base58 encoded, 32-44 characters.' });
      }
      if (!isSolana && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return JSON.stringify({ error: 'Invalid EVM address. Must start with 0x followed by 40 hex characters.' });
      }

      // Upsert wallet with priority
      await db.merchantWallet.upsert({
        where: { merchantId_chain: { merchantId, chain } },
        update: { address, supportedTokens: tokens, isActive: true, ...(typeof priority === 'number' && { priority }) },
        create: { merchantId, chain, address, supportedTokens: tokens, isActive: true, priority: priority ?? 0 },
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

    case 'create_managed_wallet': {
      const { chains, tokens } = input;
      const supportedTokens = tokens || ['USDC'];

      // Check if they already have managed wallets
      const existing = await db.managedWallet.findMany({ where: { merchantId } });
      if (existing.length > 0) {
        return JSON.stringify({
          error: 'Managed wallets already exist for this merchant.',
          wallets: existing.map(w => ({ chain: w.chain, address: w.address })),
        });
      }

      const evmChains = chains.filter((c: string) => !c.startsWith('SOLANA'));
      const solanaChains = chains.filter((c: string) => c.startsWith('SOLANA'));

      const results: { chain: string; address: string }[] = [];

      // Generate ONE EVM wallet (works on all EVM chains)
      if (evmChains.length > 0) {
        const evmWallet = ethers.Wallet.createRandom();
        const encrypted = encryptKey(evmWallet.privateKey);

        for (const chain of evmChains) {
          await db.managedWallet.create({
            data: { merchantId, chain, address: evmWallet.address, encryptedKey: encrypted },
          });
          await db.merchantWallet.upsert({
            where: { merchantId_chain: { merchantId, chain } },
            update: { address: evmWallet.address, supportedTokens, isActive: true },
            create: { merchantId, chain, address: evmWallet.address, supportedTokens, isActive: true },
          });
          results.push({ chain, address: evmWallet.address });
        }
      }

      // Generate Solana keypair (separate from EVM)
      if (solanaChains.length > 0) {
        const solKeypair = Keypair.generate();
        const solAddress = solKeypair.publicKey.toBase58();
        const solSecret = Buffer.from(solKeypair.secretKey).toString('hex');
        const encrypted = encryptKey(solSecret);

        // Solana tokens available
        const solTokens = supportedTokens.filter((t: string) => ['USDC', 'USDT'].includes(t));

        for (const chain of solanaChains) {
          await db.managedWallet.create({
            data: { merchantId, chain, address: solAddress, encryptedKey: encrypted },
          });
          await db.merchantWallet.upsert({
            where: { merchantId_chain: { merchantId, chain } },
            update: { address: solAddress, supportedTokens: solTokens.length ? solTokens : ['USDC'], isActive: true },
            create: { merchantId, chain, address: solAddress, supportedTokens: solTokens.length ? solTokens : ['USDC'], isActive: true },
          });
          results.push({ chain, address: solAddress });
        }
      }

      // Auto-switch to mainnet
      await db.merchant.update({
        where: { id: merchantId },
        data: { networkMode: 'MAINNET' },
      });

      const walletSummary = results.map(r => `${r.chain}: ${r.address}`).join('\n');

      return JSON.stringify({
        success: true,
        wallets: results,
        tokens: supportedTokens,
        message: `Managed wallets created:\n${walletSummary}\n\nPayments go directly to these wallets. We hold the keys for now — please set up your own wallets when ready for full control of your funds.`,
        warning: 'We recommend setting up your own wallets (MetaMask for EVM chains, Phantom for Solana). With your own wallet, only YOU control your money.',
      });
    }

    case 'set_chain_priority': {
      const { chainOrder } = input;
      if (!chainOrder?.length) return JSON.stringify({ error: 'chainOrder array required' });

      // Update priority for each chain in order
      for (let i = 0; i < chainOrder.length; i++) {
        await db.merchantWallet.updateMany({
          where: { merchantId, chain: chainOrder[i] as any },
          data: { priority: i },
        });
      }

      return JSON.stringify({
        success: true,
        order: chainOrder,
        message: `Chain priority set: ${chainOrder.map((c: string, i: number) => `${i + 1}. ${c}`).join(', ')}`,
      });
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

      const configuredChains = m.wallets.filter(w => w.isActive).sort((a, b) => a.priority - b.priority).map(w => w.chain);
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

    case 'get_onboarding_progress': {
      const m = await db.merchant.findUnique({
        where: { id: merchantId },
        include: { wallets: true, _count: { select: { orders: true } } },
      });
      if (!m) return JSON.stringify({ error: 'Merchant not found' });

      const wallets = m.wallets.filter(w => w.isActive);
      const hasMainnetWallet = wallets.some(w => w.chain.includes('MAINNET'));
      const managedWallets = await db.managedWallet.findMany({ where: { merchantId, migratedToOwn: false } });
      const hasManagedWallet = managedWallets.length > 0;
      const hasWebhook = !!(m.webhookUrl && m.webhookEnabled);
      const hasSuccessUrl = !!m.successUrl;
      const hasCancelUrl = !!m.cancelUrl;
      const hasTestPayment = m._count.orders > 0;
      const isSetupComplete = m.setupCompleted;

      const steps = [
        { step: 'Wallet configured', done: wallets.length > 0, detail: wallets.length > 0 ? `${wallets.length} chain(s): ${wallets.map(w => w.chain).join(', ')}${hasManagedWallet ? ' (⚠️ managed — merchant should set up own wallet)' : ''}` : 'No wallets yet' },
        { step: 'Mainnet wallet', done: hasMainnetWallet, detail: hasMainnetWallet ? 'Ready for live payments' : 'Add a mainnet wallet to go live' },
        ...(hasManagedWallet ? [{ step: 'Own wallet (recommended)', done: false, detail: 'Merchant is using a managed wallet — urge them to set up their own for security' }] : []),
        { step: 'Webhook URL', done: hasWebhook, detail: hasWebhook ? m.webhookUrl : 'Not set — you won\'t know when payments confirm' },
        { step: 'Success redirect URL', done: hasSuccessUrl, detail: hasSuccessUrl ? m.successUrl : 'Not set — customers stay on payment page after paying' },
        { step: 'Cancel redirect URL', done: hasCancelUrl, detail: hasCancelUrl ? m.cancelUrl : 'Optional — where customers go if they cancel' },
        { step: 'Integration code added', done: false, detail: 'We can\'t detect this — ask the merchant' },
        { step: 'Test payment', done: hasTestPayment, detail: hasTestPayment ? `${m._count.orders} order(s) created` : 'No orders yet' },
        { step: 'Setup complete', done: isSetupComplete, detail: isSetupComplete ? 'All done!' : 'Mark complete when ready' },
      ];

      const completed = steps.filter(s => s.done).length;
      const total = steps.length;

      return JSON.stringify({
        progress: `${completed}/${total} steps complete`,
        percentage: Math.round((completed / total) * 100),
        steps,
        nextStep: steps.find(s => !s.done)?.step || 'All done!',
      });
    }

    case 'configure_settings': {
      const data: any = {};
      if (input.webhookUrl) {
        if (!input.webhookUrl.startsWith('https://')) {
          return JSON.stringify({ error: 'Webhook URL must start with https://' });
        }
        data.webhookUrl = input.webhookUrl;
        data.webhookEnabled = true;
        data.webhookEvents = ['order.confirmed', 'order.created', 'order.refunded', 'invoice.paid'];
      }
      if (input.successUrl) data.successUrl = input.successUrl;
      if (input.cancelUrl) data.cancelUrl = input.cancelUrl;
      if (typeof input.webhookEnabled === 'boolean') data.webhookEnabled = input.webhookEnabled;

      if (Object.keys(data).length === 0) {
        return JSON.stringify({ error: 'No settings to update' });
      }

      await db.merchant.update({ where: { id: merchantId }, data });

      const updated = Object.keys(data).filter(k => k !== 'webhookEvents');
      return JSON.stringify({ success: true, message: `Updated: ${updated.join(', ')}` });
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

    case 'withdraw_managed_wallet': {
      const { toAddress, amount, chain, token } = input;
      const tokenName = token || 'USDC';

      if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
        return JSON.stringify({ error: 'Invalid destination address' });
      }
      if (amount <= 0) return JSON.stringify({ error: 'Amount must be positive' });

      // Find the merchant's managed wallet for this chain
      const managedWallet = await db.managedWallet.findUnique({
        where: { merchantId_chain: { merchantId, chain } },
      });

      if (!managedWallet) {
        return JSON.stringify({ error: `No managed wallet found for ${chain}. You may have already migrated to your own wallet.` });
      }

      const chainConf = CHAIN_RPC[chain];
      if (!chainConf) return JSON.stringify({ error: `Unsupported chain: ${chain}` });

      try {
        // Decrypt the managed wallet key
        const privateKey = decryptKey(managedWallet.encryptedKey);
        const provider = new ethers.JsonRpcProvider(chainConf.rpc);
        const wallet = new ethers.Wallet(privateKey, provider);
        const usdc = new ethers.Contract(chainConf.usdc, ERC20_ABI, wallet);
        const amountRaw = ethers.parseUnits(amount.toString(), 6);

        const tx = await usdc.transfer(toAddress, amountRaw);

        return JSON.stringify({
          success: true,
          txHash: tx.hash,
          amount,
          token: tokenName,
          chain,
          from: managedWallet.address,
          to: toAddress,
          message: `Sent $${amount} ${tokenName} from your managed wallet to ${toAddress.slice(0, 8)}...${toAddress.slice(-4)}. TX: ${tx.hash}`,
        });
      } catch (err: any) {
        return JSON.stringify({ error: `Withdrawal failed: ${err.message}` });
      }
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
- Keep responses SHORT. Under 100 words. No essays, no bullet-point walls. Be direct.
- Only go longer when showing code snippets.
- If explaining fees, do it in 2-3 sentences max. Not a pricing page.

## Onboarding — Checklist-Driven

At the START of every new conversation, call get_onboarding_progress AND recall_memories.
This gives you a checklist of what's done and what's next. Work through the incomplete items ONE AT A TIME.

### The Complete Setup Checklist:
1. **Wallet configured** — They need at least one wallet on a mainnet chain
2. **Webhook URL** — Where we notify their server when payments confirm (CRITICAL for real integration)
3. **Success redirect URL** — Where customers go after paying
4. **Cancel redirect URL** — Where customers go if they bail (optional)
5. **Integration code** — Widget or API hooked into their checkout
6. **Test payment** — At least one order created to verify it works
7. **Setup complete** — Mark as done

### How to work through it:
- Call get_onboarding_progress to see where they are
- Tell them: "Here's where you are: X/7 steps done. Next up: [next step]."
- Guide them through the next incomplete step
- After each step completes, briefly confirm and move to the next one
- Don't re-ask about completed steps

### For each step:

**Wallet setup:**
- Ask: "Do you have a crypto wallet address, or do you need us to create one for you?"

**If they have a wallet:**
- Ask for their address (0x... for EVM chains)
- One EVM address works on all EVM chains (Base, Ethereum, Polygon, Arbitrum)
- Ask which chains and tokens
- Use add_wallet to configure

**If they DON'T have a wallet (white glove onboarding):**
- Say: "No problem! I'll create a managed wallet for you right now so you can start accepting payments immediately."
- Ask which chains they want (recommend Base + Ethereum)
- Use create_managed_wallet to generate their wallet
- Tell them their new wallet address
- THEN explain: "This wallet is ready to receive payments. However, I strongly recommend setting up your own wallet when you get a chance — it takes 2 minutes with MetaMask or Rainbow, and it means only YOU control your funds. I can help you switch whenever you're ready."
- Save memory: crypto_level=beginner, has_managed_wallet=true
- In EVERY future conversation with this merchant, gently remind them to set up their own wallet if they still have a managed one. Don't be annoying about it, but mention it once per conversation.

**Webhook URL:**
- Ask: "Where should we send payment notifications? This is an HTTPS endpoint on your server."
- Example: https://yoursite.com/api/webhooks/payments
- We POST: { event, orderId, amount, txHash, chain, token, status }
- Use configure_settings to save it
- If they don't have a backend: explain they can skip this for now but won't get real-time notifications

**Success/Cancel URLs:**
- Ask: "Where should customers go after paying? And if they cancel?"
- Example: https://yoursite.com/thank-you and https://yoursite.com/checkout
- Use configure_settings to save both

**Integration code:**
- Ask what their site is built with
- THEN ask: "Which chains should your customers see at checkout? And which stablecoins?" — check their configured wallets and list what's available
- Ask: "Which chain should appear first as the default? This is what customers see first." Use set_chain_priority to order them.
- Write code that hooks into THEIR checkout — reads cart total dynamically
- ALWAYS use get_widget_code tool first to get the correct base code, then adapt it for their framework
- Include merchantId, allowedChains, allowedTokens in the checkout call
- Include the onSuccess callback that redirects to their successUrl
- Payment links only if they ask or don't have a site

**Test payment:**
- After integration code is ready, suggest they test it
- They can use the Test Store in Quick Actions
- Or create a small test order through their integration

**Complete setup:**
- Once key steps are done, use complete_setup
- Brief summary of what's configured

### For Returning Merchants
- Call get_onboarding_progress to check their status
- If setup is complete, help with: new chains, integration code, webhooks, troubleshooting, billing
- If setup is incomplete, pick up where they left off — "Looks like you still need to set up your webhook URL. Want to do that now?"

## Stablecoins by Chain (mainnet only)
- Base: USDC, EURC
- Ethereum: USDC, USDT, EURC
- Polygon: USDC, USDT
- Arbitrum: USDC, USDT
- Solana: USDC, USDT

## Pricing (volume-based, no subscriptions, no setup fees)
- Under $10k/month: 1.0% fee, invoiced weekly
- $10k-$50k/month: 0.8% fee, invoiced bi-weekly
- $50k-$250k/month: 0.5% fee, invoiced monthly
- $250k+/month: 0.3% fee, invoiced monthly
- 100% of every payment goes to merchant's wallet immediately. We never touch their money.
- Fees accumulate separately and are invoiced per billing cycle (shorter cycles at lower tiers).
- No monthly fees, no setup costs, no hidden charges. Customers pay their own gas fees (cents).
- KEEP FEE EXPLANATIONS SHORT. Don't write essays about pricing. A few sentences max.

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

## CRITICAL: Exact Script & API Reference (DO NOT HALLUCINATE)
The widget script URL is EXACTLY: https://wetakestables.shop/checkout-widget.js
The namespace is EXACTLY: StablePay (not WeTakeStables, not wetakestables)
There is NO embed.wetakestables.shop subdomain. Do NOT invent URLs.

### Correct checkout call:
\`\`\`js
StablePay.checkout({
  merchantId: '${merchant.id}',  // ALWAYS include this
  amount: 99.99,                 // from their cart/page
  // Optional:
  productName: 'Order #123',
  customerEmail: 'buyer@email.com',
  allowedChains: ['BASE_MAINNET', 'ETHEREUM_MAINNET'],  // restrict chains
  allowedTokens: ['USDC', 'USDT'],                      // restrict tokens
  onSuccess: (data) => { /* data.orderId, data.txHash */ },
  onCancel: () => { /* user cancelled */ },
});
\`\`\`

### For React/Next.js — load script correctly:
\`\`\`jsx
import Script from 'next/script';
// In component:
<Script src="https://wetakestables.shop/checkout-widget.js" strategy="lazyOnload" />
\`\`\`

### Webhook payload we send:
POST to their webhookUrl with:
{ event: 'order.confirmed', orderId, amount, txHash, chain, token, status, customerEmail }

## Rules
- ALWAYS include merchantId: '${merchant.id}' in checkout calls.
- ALWAYS use the correct script URL. Never make up URLs or subdomains.
- ALWAYS ask which chains and tokens to allow in the checkout BEFORE writing code. The merchant has wallets on specific chains — ask which ones should appear at checkout.
- Use get_widget_code tool when possible instead of writing code manually — it generates correct code with the right URLs.
- ALWAYS use mainnet chains. Never suggest testnets.
- Validate wallet addresses before calling add_wallet.
- EVM: 0x + 40 hex chars. Solana: 32-44 base58 chars.
- Don't ask for info you can get from tools.
- If someone seems lost, slow down.`;
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
