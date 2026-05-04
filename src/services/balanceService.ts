/**
 * Balance proxy. The frontend can't reliably hit Solana / EVM RPCs from a browser:
 *   - Public Solana RPC (api.mainnet-beta) rate-limits aggressively and returns
 *     {error} instead of {result} when over quota — looks like 0 USDC to a parser.
 *   - Browser CORS preflight + Phantom in-app browser eat extra request budget.
 *   - Frontend re-fetches on every chain/token toggle, hammering the same IP.
 *
 * Server-side we own the egress IP, can use paid RPCs via env, and cache. So the
 * checkout page calls our /api/embed/balance instead of talking to Solana directly.
 *
 * Caching: 15s TTL keyed by (chain, owner, token). Long enough to absorb a flurry of
 * frontend re-renders, short enough that a customer who just topped up their wallet
 * sees the new balance after one refresh.
 */
import { ethers } from 'ethers';
import { CHAIN_CONFIGS } from '../config/chains';
import type { Chain } from '../types';
import { withProvider } from './rpcProvider';
import { logger } from '../utils/logger';

const SOLANA_RPC_FALLBACKS = [
  'https://solana-rpc.publicnode.com',
  'https://rpc.ankr.com/solana',
];

const SPL_DECIMALS: Record<string, number> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6, // USDC
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6, // USDT
};

interface CacheEntry { value: { balance: number; decimals: number; source: string }; expiresAt: number; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15_000;

function cacheKey(chain: string, owner: string, token: string): string {
  return `${chain}:${owner.toLowerCase()}:${token.toLowerCase()}`;
}

async function fetchSolanaTokenBalance(owner: string, mint: string): Promise<{ balance: number; decimals: number; source: string }> {
  const primary = process.env.SOLANA_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const rpcs = [primary, ...SOLANA_RPC_FALLBACKS];

  let lastErr: Error | null = null;
  for (const rpc of rpcs) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
          params: [owner, { mint }, { encoding: 'jsonParsed' }],
        }),
      });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status} from ${rpc}`); continue; }
      const data = await res.json() as any;
      if (data?.error) { lastErr = new Error(`RPC error from ${rpc}: ${data.error.message || JSON.stringify(data.error)}`); continue; }
      if (!data?.result) { lastErr = new Error(`RPC empty from ${rpc}`); continue; }
      const accounts: any[] = data.result.value || [];
      const balance = accounts.reduce((sum, a) => {
        const ui = a?.account?.data?.parsed?.info?.tokenAmount?.uiAmountString;
        return sum + (ui ? parseFloat(ui) : 0);
      }, 0);
      const decimals = SPL_DECIMALS[mint] ?? 6;
      return { balance, decimals, source: rpc };
    } catch (err) {
      lastErr = err as Error;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr ?? new Error('All Solana RPCs failed');
}

async function fetchEvmTokenBalance(chain: Chain, owner: string, tokenAddress: string): Promise<{ balance: number; decimals: number; source: string }> {
  return withProvider(chain, async (provider) => {
    const erc20 = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
      provider,
    );
    const [raw, decimalsBn] = await Promise.all([
      erc20.balanceOf!(owner),
      erc20.decimals!().catch(() => 6),
    ]);
    const decimals = typeof decimalsBn === 'bigint' ? Number(decimalsBn) : Number(decimalsBn || 6);
    const balance = parseFloat(ethers.formatUnits(raw, decimals));
    return { balance, decimals, source: 'rpcProvider' };
  });
}

export async function getTokenBalance(chain: string, owner: string, token: string): Promise<{ balance: number; decimals: number; source: string; cached: boolean }> {
  const key = cacheKey(chain, owner, token);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { ...hit.value, cached: true };
  }

  let result;
  if (chain === 'SOLANA_MAINNET' || chain === 'SOLANA_DEVNET') {
    result = await fetchSolanaTokenBalance(owner, token);
  } else if (chain === 'TRON_MAINNET') {
    // TRON uses TronGrid (not EVM JSON-RPC) and we don't expose a connect-wallet flow for it
    // anyway — payments come in via manual send. Throwing here means /balance returns 503 →
    // frontend treats it as "couldn't verify" → never falsely blocks the customer.
    throw new Error('TRON balance check unsupported (manual send only)');
  } else if (Object.prototype.hasOwnProperty.call(CHAIN_CONFIGS, chain)) {
    result = await fetchEvmTokenBalance(chain as Chain, owner, token);
  } else {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  cache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return { ...result, cached: false };
}

export function clearBalanceCache(): void {
  cache.clear();
  logger.info('Balance cache cleared', { event: 'balance.cache_cleared' });
}
