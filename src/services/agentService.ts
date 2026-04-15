import Anthropic from '@anthropic-ai/sdk';
import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import { db } from '../config/database';
import { logger } from '../utils/logger';

// ─── Encryption for managed wallet keys ─────────────────────────────────────
const ENCRYPTION_KEY = process.env.JWT_SECRET || process.env.AGENT_WALLET_KEY;
if (!ENCRYPTION_KEY) {
  console.error('[agent] WARNING: No encryption key set (JWT_SECRET or AGENT_WALLET_KEY). Managed wallets will not work.');
}

function encryptKey(privateKey: string): string {
  if (!ENCRYPTION_KEY) throw new Error('Encryption key not configured');
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptKey(encrypted: string): string {
  if (!ENCRYPTION_KEY) throw new Error('Encryption key not configured');
  const [ivHex, encData] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─── Agent wallet + chain RPC config ────────────────────────────────────────
const AGENT_WALLET_KEY = process.env.AGENT_WALLET_KEY?.trim();
const AGENT_WALLET_ADDRESS = process.env.AGENT_WALLET_ADDRESS?.trim();

const CHAIN_RPC: Record<string, { rpc: string; usdc: string; tokens?: Record<string, string> }> = {
  BASE_SEPOLIA: { rpc: 'https://sepolia.base.org', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  BASE_MAINNET: { rpc: 'https://mainnet.base.org', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', tokens: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' } },
  ETHEREUM_SEPOLIA: { rpc: 'https://eth-sepolia.g.alchemy.com/v2/demo', usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
  ETHEREUM_MAINNET: { rpc: 'https://eth.llamarpc.com', usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', tokens: { USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', EURC: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c' } },
  POLYGON_MAINNET: { rpc: 'https://polygon-rpc.com', usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', tokens: { USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' } },
  ARBITRUM_MAINNET: { rpc: process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', tokens: { USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' } },
  BNB_MAINNET: { rpc: process.env.BNB_MAINNET_RPC_URL || 'https://bsc-dataseed.binance.org', usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', tokens: { USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', USDT: '0x55d398326f99059fF775485246999027B3197955' } },
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
  {
    name: 'screen_wallet',
    description: 'Screen any wallet address for AML/sanctions risk. Returns a risk score (0-100) and flags. Use when a merchant asks about a specific wallet or wants to check if an address is safe.',
    input_schema: {
      type: 'object' as const,
      properties: {
        address: { type: 'string', description: 'Wallet address to screen' },
        chain: { type: 'string', description: 'Blockchain (defaults to BASE_MAINNET)' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_compliance_status',
    description: 'Get the merchant\'s compliance overview — KYC status, total payments screened, flagged count, blocked count. Use when merchant asks about their compliance status.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_treasury_balances',
    description: 'Get the merchant\'s stablecoin balances across all chains. Shows USDC/USDT/EURC balance per wallet, total holdings, fees owed, and net available. Use when merchant asks about their balance or holdings.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'consolidate_earnings',
    description: 'Consolidate all merchant earnings from managed wallets across chains into one destination wallet on one chain. Gas is auto-sponsored. Use when merchant wants to collect all their funds into a single wallet. Can consolidate same-chain or cross-chain (via Circle CCTP for USDC).',
    input_schema: {
      type: 'object' as const,
      properties: {
        toAddress: { type: 'string', description: 'Destination wallet address (0x...)' },
        toChain: { type: 'string', enum: ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET'], description: 'Destination chain' },
        token: { type: 'string', enum: ['USDC', 'USDT', 'EURC'], description: 'Token to consolidate. Defaults to USDC.' },
      },
      required: ['toAddress', 'toChain'],
    },
  },
  {
    name: 'bridge_usdc',
    description: 'Bridge USDC from one chain to another using Circle CCTP (native burn/mint, no wrapped tokens). Use when merchant wants to move USDC between chains. Only works for USDC.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fromChain: { type: 'string', enum: ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET'], description: 'Source chain' },
        toChain: { type: 'string', enum: ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET'], description: 'Destination chain' },
        toAddress: { type: 'string', description: 'Destination address on target chain' },
        amount: { type: 'number', description: 'Amount of USDC to bridge' },
      },
      required: ['fromChain', 'toChain', 'toAddress', 'amount'],
    },
  },
  {
    name: 'process_refund',
    description: 'Process a refund for a confirmed order. Sends stablecoins back to the customer from the managed wallet. Gas is automatically sponsored if needed. Only works for merchants with managed wallets.',
    input_schema: {
      type: 'object' as const,
      properties: {
        orderId: { type: 'string', description: 'The order ID to refund' },
        refundToAddress: { type: 'string', description: 'Customer wallet address to refund to. If not provided, uses the customerWallet from the order.' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'assess_refund_readiness',
    description: 'Check if a merchant can send a refund from their OWN wallet (non-managed). Checks their wallet gas balance (ETH/SOL), token balance, and tells you if they need gas sponsorship. Use this BEFORE telling a merchant to refund manually.',
    input_schema: {
      type: 'object' as const,
      properties: {
        orderId: { type: 'string', description: 'The order ID to assess refund readiness for' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'sponsor_gas',
    description: 'Send a one-time gas sponsorship (ETH/SOL) to a merchant wallet so they can execute a refund or withdrawal. Only use after assess_refund_readiness confirms they need gas. Max 0.001 ETH or 0.01 SOL per sponsorship.',
    input_schema: {
      type: 'object' as const,
      properties: {
        toAddress: { type: 'string', description: 'Merchant wallet address to send gas to' },
        chain: { type: 'string', enum: ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'SOLANA_MAINNET'], description: 'Chain to send gas on' },
        reason: { type: 'string', description: 'Reason for sponsorship (e.g. "refund for order xyz")' },
      },
      required: ['toAddress', 'chain', 'reason'],
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

      // Auto-sweep: if there was a managed wallet for this chain, transfer funds to new address
      let sweepResult = null;
      const managedWallet = await db.managedWallet.findUnique({
        where: { merchantId_chain: { merchantId, chain } },
      });
      if (managedWallet && !managedWallet.migratedToOwn && managedWallet.address.toLowerCase() !== address.toLowerCase()) {
        try {
          const chainConf = CHAIN_RPC[chain];
          if (chainConf && ENCRYPTION_KEY) {
            const privateKey = decryptKey(managedWallet.encryptedKey);
            const provider = new ethers.JsonRpcProvider(chainConf.rpc);
            const wallet = new ethers.Wallet(privateKey, provider);
            const tokenContract = new ethers.Contract(chainConf.usdc, ERC20_ABI, wallet);
            const balance = await tokenContract.balanceOf(managedWallet.address);
            if (balance > 0n) {
              const tx = await tokenContract.transfer(address, balance);
              sweepResult = `Auto-transferred ${ethers.formatUnits(balance, 6)} USDC from managed wallet to your new address. TX: ${tx.hash}`;
            }
            // Mark as migrated
            await db.managedWallet.update({
              where: { id: managedWallet.id },
              data: { migratedToOwn: true },
            });
          }
        } catch (err: any) {
          sweepResult = `Managed wallet migration note: could not auto-transfer funds (${err.message}). You can withdraw manually later.`;
        }
      }

      const msg = `Wallet configured for ${chain} accepting ${tokens.join(', ')}${isMainnet ? '. Network mode set to MAINNET.' : ''}`;
      return JSON.stringify({ success: true, chain, address, tokens, message: sweepResult ? `${msg}\n\n${sweepResult}` : msg });
    }

    case 'create_managed_wallet': {
      const { chains, tokens } = input;
      const supportedTokens = tokens || ['USDC'];

      // Check which chains already have managed wallets
      const existing = await db.managedWallet.findMany({ where: { merchantId } });
      const existingChains = new Set(existing.map(w => w.chain));
      const newChains = chains.filter((c: string) => !existingChains.has(c));

      if (newChains.length === 0) {
        return JSON.stringify({
          message: 'All requested chains already have managed wallets.',
          wallets: existing.map(w => ({ chain: w.chain, address: w.address })),
        });
      }

      const evmChains = newChains.filter((c: string) => !c.startsWith('SOLANA'));
      const solanaChains = newChains.filter((c: string) => c.startsWith('SOLANA'));

      const results: { chain: string; address: string }[] = [];

      // All available tokens per chain
      const ALL_CHAIN_TOKENS: Record<string, string[]> = {
        BASE_MAINNET: ['USDC', 'USDT', 'EURC'],
        ETHEREUM_MAINNET: ['USDC', 'USDT', 'EURC'],
        POLYGON_MAINNET: ['USDC', 'USDT', 'EURC'],
        ARBITRUM_MAINNET: ['USDC', 'USDT', 'EURC'],
        SOLANA_MAINNET: ['USDC', 'USDT', 'EURC'],
      };

      // Generate ONE EVM wallet (works on all EVM chains)
      if (evmChains.length > 0) {
        const evmWallet = ethers.Wallet.createRandom();
        const encrypted = encryptKey(evmWallet.privateKey);

        for (const chain of evmChains) {
          const chainTokens = ALL_CHAIN_TOKENS[chain] || supportedTokens;
          await db.managedWallet.create({
            data: { merchantId, chain, address: evmWallet.address, encryptedKey: encrypted },
          });
          await db.merchantWallet.upsert({
            where: { merchantId_chain: { merchantId, chain } },
            update: { address: evmWallet.address, supportedTokens: chainTokens, isActive: true },
            create: { merchantId, chain, address: evmWallet.address, supportedTokens: chainTokens, isActive: true },
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
        for (const chain of solanaChains) {
          const chainTokens = ALL_CHAIN_TOKENS[chain] || ['USDC', 'USDT', 'EURC'];
          await db.managedWallet.create({
            data: { merchantId, chain, address: solAddress, encryptedKey: encrypted },
          });
          await db.merchantWallet.upsert({
            where: { merchantId_chain: { merchantId, chain } },
            update: { address: solAddress, supportedTokens: chainTokens, isActive: true },
            create: { merchantId, chain, address: solAddress, supportedTokens: chainTokens, isActive: true },
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
        message: `Wallets created:\n${walletSummary}\n\nPayments go directly to these addresses. WeTakeStables holds the private keys for you — like a bank holding your account. To take full control, set up MetaMask (for EVM) or Phantom (for Solana) and give us your own address.`,
        custody: 'WeTakeStables (us) holds the keys. You can withdraw anytime or switch to your own wallet.',
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

    case 'screen_wallet': {
      const { complianceService } = await import('./complianceService');
      const result = await complianceService.screenWallet(input.address, input.chain || 'BASE_MAINNET');
      return JSON.stringify({
        address: input.address,
        riskScore: result.riskScore,
        riskLevel: result.riskLevel,
        flags: result.flags,
        message: result.riskLevel === 'LOW'
          ? `Clean wallet. Risk score: ${result.riskScore}/100.`
          : result.riskLevel === 'BLOCKED'
          ? `BLOCKED — this wallet is sanctioned or linked to known bad actors. Flags: ${result.flags.join(', ')}.`
          : `Flagged wallet. Risk score: ${result.riskScore}/100. Flags: ${result.flags.join(', ')}.`,
      });
    }

    case 'get_compliance_status': {
      const { complianceService } = await import('./complianceService');
      const status = await complianceService.getMerchantCompliance(merchantId);
      return JSON.stringify(status);
    }

    case 'get_treasury_balances': {
      const { treasuryService } = await import('./treasuryService');
      const data = await treasuryService.getMerchantBalances(merchantId);
      return JSON.stringify({
        totalUSD: data.totalUSD,
        feesDue: data.feesDue,
        netAvailable: data.netAvailable,
        wallets: data.wallets.map(w => ({
          chain: w.chain,
          address: `${w.address.slice(0, 8)}...${w.address.slice(-4)}`,
          tokens: w.tokens.filter(t => t.balanceUSD > 0),
          totalUSD: w.totalUSD,
        })),
      });
    }

    case 'consolidate_earnings': {
      const { consolidationService } = await import('./consolidationService');
      const toAddr = input.toAddress;
      const toChain = input.toChain;
      const token = input.token || 'USDC';

      if (!/^0x[a-fA-F0-9]{40}$/.test(toAddr)) {
        return JSON.stringify({ error: 'Invalid destination address' });
      }

      const result = await consolidationService.consolidateEarnings(merchantId, toAddr, toChain, token);

      return JSON.stringify({
        success: result.success,
        totalConsolidated: `$${result.totalConsolidated.toFixed(2)}`,
        transfers: result.transfers.map(t => ({
          chain: t.chain,
          token: t.token,
          amount: `$${t.amount}`,
          txHash: t.txHash,
          type: t.type === 'cctp' ? 'Cross-chain (CCTP)' : 'Direct transfer',
        })),
        errors: result.errors,
        message: result.success
          ? `Consolidated $${result.totalConsolidated.toFixed(2)} ${token} to ${toAddr.slice(0, 8)}...${toAddr.slice(-4)} on ${toChain}. ${result.transfers.length} transfer(s) completed.`
          : `Consolidation had issues: ${result.errors.join('; ')}`,
      });
    }

    case 'bridge_usdc': {
      const { consolidationService } = await import('./consolidationService');
      const { fromChain, toChain, toAddress: bridgeTo, amount: bridgeAmount } = input;

      if (fromChain === toChain) return JSON.stringify({ error: 'Source and destination chain must be different' });
      if (!/^0x[a-fA-F0-9]{40}$/.test(bridgeTo)) return JSON.stringify({ error: 'Invalid destination address' });
      if (bridgeAmount <= 0) return JSON.stringify({ error: 'Amount must be positive' });

      const result = await consolidationService.bridgeFromManagedWallet(merchantId, fromChain, toChain, bridgeTo, bridgeAmount);

      if (!result.success) return JSON.stringify({ error: result.error });

      return JSON.stringify({
        success: true,
        txHash: result.txHash,
        fromChain,
        toChain,
        amount: `$${bridgeAmount}`,
        message: `USDC bridge initiated: $${bridgeAmount} from ${fromChain} → ${toChain}. Burn TX: ${result.txHash}. Funds arrive on ${toChain} in ~10-20 minutes via Circle CCTP.`,
        note: 'Circle CCTP performs native burn/mint — no wrapped tokens. Monitor the burn TX for confirmation.',
      });
    }

    case 'process_refund': {
      const { RefundService } = await import('./refundService');
      const refundSvc = new RefundService();
      const order = await db.order.findUnique({
        where: { id: input.orderId },
        select: { merchantId: true, customerWallet: true, amount: true, token: true, chain: true, status: true },
      });

      if (!order) return JSON.stringify({ error: 'Order not found' });
      if (order.merchantId !== merchantId) return JSON.stringify({ error: 'This order does not belong to you' });

      const refundTo = input.refundToAddress || order.customerWallet;
      if (!refundTo) return JSON.stringify({ error: 'No refund address provided and no customer wallet on record. Please provide the customer wallet address.' });

      const result = await refundSvc.processManagedRefund(input.orderId, refundTo);

      if (result.success) {
        return JSON.stringify({
          success: true,
          message: `Refund of $${result.amount} ${order.token} sent to ${refundTo.slice(0, 8)}...${refundTo.slice(-4)} on ${order.chain}.`,
          txHash: result.txHash,
          gasTxHash: result.gasTxHash || null,
          gasSponsored: !!result.gasTxHash,
        });
      }
      return JSON.stringify({ error: result.error });
    }

    case 'assess_refund_readiness': {
      const order = await db.order.findUnique({
        where: { id: input.orderId },
        include: {
          merchant: { include: { wallets: { where: { isActive: true } } } },
          transactions: { where: { status: 'CONFIRMED' }, take: 1 },
        },
      });

      if (!order) return JSON.stringify({ error: 'Order not found' });
      if (order.merchantId !== merchantId) return JSON.stringify({ error: 'This order does not belong to you' });
      if (order.status !== 'CONFIRMED') return JSON.stringify({ error: `Order status is ${order.status}, cannot refund` });

      const chain = order.chain;
      const amount = Number(order.amount);
      const token = order.token;
      const customerWallet = order.customerWallet || order.transactions[0]?.fromAddress || null;

      // Check if merchant has a managed wallet (if so, just use process_refund)
      const managedWallet = await db.managedWallet.findUnique({
        where: { merchantId_chain: { merchantId: order.merchantId!, chain } },
      });
      if (managedWallet) {
        return JSON.stringify({
          hasManagedWallet: true,
          message: 'This merchant has a managed wallet on this chain. Use process_refund instead — gas is auto-sponsored.',
          orderId: input.orderId,
          customerWallet,
        });
      }

      // Find merchant's own wallet for this chain
      const merchantWallet = order.merchant?.wallets?.find(w => w.chain === chain);
      if (!merchantWallet) {
        return JSON.stringify({
          canRefund: false,
          error: `No wallet configured for ${chain}. Merchant needs to add a wallet for this chain first.`,
        });
      }

      const walletAddress = merchantWallet.address;

      // Check balances based on chain type
      if (chain === 'SOLANA_MAINNET') {
        try {
          const solRpc = process.env.SOLANA_MAINNET_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
          // Check SOL balance for gas
          const solBalRes = await fetch(solRpc, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [walletAddress] }),
          });
          const solBalData: any = await solBalRes.json();
          const solBalance = (solBalData.result?.value || 0) / 1e9; // lamports → SOL
          const hasGas = solBalance >= 0.005; // ~0.005 SOL needed for SPL transfer

          // Check SPL token balance
          const MINTS: Record<string, string> = {
            USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
            EURC: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
          };
          const mint = MINTS[token];
          let tokenBalance = 0;
          if (mint) {
            const ataRes = await fetch(solRpc, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [walletAddress, { mint }, { encoding: 'jsonParsed' }] }),
            });
            const ataData: any = await ataRes.json();
            const accounts = ataData.result?.value || [];
            for (const acc of accounts) {
              tokenBalance += acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
            }
          }

          const hasTokens = tokenBalance >= amount;

          return JSON.stringify({
            canRefund: hasGas && hasTokens,
            chain, walletAddress, customerWallet,
            gasBalance: `${solBalance.toFixed(4)} SOL`,
            hasGas,
            gasNeeded: hasGas ? null : '~0.005 SOL for SPL transfer fees',
            tokenBalance: `${tokenBalance.toFixed(2)} ${token}`,
            hasTokens,
            refundAmount: `${amount} ${token}`,
            needsGasSponsorship: !hasGas,
            action: !hasGas
              ? 'Merchant needs SOL for gas. Use sponsor_gas to send ~0.01 SOL to their wallet.'
              : !hasTokens
                ? `Merchant only has ${tokenBalance.toFixed(2)} ${token} but needs ${amount}. They need to fund their wallet first.`
                : 'Merchant is ready to refund. Guide them to send the refund from their wallet and submit the TX hash via the dashboard.',
          });
        } catch (err: any) {
          return JSON.stringify({ error: `Failed to check Solana balances: ${err.message}` });
        }
      }

      // EVM chains
      const chainConf = CHAIN_RPC[chain];
      if (!chainConf) return JSON.stringify({ error: `Unsupported chain: ${chain}` });

      try {
        const provider = new ethers.JsonRpcProvider(chainConf.rpc);

        // Check native gas balance
        const gasBalanceWei = await provider.getBalance(walletAddress);
        const gasBalance = parseFloat(ethers.formatEther(gasBalanceWei));
        const native = chain.includes('POLYGON') ? 'MATIC' : chain.includes('BNB') ? 'BNB' : 'ETH';
        const minGas = chain.includes('POLYGON') || chain.includes('BNB') ? 0.001 : 0.0005;
        const hasGas = gasBalance >= minGas;

        // Check token balance
        const tokenAddress = chainConf.tokens?.[token] || chainConf.usdc;
        const decimals = chain === 'BNB_MAINNET' ? 18 : 6;
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const tokenBalanceRaw = await tokenContract.balanceOf(walletAddress);
        const tokenBalance = parseFloat(ethers.formatUnits(tokenBalanceRaw, decimals));
        const hasTokens = tokenBalance >= amount;

        return JSON.stringify({
          canRefund: hasGas && hasTokens,
          chain, walletAddress, customerWallet,
          gasBalance: `${gasBalance.toFixed(6)} ${native}`,
          hasGas,
          gasNeeded: hasGas ? null : `~${(minGas * 2).toFixed(4)} ${native} for ERC20 transfer`,
          tokenBalance: `${tokenBalance.toFixed(2)} ${token}`,
          hasTokens,
          refundAmount: `${amount} ${token}`,
          needsGasSponsorship: !hasGas,
          action: !hasGas
            ? `Merchant needs ${native} for gas. Use sponsor_gas to send ~0.001 ${native} to their wallet.`
            : !hasTokens
              ? `Merchant only has ${tokenBalance.toFixed(2)} ${token} but needs ${amount}. They need to fund their wallet first.`
              : 'Merchant is ready to refund. Guide them to send the refund from their wallet and submit the TX hash via the dashboard.',
        });
      } catch (err: any) {
        return JSON.stringify({ error: `Failed to check balances: ${err.message}` });
      }
    }

    case 'sponsor_gas': {
      const { toAddress, chain, reason } = input;

      // Validate address format
      if (chain === 'SOLANA_MAINNET') {
        if (!toAddress || toAddress.length < 32 || toAddress.length > 44) {
          return JSON.stringify({ error: 'Invalid Solana address' });
        }
      } else {
        if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
          return JSON.stringify({ error: 'Invalid EVM address' });
        }
      }

      // Check for duplicate sponsorship in last 24h
      const recentSponsorship = await db.treasuryMove.findFirst({
        where: {
          toAddress,
          type: 'GAS_SPONSOR',
          chain,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });
      if (recentSponsorship) {
        return JSON.stringify({
          error: `Gas was already sponsored to this address on ${chain} in the last 24h (TX: ${recentSponsorship.txHash}). One sponsorship per day per address.`,
        });
      }

      if (chain === 'SOLANA_MAINNET') {
        // Solana gas sponsorship
        const solKey = process.env.AGENT_SOLANA_KEY?.trim();
        if (!solKey) return JSON.stringify({ error: 'Agent Solana wallet not configured' });

        try {
          const { Connection, Keypair, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
          const solRpc = process.env.SOLANA_MAINNET_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
          const connection = new Connection(solRpc, 'confirmed');

          // Decode agent key
          let agentKeypair: InstanceType<typeof Keypair>;
          if (solKey.startsWith('[')) {
            agentKeypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(solKey)));
          } else if (solKey.length === 128 || solKey.length === 64) {
            agentKeypair = Keypair.fromSecretKey(new Uint8Array(Buffer.from(solKey, 'hex')));
          } else {
            const bs58 = await import('bs58');
            agentKeypair = Keypair.fromSecretKey(bs58.default.decode(solKey));
          }

          const sponsorAmount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: agentKeypair.publicKey,
              toPubkey: new PublicKey(toAddress),
              lamports: sponsorAmount,
            })
          );

          const { blockhash } = await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          tx.feePayer = agentKeypair.publicKey;
          const sig = await connection.sendTransaction(tx, [agentKeypair]);

          // Record treasury move
          await db.treasuryMove.create({
            data: {
              merchantId,
              type: 'GAS_SPONSOR',
              chain,
              token: 'SOL',
              amount: 0.01,
              fromAddress: agentKeypair.publicKey.toBase58(),
              toAddress,
              txHash: sig,
              status: 'COMPLETED',
              metadata: { reason },
            },
          });

          return JSON.stringify({
            success: true,
            txHash: sig,
            amount: '0.01 SOL',
            toAddress,
            chain,
            message: `Sent 0.01 SOL to ${toAddress.slice(0, 8)}...${toAddress.slice(-4)} for gas. They can now send the refund from their wallet.`,
          });
        } catch (err: any) {
          return JSON.stringify({ error: `Solana gas sponsorship failed: ${err.message}` });
        }
      }

      // EVM gas sponsorship
      if (!AGENT_WALLET_KEY) return JSON.stringify({ error: 'Agent EVM wallet not configured' });

      const chainConf = CHAIN_RPC[chain];
      if (!chainConf) return JSON.stringify({ error: `Unsupported chain: ${chain}` });

      try {
        const provider = new ethers.JsonRpcProvider(chainConf.rpc);
        const agentWallet = new ethers.Wallet(AGENT_WALLET_KEY, provider);
        const native = chain.includes('POLYGON') ? 'MATIC' : chain.includes('BNB') ? 'BNB' : 'ETH';
        const sponsorAmount = ethers.parseEther('0.001'); // 0.001 ETH/MATIC

        // Check agent balance first
        const agentBalance = await provider.getBalance(agentWallet.address);
        if (agentBalance < sponsorAmount) {
          return JSON.stringify({
            error: `Agent wallet low on ${native} on ${chain}. Balance: ${ethers.formatEther(agentBalance)} ${native}. Fund ${agentWallet.address} to enable gas sponsorship.`,
          });
        }

        const tx = await agentWallet.sendTransaction({ to: toAddress, value: sponsorAmount });
        await tx.wait();

        // Record treasury move
        await db.treasuryMove.create({
          data: {
            merchantId,
            type: 'GAS_SPONSOR',
            chain,
            token: native,
            amount: 0.001,
            fromAddress: agentWallet.address,
            toAddress,
            txHash: tx.hash,
            status: 'COMPLETED',
            metadata: { reason },
          },
        });

        return JSON.stringify({
          success: true,
          txHash: tx.hash,
          amount: `0.001 ${native}`,
          toAddress,
          chain,
          message: `Sent 0.001 ${native} to ${toAddress.slice(0, 8)}...${toAddress.slice(-4)} for gas. They can now send the refund from their wallet.`,
        });
      } catch (err: any) {
        return JSON.stringify({ error: `Gas sponsorship failed: ${err.message}` });
      }
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ─── System prompt ──────────────────────────────────────────────────────────
function buildSystemPrompt(merchant: any): string {
  return `You are Stablo — the StablePay AI assistant. A friendly, thorough guide that helps merchants accept stablecoin payments. You work for wetakestables.shop.

Your name is Stablo. When merchants ask for help, say "I'm Stablo" not "I'm an AI assistant." You have personality — you're helpful, a bit playful, and you get things done.

## Your Personality
- Patient and clear. Many merchants are NOT crypto-native. Never assume knowledge.
- Explain concepts simply when needed: "A stablecoin is a cryptocurrency that stays at $1 — like a digital dollar."
- Take ACTION with your tools. Don't just give instructions — actually configure things.
- Ask ONE question at a time. Never dump a wall of options.
- Celebrate progress. Be warm.
- Keep responses SHORT. 1-3 sentences max. No essays, no bullet walls, no numbered lists unless showing steps.
- Sound human, not like a chatbot. No "Great!" "Perfect!" "Absolutely!" openers.
- Sign off casually: "— Stablo" when wrapping up a task.
- The UI shows clickable option buttons — don't repeat those options in your text.
- Only go longer when showing code snippets.
- If explaining fees, 2 sentences max.

## Onboarding — Checklist-Driven

At the START of every new conversation, call get_onboarding_progress AND recall_memories.
This gives you a checklist of what's done and what's next. Work through the incomplete items ONE AT A TIME.

### Setup is just 3 steps:
1. **Wallet** — set up or create a managed wallet
2. **Domain** — their website URL (we auto-configure webhook + redirects)
3. **Done** — generate widget code, complete setup

That's it. Don't make it 8 steps. Don't ask unnecessary questions.
After wallets + domain → generate code → call complete_setup → done.

### How to work through it:
- Call get_onboarding_progress to see where they are
- Keep it moving. Don't pause for confirmation between steps.
- If they give you info, act on it immediately.

### For each step:

**Wallet setup:**
- Ask SHORT: "Got a wallet address, or want me to create one?" — the UI shows clickable options, don't repeat them in text.
- Keep it to ONE sentence. The buttons handle the rest.

**If "I have my own wallet":**
- Ask for the address (0x...)
- One address works on Base, Ethereum, Polygon, Arbitrum
- Ask which chains + tokens
- Use add_wallet

**If "Create EVM wallet for me":**
- Use create_managed_wallet with EVM chains (recommend BASE_MAINNET + ETHEREUM_MAINNET)
- Tell them their address, keep it brief
- Mention: "Set up your own wallet when ready for full control."

**If "Create Solana wallet for me":**
- Use create_managed_wallet with SOLANA_MAINNET
- Same brief message

**If "Create both":**
- Use create_managed_wallet with both EVM + Solana chains
- Show both addresses

- Save memory: crypto_level and has_managed_wallet
- In future conversations, gently remind once if they still have a managed wallet.
- When mentioning managed wallets, ALWAYS be clear: "WeTakeStables holds the keys for your managed wallet. You can withdraw anytime, but for full control, set up your own wallet."
- NEVER say "you already have wallets" without clarifying who holds the keys.
- When a merchant wants to collect/consolidate funds, use consolidate_earnings. This sweeps all managed wallet balances to one destination.
- When a merchant wants to move USDC between chains, use bridge_usdc. This uses Circle CCTP (native burn/mint, ~10-20 min, no slippage).
- Cross-chain bridging ONLY works for USDC. For USDT/EURC, funds are sent to the destination address on the same chain — merchant must bridge manually.

**After wallets are set up, ask ONE question:**
- "What's your website domain?" (e.g. mystore.com, s-o-l-o.fun)
- Just the domain — NOT a specific page URL. We build the webhook/redirect URLs from it.
- If they give a full URL like https://mysite.com/checkout, extract just the domain: mysite.com

**Then do ALL of this automatically in one shot:**
1. Set webhook URL: https://THEIR-DOMAIN/api/webhooks/stablepay
2. Set success URL: https://THEIR-DOMAIN
3. Set cancel URL: https://THEIR-DOMAIN
4. Use configure_settings to save all three at once
5. Generate the integration code using get_widget_code with ALL their configured chains (don't ask which ones — use all of them)
6. Call complete_setup

**DO NOT ask:**
- "Which chains should customers see?" — USE ALL CONFIGURED CHAINS
- "Which tokens?" — USE ALL CONFIGURED TOKENS
- "Which chain first?" — DON'T ASK, use default order
- "What's your tech stack?" — Only ask if they want custom code. For most merchants, just give the widget snippet.
- "Where should they land after paying?" — Just use their domain

**The whole flow after wallets should be: domain → done.**

If they want to customize (specific chains, custom code for React/Shopify, etc.), they can ask. But don't force those questions on everyone.

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
- Product names, descriptions, branding — nice to have, not needed to start accepting payments.

## Customer Checkout UX (3 payment methods)
The checkout widget gives EVERY customer 3 ways to pay (all built-in, no config needed):
1. **Connect Wallet** — MetaMask/Rainbow/Coinbase/Phantom connects, one-click approve transaction. Best for desktop.
2. **QR Code** — Customer scans QR with their wallet app. Opens pre-filled transaction. Best for mobile.
3. **Copy Address** — Shows merchant's wallet address + exact amount. Customer sends from any wallet or exchange (Coinbase, Binance, etc.). Most flexible.

All 3 methods are automatically available on every checkout. The backend scanner detects the payment regardless of which method the customer used.

When explaining to merchants: "Your customers get 3 ways to pay — connect their wallet, scan a QR code, or copy your address and send manually. All built into the checkout widget, no extra setup needed."

## Key Explanations for Non-Crypto Users
If they ask "what is...":
- **Stablecoin**: "Digital dollar. 1 USDC = $1, always. It's cryptocurrency but without the price swings."
- **Blockchain/Chain**: "The network the payment travels on. Like choosing between FedEx and UPS — different speeds and costs, same package arrives."
- **Gas fees**: "A tiny network fee (usually cents) the customer pays to send the transaction. Not charged by us."
- **Wallet address**: "Like a bank account number for crypto. Safe to share. Starts with 0x for most chains."

## Memory
- Save important context: business type, country, tech stack, crypto experience level, preferred chains, notes
- Recall at conversation start to personalize

## Refunds — Smart Handling
When a merchant asks about refunding:
1. **Managed wallet?** → Use process_refund directly. Gas is auto-sponsored. Done.
2. **Own wallet?** → Use assess_refund_readiness FIRST to check their gas + token balances.
   - If they have gas + tokens → Guide them to send from their wallet and paste the TX hash in the dashboard.
   - If they're short on gas (ETH/SOL) → Offer to sponsor gas with sponsor_gas. Say something like: "Your wallet needs a bit of ETH for gas fees. I can send you some — one-time thing, on us."
   - If they're short on tokens → Tell them they need to fund their wallet. You can't help with that.
   - Gas sponsorship is limited to 1x per address per 24h. 0.001 ETH or 0.01 SOL.
3. **TRON?** → Not automated yet. Tell them to send manually.
4. Never skip assess_refund_readiness for own-wallet merchants. It gives you the full picture.

## Your Wallet
- Address: ${process.env.AGENT_WALLET_ADDRESS || 'not configured'}
- You can check your balance and send USDC (max $50/tx)
- You can sponsor gas for merchants who need help with refunds (0.001 ETH / 0.01 SOL)
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
