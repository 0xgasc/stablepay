/**
 * distribute-gas.ts
 * Cross-chain gas distribution for the StablePay agent wallet.
 *
 * Usage: npx ts-node scripts/distribute-gas.ts [--dry-run]
 *
 * Reads AGENT_WALLET_KEY from .env.
 * Bridges ETH from Base to Arbitrum, Polygon (→MATIC), BNB Chain (→BNB).
 * ETH mainnet must be funded directly — bridging from Base to mainnet is slow & expensive.
 */

import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';

const DRY = process.argv.includes('--dry-run');

const AGENT_KEY  = process.env.AGENT_WALLET_KEY?.trim();
const AGENT_ADDR = process.env.AGENT_WALLET_ADDRESS?.trim();
if (!AGENT_KEY || !AGENT_ADDR) { console.error('AGENT_WALLET_KEY / AGENT_WALLET_ADDRESS not set'); process.exit(1); }

const CHAINS = {
  BASE:     { chainId: 8453,  rpc: 'https://mainnet.base.org',                name: 'Base',     native: 'ETH'  },
  ARBITRUM: { chainId: 42161, rpc: 'https://arbitrum-one-rpc.publicnode.com', name: 'Arbitrum', native: 'ETH'  },
  POLYGON:  { chainId: 137,   rpc: 'https://polygon-rpc.com',                 name: 'Polygon',  native: 'MATIC' },
  BNB:      { chainId: 56,    rpc: 'https://bsc-dataseed.binance.org',         name: 'BNB Chain', native: 'BNB' },
  ETH:      { chainId: 1,     rpc: 'https://eth.llamarpc.com',                 name: 'Ethereum', native: 'ETH'  },
};

// How much ETH to bridge FROM Base to each destination (in ETH, from-chain units)
const BRIDGE_PLAN: Record<string, string> = {
  ARBITRUM: '0.004',  // → ~0.004 ETH on Arbitrum  (covers ~40 gas sponsorships)
  POLYGON:  '0.004',  // → ~16+ MATIC on Polygon    (covers ~800 gas sponsorships at 0.02 MATIC each)
  BNB:      '0.004',  // → ~0.006 BNB on BNB Chain  (covers ~6 gas sponsorships at 0.001 BNB each)
  // Keep ~0.018 ETH on Base for Base gas sponsorships
};

const NATIVE_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

async function getBalance(chainKey: string) {
  const conf = CHAINS[chainKey as keyof typeof CHAINS];
  const p = new ethers.JsonRpcProvider(conf.rpc);
  const bal = await p.getBalance(AGENT_ADDR!);
  return { eth: Number(ethers.formatEther(bal)), wei: bal };
}

async function getLiFiCrossChainQuote(fromChainId: number, toChainId: number, amountWei: string) {
  const params = new URLSearchParams({
    fromChain: String(fromChainId),
    toChain:   String(toChainId),
    fromToken: NATIVE_ADDR,
    toToken:   NATIVE_ADDR,
    fromAmount: amountWei,
    fromAddress: AGENT_ADDR!,
    toAddress:   AGENT_ADDR!,
    slippage: '0.02',
    integrator: 'stablepay',
  });
  const r = await fetch(`https://li.quest/v1/quote?${params}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`LiFi quote failed: ${r.status} ${await r.text().then(t => t.slice(0, 300))}`);
  return r.json() as Promise<{ transactionRequest: { to: string; data: string; value?: string; gasLimit?: string }; estimate: { toAmount: string } }>;
}

async function main() {
  console.log(`\n=== StablePay Gas Distribution ${DRY ? '[DRY RUN]' : '[LIVE]'} ===`);
  console.log(`Agent wallet: ${AGENT_ADDR}\n`);

  // Print current balances
  for (const [key, conf] of Object.entries(CHAINS)) {
    try {
      const { eth } = await getBalance(key);
      console.log(`  ${conf.name.padEnd(12)} ${eth.toFixed(6)} ${conf.native}`);
    } catch { console.log(`  ${conf.name.padEnd(12)} [RPC error]`); }
  }

  const baseConf = CHAINS.BASE;
  const baseProvider = new ethers.JsonRpcProvider(baseConf.rpc);
  const { eth: baseBalance } = await getBalance('BASE');

  // Calculate total bridging amount
  const totalBridge = Object.values(BRIDGE_PLAN).reduce((s, v) => s + Number(v), 0);
  const remaining = baseBalance - totalBridge;

  console.log(`\nBase balance: ${baseBalance.toFixed(6)} ETH`);
  console.log(`Total to bridge: ${totalBridge.toFixed(4)} ETH`);
  console.log(`Remaining on Base: ${remaining.toFixed(4)} ETH`);

  if (baseBalance < totalBridge + 0.002) {
    console.error('\nInsufficient Base balance. Need at least ' + (totalBridge + 0.002).toFixed(4) + ' ETH on Base.');
    console.error(`Current: ${baseBalance.toFixed(6)} ETH`);
    process.exit(1);
  }

  if (DRY) {
    console.log('\n[DRY RUN] Would execute the following bridges:');
    for (const [dest, amount] of Object.entries(BRIDGE_PLAN)) {
      const toConf = CHAINS[dest as keyof typeof CHAINS];
      console.log(`  Base → ${toConf.name}: ${amount} ETH → ${toConf.native}`);
    }
    console.log('\nRun without --dry-run to execute.');
    return;
  }

  const agentWallet = new ethers.Wallet(AGENT_KEY!, baseProvider);

  for (const [dest, amountEth] of Object.entries(BRIDGE_PLAN)) {
    const toConf = CHAINS[dest as keyof typeof CHAINS];
    const amountWei = ethers.parseEther(amountEth).toString();

    console.log(`\n→ Bridging ${amountEth} ETH from Base to ${toConf.name} (${toConf.native})...`);
    try {
      const quote = await getLiFiCrossChainQuote(baseConf.chainId, toConf.chainId, amountWei);
      const expectedOut = Number(ethers.formatEther(quote.estimate.toAmount));
      console.log(`  Expected output: ${expectedOut.toFixed(6)} ${toConf.native}`);

      const tx = await agentWallet.sendTransaction({
        to:       quote.transactionRequest.to,
        data:     quote.transactionRequest.data,
        value:    BigInt(quote.transactionRequest.value || 0),
        gasLimit: quote.transactionRequest.gasLimit ? BigInt(quote.transactionRequest.gasLimit) : undefined,
      });
      console.log(`  Tx submitted: ${tx.hash}`);
      await tx.wait();
      console.log(`  ✓ Confirmed`);
    } catch (e: any) {
      console.error(`  ✗ Failed: ${e.message}`);
    }
  }

  console.log('\n=== Done. Final balances (allow 2-5 min for bridges to settle): ===');
  for (const [key, conf] of Object.entries(CHAINS)) {
    try {
      const { eth } = await getBalance(key);
      console.log(`  ${conf.name.padEnd(12)} ${eth.toFixed(6)} ${conf.native}`);
    } catch { console.log(`  ${conf.name.padEnd(12)} [RPC error]`); }
  }
  console.log('\nETH mainnet: fund directly — bridge from Base takes 7 days via official bridge.');
  console.log('Solana: no agent wallet needed (NativeReceiveWallet self-funds from customer SOL reserve).');
}

main().catch(e => { console.error(e); process.exit(1); });
