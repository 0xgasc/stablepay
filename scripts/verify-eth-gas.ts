/**
 * Verify real ETH mainnet gas cost for: LiFi swap (ETH → USDC) + ERC-20 transfer.
 * Quotes against a live LiFi route to get accurate gasLimit estimates.
 */
import { ethers } from 'ethers';

const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const NATIVE   = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

async function main() {
  const p = new ethers.JsonRpcProvider('https://ethereum-rpc.publicnode.com');

  // Current ETH price
  const cg = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
  const ethUsd = (await cg.json() as any).ethereum.usd;
  console.log(`ETH price: $${ethUsd}`);

  // Current gas prices
  const fee = await p.getFeeData();
  const baseFeeGwei = fee.gasPrice ? Number(ethers.formatUnits(fee.gasPrice, 'gwei')) : null;
  const tipGwei    = fee.maxPriorityFeePerGas ? Number(ethers.formatUnits(fee.maxPriorityFeePerGas, 'gwei')) : null;
  const maxFeeGwei = fee.maxFeePerGas ? Number(ethers.formatUnits(fee.maxFeePerGas, 'gwei')) : null;
  console.log(`Network gas — gasPrice: ${baseFeeGwei?.toFixed(2)} gwei, priorityFee: ${tipGwei?.toFixed(2)} gwei, maxFee: ${maxFeeGwei?.toFixed(2)} gwei\n`);

  // Test wallet for the quote (just used as the from/to address)
  const testAddr = '0xa0Be283cFe7E234bE5a0555d7deCB7fAa1bdc6BE';

  // Run a real quote for a $20 worth of ETH → USDC
  const usdAmount = 20;
  const ethAmount = usdAmount / ethUsd;
  const amountWei = ethers.parseEther(ethAmount.toFixed(18));

  console.log(`Test order: $${usdAmount} = ${ethAmount.toFixed(6)} ETH = ${amountWei} wei\n`);

  const params = new URLSearchParams({
    fromChain: '1', toChain: '1',
    fromToken: NATIVE, toToken: USDC_ETH,
    fromAmount: amountWei.toString(),
    fromAddress: testAddr, toAddress: testAddr,
    slippage: '0.02', integrator: 'stablepay',
  });

  const r = await fetch(`https://li.quest/v1/quote?${params}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) {
    console.error(`LiFi quote failed: ${r.status} — ${await r.text().then(t => t.slice(0, 300))}`);
    return;
  }
  const quote = await r.json() as any;

  // Parse cost data from LiFi
  const swapGasLimit = quote.transactionRequest?.gasLimit ? BigInt(quote.transactionRequest.gasLimit) : null;
  const toAmountUsd  = quote.estimate?.toAmountUSD;
  const fromAmountUsd = quote.estimate?.fromAmountUSD;

  console.log(`LiFi route: ${quote.toolDetails?.name ?? 'unknown'}`);
  console.log(`From: $${fromAmountUsd} → To: $${toAmountUsd}`);
  console.log(`Implied slippage: ${(((Number(fromAmountUsd) - Number(toAmountUsd)) / Number(fromAmountUsd)) * 100).toFixed(3)}%`);

  // Use the LiFi-reported gas estimates if available
  if (quote.estimate?.gasCosts) {
    for (const gc of quote.estimate.gasCosts) {
      console.log(`  Gas cost: ${gc.amountUSD} USD (${gc.amount} wei, type=${gc.type})`);
    }
  }

  if (swapGasLimit && fee.gasPrice) {
    const swapCostWei = swapGasLimit * fee.gasPrice;
    const swapCostUsd = Number(ethers.formatEther(swapCostWei)) * ethUsd;
    console.log(`\nSwap tx gas — limit: ${swapGasLimit}, cost at current gas: $${swapCostUsd.toFixed(2)}`);
  }

  // ERC-20 transfer gas: USDC transfer typically uses ~50k-65k gas
  const erc20Gas = 65_000n;
  if (fee.gasPrice) {
    const erc20CostWei = erc20Gas * fee.gasPrice;
    const erc20CostUsd = Number(ethers.formatEther(erc20CostWei)) * ethUsd;
    console.log(`ERC-20 forward — limit: ${erc20Gas}, cost at current gas: $${erc20CostUsd.toFixed(2)}`);
  }

  // Total
  if (swapGasLimit && fee.gasPrice) {
    const totalWei = (swapGasLimit + erc20Gas) * fee.gasPrice;
    const totalUsd = Number(ethers.formatEther(totalWei)) * ethUsd;
    const slippageUsd = Number(fromAmountUsd) - Number(toAmountUsd);
    console.log(`\n=== TOTAL ETH MAINNET COST PER ORDER ===`);
    console.log(`Gas (swap + forward): $${totalUsd.toFixed(2)}`);
    console.log(`Slippage:             $${slippageUsd.toFixed(2)}`);
    console.log(`TOTAL:                $${(totalUsd + slippageUsd).toFixed(2)}`);
    console.log(`\nMinimum safe fee floor: $${Math.ceil((totalUsd + slippageUsd) * 1.5)}\n`);
  }

  p.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });
