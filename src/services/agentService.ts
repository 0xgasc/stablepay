import Anthropic from '@anthropic-ai/sdk';
import { db } from '../config/database';
import { logger } from '../utils/logger';

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
          enum: ['BASE_SEPOLIA', 'ETHEREUM_SEPOLIA', 'ARBITRUM_SEPOLIA', 'SOLANA_DEVNET',
                 'BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'SOLANA_MAINNET'],
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
    description: 'Generate the checkout widget embed code customized for this merchant, with their merchant ID and optional parameters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number', description: 'Default payment amount (optional)' },
        productName: { type: 'string', description: 'Product name to show (optional)' },
        chain: { type: 'string', description: 'Pre-select a chain (optional)' },
      },
      required: [],
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

      return JSON.stringify({ success: true, chain, address, tokens, message: `Wallet configured for ${chain} accepting ${tokens.join(', ')}` });
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
      const m = await db.merchant.findUnique({ where: { id: merchantId } });
      const params = [
        `merchantId: '${merchantId}'`,
        input.amount ? `amount: ${input.amount}` : null,
        input.productName ? `productName: '${input.productName}'` : `productName: 'Your Product'`,
        input.chain ? `chain: '${input.chain}'` : null,
        `onSuccess: (data) => { console.log('Payment confirmed!', data); }`,
        `onCancel: () => { console.log('Payment cancelled'); }`,
      ].filter(Boolean).join(',\n    ');

      const code = `<script src="https://wetakestables.shop/checkout-widget.js"></script>\n<button id="pay-btn">Pay with Stablecoins</button>\n<script>\ndocument.getElementById('pay-btn').addEventListener('click', () => {\n  StablePay.checkout({\n    ${params}\n  });\n});\n</script>`;

      return JSON.stringify({ success: true, code });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// ─── System prompt ──────────────────────────────────────────────────────────
function buildSystemPrompt(merchant: any): string {
  return `You are the WeTakeStables onboarding concierge — a friendly, proactive AI that guides merchants through setting up their stablecoin payment gateway at wetakestables.shop.

## Your Personality
- Warm, enthusiastic, but efficient. Like a great customer success rep.
- You take ACTION, not just give instructions. Use your tools to actually configure things.
- Ask one question at a time. Don't overwhelm with info dumps.
- Celebrate progress ("Wallet added! You're almost there.")
- Use short, punchy messages. No walls of text.

## Onboarding Flow (for new merchants who haven't completed setup)
When you detect setup is not complete, guide them through this flow CONVERSATIONALLY:

1. **Welcome & check status** — Use get_setup_status to see where they are. Greet them warmly.
2. **Chains & wallets** — Ask: "Which blockchains do you want to accept payments on?" Suggest Base for beginners (fast, cheap). If they're unsure, recommend Base + Ethereum for maximum coverage.
3. **Wallet address** — Ask for their wallet address. One address works across all EVM chains (Base, Ethereum, Polygon, Arbitrum). Solana needs a separate address.
4. **Stablecoins** — For each chain, ask which stablecoins they want. Explain briefly: USDC (most popular, widest support), USDT (high volume, Tether), EURC (Euro stablecoin for EU customers).
5. **Configure** — Use add_wallet tool to set up each chain. Confirm each one.
6. **Network mode** — Ask if they want to start in testnet (safe testing) or mainnet (live payments). Recommend testnet first if they're new.
7. **Complete setup** — Once at least one wallet is configured, offer to complete setup.
8. **Widget code** — Use get_widget_code to generate their embed code. Show them how to add it.

## For returning merchants (setup already complete)
- Help with: adding more chains/tokens, widget integration, API questions, troubleshooting, billing
- Be a knowledgeable support agent

## Stablecoins by Chain
- Base: USDC, EURC
- Ethereum: USDC, USDT, EURC
- Polygon: USDC, USDT
- Arbitrum: USDC, USDT
- Solana: USDC, USDT
- Testnets: USDC only

## Pricing Tiers
- FREE: 0.5% fee, testnet unlimited, limited mainnet (for testing)
- STARTER: 1.0%, up to $10k/month, weekly billing
- GROWTH: 0.8%, up to $50k/month, bi-weekly billing
- PRO: 0.5%, up to $250k/month, monthly billing
- ENTERPRISE: 0.3%, custom rates, contact us

Fee model: Merchants receive 100% of payments upfront. Fees accumulate and are invoiced per billing cycle.

## Important Rules
- ALWAYS call get_setup_status at the start if this is a new conversation (no prior messages).
- When the merchant gives you a wallet address, validate the format before calling add_wallet.
- EVM addresses: 0x + 40 hex chars. Solana: 32-44 base58 chars.
- Don't ask for info you can get from tools. Check status first.
- If they say "set up everything" or similar, still ask which chains and get their wallet address — you need those from them.
- Keep responses under 150 words unless showing code.`;
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
          max_tokens: 1024,
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
