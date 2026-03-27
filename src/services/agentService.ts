import Anthropic from '@anthropic-ai/sdk';
import { db } from '../config/database';
import { logger } from '../utils/logger';

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function buildSystemPrompt(merchant: any): string {
  const walletList = merchant.wallets?.length
    ? merchant.wallets.map((w: any) => `  - ${w.chain}: ${w.address}`).join('\n')
    : '  (no wallets configured yet)';

  return `You are the StablePay AI Assistant — a helpful, concise support agent for StablePay, a multi-chain USDC payment gateway.

## About StablePay
- Merchants accept USDC payments on Base, Ethereum, Polygon, Arbitrum, and Solana
- Payments go directly to the merchant's wallet (no custodial holding)
- Transaction fees: FREE tier 0.5%, Starter 1.0%, Growth 0.8%, Pro 0.5%, Enterprise 0.3%
- Embeddable checkout widget, invoices, receipts, webhooks, REST API

## This Merchant
- Company: ${merchant.companyName}
- Plan: ${merchant.plan}
- Network: ${merchant.networkMode}
- Setup completed: ${merchant.setupCompleted ? 'Yes' : 'No'}
- Order count: ${merchant.orderCount || 0}
- Wallets:
${walletList}

## Widget Integration
Merchants embed the checkout widget like this:
\`\`\`html
<script src="https://yourdomain.com/js/stablepay-widget.js"></script>
<script>
StablePay.checkout({
  merchantId: '${merchant.id}',
  amount: 49.99,
  productName: 'Product Name',
  customerEmail: 'customer@email.com',
  chain: 'BASE_MAINNET', // optional
  onSuccess: (data) => console.log('Paid!', data),
  onCancel: () => console.log('Cancelled'),
  onError: (err) => console.error(err)
});
</script>
\`\`\`

## API Quick Reference
- Create order: POST /api/v1/orders { merchantId, amount, chain, customerEmail }
- Get orders: GET /api/orders?merchantId=X
- Create invoice: POST /api/invoices { merchantId, customerEmail, subtotal, ... }
- Webhooks: Configure at dashboard > Settings. Events: order.created, order.confirmed, order.refunded, invoice.paid, receipt.sent
- Auth: Bearer token in Authorization header

## Guidelines
- Be concise and direct. Use code blocks for code.
- If asked about features that don't exist, say so honestly.
- For billing questions, explain the fee model: merchants get 100% upfront, fees accumulate and are invoiced per billing cycle.
- If the merchant hasn't set up wallets, guide them to the Wallets tab.
- Keep responses under 300 words unless a longer code example is needed.`;
}

class AgentService {
  async chat(merchantId: string, userMessage: string): Promise<string> {
    if (!anthropic) {
      return 'The AI assistant is not configured. Please set the ANTHROPIC_API_KEY environment variable.';
    }

    try {
      // Load merchant context
      const merchant = await db.merchant.findUnique({
        where: { id: merchantId },
        include: {
          wallets: true,
          _count: { select: { orders: true } },
        },
      });

      if (!merchant) {
        return 'Merchant not found.';
      }

      const merchantContext = {
        ...merchant,
        orderCount: merchant._count.orders,
      };

      // Load conversation history (last 20 messages)
      const history = await db.chatMessage.findMany({
        where: { merchantId },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });

      // Build messages for Claude
      const messages: Anthropic.MessageParam[] = history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      messages.push({ role: 'user', content: userMessage });

      // Call Claude
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: buildSystemPrompt(merchantContext),
        messages,
      });

      const assistantMessage = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      // Save both messages to DB
      await db.chatMessage.createMany({
        data: [
          { merchantId, role: 'user', content: userMessage },
          { merchantId, role: 'assistant', content: assistantMessage },
        ],
      });

      return assistantMessage;
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
