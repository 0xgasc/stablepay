/**
 * Resilient EVM RPC provider.
 *
 * Cycles through `rpcUrl` + `rpcFallbacks` until one responds. A single llamarpc/Cloudflare
 * 403 previously caused the scanner to silently drop Transfer queries — dropping real
 * payments on the floor. Always compose providers through this helper.
 *
 * Design notes:
 *  - Healthy providers are cached in-process per chain (60s TTL) so we don't re-probe on every call.
 *  - "Healthy" = responded to a cheap getBlockNumber() once within the TTL. We re-validate on failure.
 *  - On call failure (403/429/5xx/network), we mark the current provider unhealthy and rotate.
 *  - Never fall back to chain-config.paymentAddress or any write path — this is read-only RPC.
 */
import { ethers } from 'ethers';
import { CHAIN_CONFIGS } from '../config/chains';
import type { Chain } from '../types';
import { logger } from '../utils/logger';

interface CachedProvider {
  url: string;
  provider: ethers.JsonRpcProvider;
  healthyUntil: number;
}

const cache: Partial<Record<Chain, CachedProvider>> = {};
const CACHE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 4_000;

function allUrlsFor(chain: Chain): string[] {
  const cfg = CHAIN_CONFIGS[chain];
  if (!cfg) return [];
  return [cfg.rpcUrl, ...(cfg.rpcFallbacks || [])].filter(Boolean);
}

async function probe(url: string): Promise<ethers.JsonRpcProvider | null> {
  try {
    const p = new ethers.JsonRpcProvider(url);
    // Race a cheap read against a timeout so a hanging RPC doesn't block the request.
    const block = await Promise.race([
      p.getBlockNumber(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('probe timeout')), PROBE_TIMEOUT_MS)),
    ]);
    if (typeof block !== 'number' || block < 1) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Returns a healthy provider for the chain. Tries cached first, else probes fallbacks in order.
 * Throws if nothing responds — callers should treat that as a transient infra failure, not a
 * "payment doesn't exist" signal.
 */
export async function getHealthyProvider(chain: Chain): Promise<ethers.JsonRpcProvider> {
  const cached = cache[chain];
  if (cached && Date.now() < cached.healthyUntil) {
    return cached.provider;
  }

  const urls = allUrlsFor(chain);
  for (const url of urls) {
    const p = await probe(url);
    if (p) {
      if (cached && cached.url !== url) {
        logger.warn('EVM RPC rotated — primary failed probe', {
          chain, previousUrl: cached.url, newUrl: url, event: 'rpc.rotated',
        });
      }
      cache[chain] = { url, provider: p, healthyUntil: Date.now() + CACHE_TTL_MS };
      return p;
    } else {
      logger.warn('EVM RPC probe failed', { chain, url, event: 'rpc.probe_failed' });
    }
  }

  delete cache[chain];
  throw new Error(`No healthy RPC for ${chain} — tried ${urls.length} endpoints`);
}

/**
 * Run `fn` against a healthy provider. If the call fails mid-way (likely Cloudflare rate-limit
 * or connection reset), evict the cached provider and retry once on the next fallback. We do NOT
 * retry indefinitely — a persistent failure after rotation is more likely a real on-chain
 * issue (bad hash, reverted tx) than an RPC problem.
 */
export async function withProvider<T>(
  chain: Chain,
  fn: (provider: ethers.JsonRpcProvider) => Promise<T>,
): Promise<T> {
  const provider = await getHealthyProvider(chain);
  try {
    return await fn(provider);
  } catch (err: any) {
    const message = String(err?.message || err);
    const status = err?.info?.responseStatus || err?.status || 0;
    const retryable =
      status === 403 || status === 429 || (status >= 500 && status < 600) ||
      /timeout|ETIMEDOUT|ECONNRESET|network/i.test(message);
    if (!retryable) throw err;

    logger.warn('EVM RPC call failed, rotating', {
      chain, failedUrl: cache[chain]?.url, status, message: message.slice(0, 200), event: 'rpc.rotate_on_error',
    });
    delete cache[chain];
    const second = await getHealthyProvider(chain);
    return fn(second);
  }
}
