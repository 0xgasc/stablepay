import { ethers } from 'ethers';
import { Keypair, Connection, VersionedTransaction, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import crypto from 'crypto';
import { db } from '../config/database';
import { logger } from '../utils/logger';

// ─── Chain config ─────────────────────────────────────────────────────────────
const NATIVE_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const WRAPPED_SOL    = 'So11111111111111111111111111111111111111112';
const SOL_RPC        = process.env.SOLANA_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com';

const EVM_CHAIN: Record<string, {
  chainId: number; rpc: string;
  stables: Record<string, string>;
  gasThreshold: string; gasFund: string;
}> = {
  // gasFund values are in native token units (MATIC on Polygon, BNB on BSC, ETH elsewhere)
  // Sized for: LiFi swap tx + ERC-20 forward tx, with buffer. Swept back to agent after use.
  BASE_MAINNET:     { chainId: 8453,  rpc: 'https://mainnet.base.org',      gasThreshold: '0.00005', gasFund: '0.0001', stables: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' } },
  ETHEREUM_MAINNET: { chainId: 1,     rpc: 'https://eth.llamarpc.com',       gasThreshold: '0.003',   gasFund: '0.005',  stables: { USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', EURC: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c' } },
  POLYGON_MAINNET:  { chainId: 137,   rpc: process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-bor-rpc.publicnode.com', gasThreshold: '0.005',   gasFund: '0.02',   stables: { USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' } },
  ARBITRUM_MAINNET: { chainId: 42161, rpc: process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com', gasThreshold: '0.00005', gasFund: '0.0001', stables: { USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' } },
  BNB_MAINNET:      { chainId: 56,    rpc: process.env.BNB_MAINNET_RPC_URL   || 'https://bsc-dataseed.binance.org', gasThreshold: '0.0005',  gasFund: '0.001',  stables: { USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', USDT: '0x55d398326f99059fF775485246999027B3197955' } },
};

// BNB chain stablecoins use 18 decimals; all others use 6
const stableDecimals = (chain: string) => chain === 'BNB_MAINNET' ? 18 : 6;

const SOL_STABLES: Record<string, string> = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address, uint256) returns (bool)',
];

// Tokens accepted as native input
// 'ARB' removed: Arbitrum's native/gas token is ETH (CHAIN_NATIVE.ARBITRUM_MAINNET='ETH'). The ARB
// governance token must never be accepted/priced as a gas-token payment (B3 — was a ~19,000x misprice).
export const NATIVE_TOKENS = new Set(['ETH', 'SOL', 'BNB', 'MATIC']);

// Which native token is expected on each chain
export const CHAIN_NATIVE: Record<string, string> = {
  BASE_MAINNET: 'ETH', ETHEREUM_MAINNET: 'ETH', ARBITRUM_MAINNET: 'ETH',
  POLYGON_MAINNET: 'MATIC',
  BNB_MAINNET: 'BNB',
  SOLANA_MAINNET: 'SOL',
};

// ─── Encryption (same as refundService) ──────────────────────────────────────
const ENC_KEY = process.env.MANAGED_WALLET_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.AGENT_WALLET_KEY;
const AGENT_KEY = process.env.AGENT_WALLET_KEY?.trim();
const SOL_AGENT_KEY_RAW = process.env.AGENT_SOLANA_KEY?.trim();

// Solana gas sponsorship: 0.005 SOL covers ATA rent + tx fees with buffer
const SOL_GAS_THRESHOLD_LAMPORTS = 2_000_000;   // 0.002 SOL
const SOL_GAS_FUND_LAMPORTS      = 5_000_000;   // 0.005 SOL

// Decode AGENT_SOLANA_KEY — supports JSON array, hex (64/128 chars), or bs58 (same as agentService)
async function getSolAgentKeypair() {
  if (!SOL_AGENT_KEY_RAW) throw new Error('AGENT_SOLANA_KEY not configured');
  if (SOL_AGENT_KEY_RAW.startsWith('[')) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(SOL_AGENT_KEY_RAW)));
  }
  if (SOL_AGENT_KEY_RAW.length === 128 || SOL_AGENT_KEY_RAW.length === 64) {
    return Keypair.fromSecretKey(new Uint8Array(Buffer.from(SOL_AGENT_KEY_RAW, 'hex')));
  }
  const bs58 = await import('bs58');
  return Keypair.fromSecretKey(bs58.default.decode(SOL_AGENT_KEY_RAW));
}

function encryptWalletKey(raw: string): string {
  if (!ENC_KEY) throw new Error('No encryption key configured');
  const iv = crypto.randomBytes(16);
  const k  = crypto.scryptSync(ENC_KEY, 'salt', 32);
  const c  = crypto.createCipheriv('aes-256-cbc', k, iv);
  return iv.toString('hex') + ':' + c.update(raw, 'utf8', 'hex') + c.final('hex');
}

function decryptWalletKey(encrypted: string): string {
  if (!ENC_KEY) throw new Error('No encryption key configured');
  const [ivHex, enc] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const k  = crypto.scryptSync(ENC_KEY, 'salt', 32);
  const d  = crypto.createDecipheriv('aes-256-cbc', k, iv);
  return d.update(enc, 'hex', 'utf8') + d.final('utf8');
}

// ─── Price feed ───────────────────────────────────────────────────────────────
const GECKO_IDS: Record<string, string> = {
  ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  // B4: 'matic-network' is dead (returns empty → no price → order creation 500). The Polygon gas
  // token is now POL; 'polygon-ecosystem-token' is its live CoinGecko id (POL≈MATIC 1:1).
  MATIC: 'polygon-ecosystem-token',
  // ARB removed (B3): Arbitrum native is ETH, never the ARB governance token.
};
const priceCache = new Map<string, { price: number; ts: number }>();

export async function getPriceUsd(symbol: string): Promise<number> {
  const hit = priceCache.get(symbol);
  if (hit && Date.now() - hit.ts < 60_000) return hit.price;

  const id = GECKO_IDS[symbol];
  if (!id) throw new Error(`Unknown token symbol: ${symbol}`);

  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
    { signal: AbortSignal.timeout(5_000) },
  );
  if (!res.ok) throw new Error(`CoinGecko error ${res.status}`);
  const data = await res.json() as Record<string, { usd: number }>;
  const price = data[id]?.usd;
  if (!price) throw new Error(`No price returned for ${symbol}`);

  priceCache.set(symbol, { price, ts: Date.now() });
  return price;
}

// ─── Conversion fee ───────────────────────────────────────────────────────────
export function calcConversionFee(usdAmount: number, chain: string): number {
  const pct = usdAmount * 0.015;
  if (chain === 'ETHEREUM_MAINNET') return Math.max(pct, 1.00); // Verified $0.35 typical cost post-blob upgrade; 3x buffer
  return Math.max(pct, 0.50); // $0.50 floor everywhere else
}

// ─── Create per-order receive wallet ─────────────────────────────────────────
export async function createNativeReceiveWallet(
  orderId: string,
  chain: string,
): Promise<string> {
  let address: string;
  let encryptedKey: string;

  const isSolana = chain.startsWith('SOLANA');
  if (isSolana) {
    const kp = Keypair.generate();
    address      = kp.publicKey.toBase58();
    encryptedKey = encryptWalletKey(Buffer.from(kp.secretKey).toString('hex'));
  } else {
    const w      = ethers.Wallet.createRandom();
    address      = w.address;
    encryptedKey = encryptWalletKey(w.privateKey);
  }

  await db.nativeReceiveWallet.create({ data: { orderId, chain, address, encryptedKey } });
  return address;
}

// ─── Gas sponsorship (EVM) ────────────────────────────────────────────────────
async function ensureGas(address: string, chain: string): Promise<void> {
  const conf = EVM_CHAIN[chain];
  if (!conf || !AGENT_KEY) throw new Error(`Cannot sponsor gas on ${chain} — AGENT_WALLET_KEY not set`);

  const provider  = new ethers.JsonRpcProvider(conf.rpc);
  const balance   = await provider.getBalance(address);
  const threshold = ethers.parseEther(conf.gasThreshold);
  if (balance >= threshold) return;

  // Dynamic gas fund — scale by current gas price vs baseline (1 gwei on L2, 10 gwei on mainnet).
  // Caps at 5x baseline so a one-off spike doesn't drain the agent.
  let fundAmt = Number(conf.gasFund);
  try {
    const feeData = await provider.getFeeData();
    if (feeData.gasPrice) {
      const currentGwei = Number(ethers.formatUnits(feeData.gasPrice, 'gwei'));
      const baseline = chain === 'ETHEREUM_MAINNET' ? 10 : 1;
      const scale = Math.min(5, Math.max(1, currentGwei / baseline));
      fundAmt = Number(conf.gasFund) * scale;
    }
  } catch { /* fall back to static */ }

  // Self-bootstrap path: if agent is empty (e.g. first order on a chain we never funded),
  // proceed anyway. The receive wallet has the customer's deposit, which usually has
  // enough native to cover swap + forward gas at L2 gas prices. The forward sweep then
  // seeds the agent for next time. Only fail if BOTH wallets are empty.
  const agent  = new ethers.Wallet(AGENT_KEY, provider);
  const agentBalance = await provider.getBalance(agent.address);
  const fundWei = ethers.parseEther(fundAmt.toFixed(18));

  if (agentBalance < fundWei) {
    if (balance > 0n) {
      logger.warn('Agent empty/low — attempting self-bootstrap with receive wallet native', {
        address, chain,
        receiveBal: ethers.formatEther(balance),
        agentBal:   ethers.formatEther(agentBalance),
      });
      return; // proceed; tx will succeed if customer over-sent enough to cover gas
    }
    throw new Error(`Agent + receive wallet both empty on ${chain} — cannot proceed`);
  }

  const fundTx = await agent.sendTransaction({ to: address, value: fundWei });
  await fundTx.wait();
  logger.info('Gas funded for native receive wallet', { address, chain, amount: fundAmt.toFixed(6) });
}

async function ensureSolGas(receivePubkey: string): Promise<void> {
  const { PublicKey, SystemProgram, Transaction } = await import('@solana/web3.js');
  const conn    = new Connection(SOL_RPC, 'confirmed');
  const target  = new PublicKey(receivePubkey);
  const balance = await conn.getBalance(target);
  if (balance >= SOL_GAS_THRESHOLD_LAMPORTS) return;

  const agent = await getSolAgentKeypair();
  const tx    = new Transaction().add(SystemProgram.transfer({
    fromPubkey: agent.publicKey, toPubkey: target, lamports: SOL_GAS_FUND_LAMPORTS,
  }));
  const sig = await conn.sendTransaction(tx, [agent]);
  await conn.confirmTransaction(sig, 'confirmed');
  logger.info('SOL gas funded', { address: receivePubkey, lamports: SOL_GAS_FUND_LAMPORTS });
}

async function sweepSolDust(receiveKp: any): Promise<void> {
  if (!SOL_AGENT_KEY_RAW) return;
  try {
    const { SystemProgram, Transaction } = await import('@solana/web3.js');
    const conn  = new Connection(SOL_RPC, 'confirmed');
    const agent = await getSolAgentKeypair();
    const bal   = await conn.getBalance(receiveKp.publicKey);
    const fee   = 10_000;
    if (bal <= fee) return;
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: receiveKp.publicKey, toPubkey: agent.publicKey, lamports: bal - fee,
    }));
    const sig = await conn.sendTransaction(tx, [receiveKp]);
    await conn.confirmTransaction(sig, 'confirmed');
    logger.info('SOL dust swept to agent', { sig, amount: bal - fee });
  } catch (e: any) { logger.warn('SOL dust sweep failed (non-critical)', { error: e.message }); }
}

// ─── LiFi EVM swap ────────────────────────────────────────────────────────────
async function executeLiFiSwap(
  chain: string, nativeAmount: number, targetStable: string, privKey: string,
): Promise<{ txHash: string; stableReceived: number }> {
  const conf     = EVM_CHAIN[chain];
  if (!conf) throw new Error(`LiFi: unsupported chain ${chain}`);
  const toToken  = conf.stables[targetStable] ?? conf.stables.USDC;
  const provider = new ethers.JsonRpcProvider(conf.rpc);
  const wallet   = new ethers.Wallet(privKey, provider);
  const amtWei   = ethers.parseEther(nativeAmount.toFixed(18));

  const params = new URLSearchParams({
    fromChain: String(conf.chainId), toChain: String(conf.chainId),
    fromToken: NATIVE_ADDRESS, toToken,
    fromAmount: amtWei.toString(),
    fromAddress: wallet.address, toAddress: wallet.address,
    slippage: '0.02', integrator: 'stablepay',
  });

  const qRes = await fetch(`https://li.quest/v1/quote?${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!qRes.ok) throw new Error(`LiFi quote failed: ${qRes.status} ${await qRes.text().then(t => t.slice(0, 200))}`);
  const quote = await qRes.json() as { transactionRequest: { to: string; data: string; value?: string; gasLimit?: string } };

  const tx = await wallet.sendTransaction({
    to:       quote.transactionRequest.to,
    data:     quote.transactionRequest.data,
    value:    BigInt(quote.transactionRequest.value   || 0),
    gasLimit: quote.transactionRequest.gasLimit ? BigInt(quote.transactionRequest.gasLimit) : undefined,
  });
  await tx.wait();

  const dec      = stableDecimals(chain);
  const contract = new ethers.Contract(toToken, ERC20_ABI, provider);
  const bal      = await contract.balanceOf(wallet.address);
  return { txHash: tx.hash, stableReceived: Number(ethers.formatUnits(bal, dec)) };
}

// ─── Jupiter Solana swap ──────────────────────────────────────────────────────
async function executeJupiterSwap(
  lamports: number, targetStable: string, secretHex: string,
): Promise<{ txHash: string; stableReceived: number }> {
  const outputMint = SOL_STABLES[targetStable] ?? SOL_STABLES.USDC;

  // B2: quote-api.jup.ag is dead (NXDOMAIN) → every SOL swap threw "fetch failed". Use the live v1
  // host; env-overridable so a future migration is config, not a redeploy. Request/response shapes
  // are identical to v6 ({quoteResponse,userPublicKey,wrapAndUnwrapSol} → {swapTransaction}).
  const JUP_BASE = process.env.JUPITER_API_BASE || 'https://lite-api.jup.ag/swap/v1';
  const qRes = await fetch(
    `${JUP_BASE}/quote?inputMint=${WRAPPED_SOL}&outputMint=${outputMint}&amount=${lamports}&slippageBps=200`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!qRes.ok) throw new Error(`Jupiter quote failed: ${qRes.status}`);
  const quoteResponse = await qRes.json();

  const keypair = Keypair.fromSecretKey(Buffer.from(secretHex, 'hex'));
  const sRes    = await fetch(`${JUP_BASE}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse, userPublicKey: keypair.publicKey.toBase58(), wrapAndUnwrapSol: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!sRes.ok) throw new Error(`Jupiter swap failed: ${sRes.status}`);
  const { swapTransaction } = await sRes.json() as { swapTransaction: string };

  const conn = new Connection(SOL_RPC, 'confirmed');
  const vtx  = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  vtx.sign([keypair]);
  const sig  = await conn.sendRawTransaction(vtx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction(sig, 'confirmed');

  const stableReceived = Number((quoteResponse as any).outAmount) / 1e6;
  return { txHash: sig, stableReceived };
}

// ─── Forward stablecoin to merchant (EVM) ────────────────────────────────────
async function forwardEvmToMerchant(
  chain: string, targetStable: string, fromPrivKey: string, toAddress: string,
): Promise<string> {
  const conf      = EVM_CHAIN[chain];
  if (!conf) throw new Error(`forwardEvm: unsupported chain ${chain}`);
  const tokenAddr = conf.stables[targetStable] ?? conf.stables.USDC;
  const provider  = new ethers.JsonRpcProvider(conf.rpc);
  const fromWallet = new ethers.Wallet(fromPrivKey, provider);
  const token      = new ethers.Contract(tokenAddr, ERC20_ABI, fromWallet);
  const bal        = await token.balanceOf(fromWallet.address);
  if (bal === BigInt(0)) throw new Error('No stablecoin balance to forward after swap');
  const tx = await token.transfer(toAddress, bal);
  await tx.wait();

  // Sweep leftover gas dust back to agent wallet so it's not stranded
  if (AGENT_KEY) {
    try {
      const dust = await provider.getBalance(fromWallet.address);
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? ethers.parseUnits('1', 'gwei');
      const sweepGasCost = gasPrice * BigInt(21_000) * BigInt(2); // 2x buffer
      if (dust > sweepGasCost) {
        const sweepTx = await fromWallet.sendTransaction({ to: new ethers.Wallet(AGENT_KEY).address, value: dust - sweepGasCost });
        await sweepTx.wait();
      }
    } catch { /* non-critical — dust stays, not worth failing the order */ }
  }

  return tx.hash;
}

// ─── Forward stablecoin to merchant (Solana) ─────────────────────────────────
async function forwardSolToMerchant(
  targetStable: string, secretHex: string, toAddress: string,
): Promise<string> {
  const { getOrCreateAssociatedTokenAccount, createTransferCheckedInstruction } = await import('@solana/spl-token');
  const { Transaction, PublicKey } = await import('@solana/web3.js');

  const mint    = new PublicKey(SOL_STABLES[targetStable] ?? SOL_STABLES.USDC);
  const keypair = Keypair.fromSecretKey(Buffer.from(secretHex, 'hex'));
  const conn    = new Connection(SOL_RPC, 'confirmed');
  const toPub   = new PublicKey(toAddress);

  const fromAta = await getOrCreateAssociatedTokenAccount(conn, keypair, mint, keypair.publicKey);
  const toAta   = await getOrCreateAssociatedTokenAccount(conn, keypair, mint, toPub);

  if (fromAta.amount === BigInt(0)) throw new Error('No stablecoin to forward on Solana');
  const tx  = new Transaction().add(
    createTransferCheckedInstruction(fromAta.address, mint, toAta.address, keypair.publicKey, fromAta.amount, 6),
  );
  const sig = await conn.sendTransaction(tx, [keypair]);
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

// ─── Main entry: swap native token → stablecoin → merchant ───────────────────
//
// Design: swap ONLY the amount needed to cover merchant's USD payout.
// The conversion fee portion stays as native and is swept back to the agent —
// the agent's gas tank is self-refunded by its own activity.
//
// Stale price guard: if order is >5 min old, re-fetch price and recompute swap split.
// On swap failure: fire 'order.swap_failed' webhook so merchant + admin know.
export async function swapAndForward(orderId: string): Promise<{ forwardTxHash: string }> {
  // Atomically mark as PROCESSING to prevent double-execution across scanner cycles
  const claimed = await db.order.updateMany({
    where: { id: orderId, status: 'PENDING' },
    data:  { status: 'PROCESSING' },
  });
  if (claimed.count === 0) throw new Error(`Order ${orderId} already processing or not pending`);

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { merchant: { select: { id: true } } },
  });
  if (!order)             throw new Error(`Order ${orderId} not found`);
  if (!order.nativeToken) throw new Error(`Order ${orderId} is not a native token order`);

  const receiveWallet = await db.nativeReceiveWallet.findUnique({ where: { orderId } });
  if (!receiveWallet) throw new Error(`No receive wallet for order ${orderId}`);

  const chain     = String(order.chain);
  const isSolana  = chain.startsWith('SOLANA');
  const privKey   = decryptWalletKey(receiveWallet.encryptedKey);
  const nativeAmt = Number(order.nativeTokenAmount ?? 0);

  const merchantWallet = await db.merchantWallet.findFirst({
    where: { merchantId: order.merchantId!, chain: order.chain, isActive: true },
  });
  if (!merchantWallet) throw new Error(`No active merchant wallet for ${chain}`);
  const targetStable = (merchantWallet as any).preferredStablecoin ?? 'USDC';

  // Stale-price guard: re-quote if snapshot >5 min old
  const orderAgeMin = (Date.now() - order.createdAt.getTime()) / 60_000;
  let nativePrice = Number(order.nativePriceSnapshot ?? 0);
  if (orderAgeMin > 5) {
    try {
      const fresh = await getPriceUsd(order.nativeToken);
      logger.info('Refreshed stale price snapshot', { orderId, ageMin: orderAgeMin.toFixed(1), oldPrice: nativePrice, newPrice: fresh });
      nativePrice = fresh;
    } catch (e) { logger.warn('Stale price re-quote failed, using snapshot', { orderId, error: (e as Error).message }); }
  }
  if (nativePrice <= 0) throw new Error('Invalid native price for swap split');

  // Split: swap ONLY merchant_amount_usd worth (with 1% slippage buffer); rest stays as native fee
  const merchantUsd        = Number(order.amount);
  const slippageBuffer     = 1.01;
  const swapNativeTarget   = Math.min(nativeAmt, (merchantUsd * slippageBuffer) / nativePrice);
  const retainedNative     = nativeAmt - swapNativeTarget;

  logger.info('swapAndForward split', { orderId, nativeAmt, swapNativeTarget, retainedNative, merchantUsd, nativePrice });

  // Idempotency anchor against sequential double-swap: the order's nativeTokenAmount is a
  // snapshot from when funds were first detected. If a prior swap (a retry after a
  // mined-but-errored attempt, or the scanner's PROCESSING→PENDING revert) already consumed
  // the wallet, re-swapping would drain it twice. Re-read the LIVE balance and refuse if it
  // can no longer fund this swap. Protects every caller (live scanner + auto-recovery).
  const liveNativeBal = await getReceiveWalletBalance(receiveWallet.address, chain);
  if (swapNativeTarget > 0 && liveNativeBal + 1e-9 < swapNativeTarget) {
    throw new Error(`swapAndForward: live balance ${liveNativeBal} < required ${swapNativeTarget} on ${chain} — prior swap likely already executed; refusing to re-swap (E_ALREADY_SWEPT)`);
  }

  let swapTxHash: string;
  let stableReceived: number;
  let forwardTxHash: string;

  try {
    if (isSolana) {
      await ensureSolGas(receiveWallet.address);
      const lamports = Math.round(swapNativeTarget * 1e9);
      if (lamports <= 0) throw new Error('SOL swap amount is zero');
      ({ txHash: swapTxHash, stableReceived } = await executeJupiterSwap(lamports, targetStable, privKey));
      await ensureSolGas(receiveWallet.address);
      forwardTxHash = await forwardSolToMerchant(targetStable, privKey, merchantWallet.address);
      // Sweep retained native SOL back to agent (this is our retained fee)
      const receiveKp = Keypair.fromSecretKey(Buffer.from(privKey, 'hex'));
      await sweepSolDust(receiveKp);
    } else {
      await ensureGas(receiveWallet.address, chain);
      ({ txHash: swapTxHash, stableReceived } = await executeLiFiSwap(chain, swapNativeTarget, targetStable, privKey));
      // After swap, native balance is whatever wasn't swapped + leftover gas; ensureGas tops up for ERC-20 forward
      await ensureGas(receiveWallet.address, chain);
      forwardTxHash = await forwardEvmToMerchant(chain, targetStable, privKey, merchantWallet.address);
      // The forwardEvmToMerchant already sweeps remaining native back to agent (the retained native fee)
    }
  } catch (swapErr) {
    // Fire merchant webhook so they know the payment came in but couldn't be processed
    try {
      const { webhookService } = await import('./webhookService');
      if (order.merchantId) {
        webhookService.sendWebhook(order.merchantId, 'order.swap_failed', {
          orderId, chain, nativeToken: order.nativeToken,
          nativeAmountReceived: nativeAmt, error: (swapErr as Error).message,
          paymentAddress: order.paymentAddress,
        }).catch(() => {});
      }
    } catch { /* webhook is best-effort */ }
    throw swapErr;
  }

  logger.info('swapAndForward complete', { orderId, chain, nativeAmt, swapNativeTarget, retainedNative, stableReceived, swapTxHash, forwardTxHash });
  return { forwardTxHash };
}

// ─── Native balance + refund (shared by admin endpoint + auto-recovery) ─────────
// Read the current native balance of a receive wallet (EVM or Solana), in whole units.
// Returns 0 on any RPC error (caller treats unknown as "nothing to do").
export async function getReceiveWalletBalance(address: string, chain: string): Promise<number> {
  try {
    if (chain.startsWith('SOLANA')) {
      const conn = new Connection(SOL_RPC, 'confirmed');
      const lamports = await conn.getBalance(new PublicKey(address));
      return lamports / 1e9;
    }
    const conf = EVM_CHAIN[chain];
    if (!conf) return 0;
    const p = new ethers.JsonRpcProvider(conf.rpc);
    try {
      return Number(ethers.formatEther(await p.getBalance(address)));
    } finally {
      p.destroy();
    }
  } catch (e) {
    logger.warn('getReceiveWalletBalance: RPC read failed, treating as 0 (skip, NOT confirmed-empty)', { address, chain, error: (e as Error).message });
    return 0;
  }
}

// Validate a refund/forward destination for a chain (EVM checksum or Solana base58).
export function isValidNativeAddress(addr: string | null | undefined, chain: string): boolean {
  if (!addr || typeof addr !== 'string') return false;
  if (chain.startsWith('SOLANA')) {
    try { new PublicKey(addr); return true; } catch { return false; }
  }
  return ethers.isAddress(addr);
}

// Sweep an order's receive-wallet native balance (minus gas) to a destination, then mark REFUNDED.
// Single source of truth for BOTH the admin manual refund and the auto-recovery loop. Uses
// decryptWalletKey (scrypt) — the SAME KDF encryptWalletKey/swapAndForward use, so it actually
// decrypts the stored key (the old inline admin refund used sha256 and never decrypted correctly).
export async function refundNativeToAddress(
  orderId: string,
  destinationAddress: string,
): Promise<{ txHash: string; amount: string }> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (!order.nativeToken) throw new Error(`Order ${orderId} is not a native token order`);
  const wallet = await db.nativeReceiveWallet.findUnique({ where: { orderId } });
  if (!wallet) throw new Error(`No receive wallet for order ${orderId}`);

  const chain = String(order.chain);

  // Validate destination BEFORE any state change — a bad/wrong-chain/self address must never
  // leave the order claimed-REFUNDED with funds stranded (the admin endpoint can pass arbitrary input).
  if (!isValidNativeAddress(destinationAddress, chain)) {
    throw new Error(`refundNativeToAddress: invalid destination address for ${chain}`);
  }
  const sameWallet = chain.startsWith('SOLANA')
    ? destinationAddress === wallet.address
    : destinationAddress.toLowerCase() === wallet.address.toLowerCase();
  if (sameWallet) throw new Error('refundNativeToAddress: destination equals the receive wallet (self-send)');

  // Pre-check: the wallet must actually hold funds (avoid claiming an empty/already-swept order).
  const liveBal = await getReceiveWalletBalance(wallet.address, chain);
  if (liveBal <= 0.0001) throw new Error('No funds to refund (receive wallet empty)');

  // At-most-once: atomically claim REFUNDED BEFORE broadcasting. If another path (a concurrent
  // cycle or the admin endpoint) already settled/refunded the order, abort — this guarantees we
  // never broadcast two refunds for one order even under RPC flakiness / status-write failures.
  const claim = await db.order.updateMany({
    where: { id: orderId, status: { notIn: ['REFUNDED', 'CONFIRMED', 'CANCELLED'] } },
    data: { status: 'REFUNDED' },
  });
  if (claim.count === 0) throw new Error(`Order ${orderId} not in a refundable state (already settled or refunded)`);

  const privKey = decryptWalletKey(wallet.encryptedKey);
  let txHash = '';
  let amount = '0';
  try {
    if (chain.startsWith('SOLANA')) {
      const conn = new Connection(SOL_RPC, 'confirmed');
      const kp = Keypair.fromSecretKey(Buffer.from(privKey, 'hex'));
      const bal = await conn.getBalance(kp.publicKey);
      const fee = 10_000; // lamports — leaves enough for the transfer fee
      if (bal <= fee) throw new Error('No funds to refund (below Solana tx fee)');
      const lamports = bal - fee;
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: kp.publicKey, toPubkey: new PublicKey(destinationAddress), lamports,
      }));
      txHash = await conn.sendTransaction(tx, [kp]);
      await conn.confirmTransaction(txHash, 'confirmed');
      amount = (lamports / 1e9).toString();
    } else {
      const conf = EVM_CHAIN[chain];
      if (!conf) throw new Error(`refundNativeToAddress: unsupported chain ${chain}`);
      const provider = new ethers.JsonRpcProvider(conf.rpc);
      try {
        const signer = new ethers.Wallet(privKey, provider);
        const bal = await provider.getBalance(signer.address);
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice ?? ethers.parseUnits('1', 'gwei');
        const gasCost = gasPrice * BigInt(21_000) * BigInt(2); // 2x buffer
        if (bal <= gasCost) throw new Error('Not enough funds to cover refund gas');
        const value = bal - gasCost;
        const tx = await signer.sendTransaction({ to: destinationAddress, value });
        await tx.wait();
        txHash = tx.hash;
        amount = ethers.formatEther(value);
      } finally {
        provider.destroy();
      }
    }
  } catch (sendErr) {
    // We already claimed REFUNDED. Distinguish two failure shapes so a human isn't misled into
    // a manual double-refund:
    //   • txHash set  → the transfer was BROADCAST and only confirmation failed; it may well have
    //     landed. Record the hash and tell ops to verify on-chain BEFORE any manual action.
    //   • txHash empty → nothing was sent; funds remain in the wallet (manual review).
    // Either way we do NOT revert the REFUNDED claim (at-most-once).
    const broadcast = !!txHash;
    const m: any = (order.metadata && typeof order.metadata === 'object') ? { ...(order.metadata as any) } : {};
    m.recovery = {
      ...(m.recovery || {}),
      refundError: ((sendErr as Error).message || '').slice(0, 300),
      ...(broadcast ? { refundBroadcastUnconfirmed: true, refundTxHash: txHash } : { refundClaimedButFailed: true }),
    };
    await db.order.update({ where: { id: orderId }, data: { metadata: m } }).catch(() => {});
    logger.error(
      broadcast
        ? 'refundNativeToAddress: refund BROADCAST but confirmation failed — VERIFY tx on-chain before any manual refund'
        : 'refundNativeToAddress: claimed REFUNDED but send FAILED (no broadcast) — funds still in wallet, MANUAL review',
      sendErr as Error, { orderId, destinationAddress, chain, txHash },
    );
    throw sendErr;
  }

  // Record the refund tx for idempotency/audit.
  const m: any = (order.metadata && typeof order.metadata === 'object') ? { ...(order.metadata as any) } : {};
  m.recovery = { ...(m.recovery || {}), refundTxHash: txHash, refundedAt: new Date().toISOString() };
  await db.order.update({ where: { id: orderId }, data: { metadata: m } }).catch(() => {});

  logger.security('Native refund executed', { orderId, destinationAddress, txHash, amount, chain, event: 'native.refund' });
  return { txHash, amount };
}
