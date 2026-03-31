import { ethers } from 'ethers';
import crypto from 'crypto';
import { db } from '../config/database';
import { logger } from '../utils/logger';

const ENCRYPTION_KEY = process.env.JWT_SECRET || process.env.AGENT_WALLET_KEY?.trim();
const AGENT_WALLET_KEY = process.env.AGENT_WALLET_KEY?.trim();

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address, uint256) returns (bool)',
  'function approve(address, uint256) returns (bool)',
];

const CHAIN_RPC: Record<string, { rpc: string; tokens: Record<string, string>; native: string }> = {
  BASE_MAINNET: { rpc: process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org', native: 'ETH', tokens: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' } },
  ETHEREUM_MAINNET: { rpc: process.env.ETHEREUM_MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com', native: 'ETH', tokens: { USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', EURC: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c' } },
  POLYGON_MAINNET: { rpc: process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-bor-rpc.publicnode.com', native: 'MATIC', tokens: { USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' } },
  ARBITRUM_MAINNET: { rpc: process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com', native: 'ETH', tokens: { USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' } },
};

// Circle CCTP v2 contracts (same deterministic address on all chains via CREATE2)
const CCTP_TOKEN_MESSENGER_V2 = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';
const CCTP_MESSAGE_TRANSMITTER_V2 = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

const CCTP_DOMAINS: Record<string, number> = {
  ETHEREUM_MAINNET: 0,
  ARBITRUM_MAINNET: 3,
  BASE_MAINNET: 6,
  POLYGON_MAINNET: 7,
};

const TOKEN_MESSENGER_V2_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64)',
];

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

function addressToBytes32(address: string): string {
  return '0x' + address.slice(2).padStart(64, '0');
}

export interface ConsolidationResult {
  success: boolean;
  transfers: { chain: string; token: string; amount: string; txHash: string; type: 'direct' | 'cctp' }[];
  errors: string[];
  totalConsolidated: number;
}

export class ConsolidationService {

  /**
   * Sponsor gas to a managed wallet if needed
   */
  private async sponsorGas(chain: string, targetAddress: string): Promise<string | null> {
    if (!AGENT_WALLET_KEY) return null;

    const conf = CHAIN_RPC[chain];
    if (!conf) return null;

    const provider = new ethers.JsonRpcProvider(conf.rpc);
    const balance = await provider.getBalance(targetAddress);

    if (balance >= ethers.parseEther('0.0005')) return null; // Has enough gas

    const agentWallet = new ethers.Wallet(AGENT_WALLET_KEY, provider);
    const agentBalance = await provider.getBalance(agentWallet.address);

    if (agentBalance < ethers.parseEther('0.002')) {
      throw new Error(`Agent wallet needs funding on ${chain}. Address: ${agentWallet.address}, Balance: ${ethers.formatEther(agentBalance)} ${conf.native}`);
    }

    const gasTx = await agentWallet.sendTransaction({
      to: targetAddress,
      value: ethers.parseEther('0.001'),
    });
    await gasTx.wait();
    return gasTx.hash;
  }

  /**
   * Consolidate all managed wallet earnings to one destination
   */
  async consolidateEarnings(
    merchantId: string,
    toAddress: string,
    toChain: string,
    tokenName: string = 'USDC'
  ): Promise<ConsolidationResult> {
    const result: ConsolidationResult = { success: true, transfers: [], errors: [], totalConsolidated: 0 };

    // Get all managed wallets for this merchant
    const managedWallets = await db.managedWallet.findMany({
      where: { merchantId },
    });

    if (managedWallets.length === 0) {
      result.errors.push('No managed wallets found');
      result.success = false;
      return result;
    }

    for (const mw of managedWallets) {
      const chain = mw.chain;
      const conf = CHAIN_RPC[chain];
      if (!conf) continue;

      const tokenAddress = conf.tokens[tokenName];
      if (!tokenAddress) continue;

      try {
        const provider = new ethers.JsonRpcProvider(conf.rpc);
        const privateKey = decryptKey(mw.encryptedKey).trim();
        const wallet = new ethers.Wallet(privateKey, provider);

        // Check token balance
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
        const balance = await tokenContract.balanceOf(mw.address);
        const amount = parseFloat(ethers.formatUnits(balance, 6));

        if (amount < 0.01) continue; // Skip dust

        // Sponsor gas if needed
        try {
          const gasTxHash = await this.sponsorGas(chain, mw.address);
          if (gasTxHash) {
            logger.info('Gas sponsored for consolidation', { chain, gasTxHash, wallet: mw.address });
          }
        } catch (gasErr: any) {
          result.errors.push(`Gas sponsorship failed on ${chain}: ${gasErr.message}`);
          continue;
        }

        if (chain === toChain) {
          // Same chain — direct transfer
          const tx = await tokenContract.transfer(toAddress, balance);
          await tx.wait();

          result.transfers.push({ chain, token: tokenName, amount: amount.toFixed(2), txHash: tx.hash, type: 'direct' });
          result.totalConsolidated += amount;

          logger.info('Consolidation: direct transfer', {
            merchantId, chain, token: tokenName, amount, txHash: tx.hash, to: toAddress,
          });
        } else if (tokenName === 'USDC' && CCTP_DOMAINS[chain] !== undefined && CCTP_DOMAINS[toChain] !== undefined) {
          // Cross-chain USDC via CCTP
          const cctpResult = await this.bridgeViaCCTP(wallet, chain, toChain, toAddress, balance);
          result.transfers.push({ chain, token: 'USDC', amount: amount.toFixed(2), txHash: cctpResult.txHash, type: 'cctp' });
          result.totalConsolidated += amount;

          logger.info('Consolidation: CCTP bridge', {
            merchantId, fromChain: chain, toChain, amount, txHash: cctpResult.txHash,
          });
        } else {
          // Cross-chain non-USDC — transfer to merchant's wallet on same chain
          // They'll need to bridge manually for non-USDC tokens
          const tx = await tokenContract.transfer(toAddress, balance);
          await tx.wait();

          result.transfers.push({ chain, token: tokenName, amount: amount.toFixed(2), txHash: tx.hash, type: 'direct' });
          result.totalConsolidated += amount;
          result.errors.push(`${tokenName} on ${chain} sent to ${toAddress} on same chain (cross-chain bridge only supports USDC via CCTP)`);
        }
      } catch (err: any) {
        result.errors.push(`${chain}: ${err.message}`);
      }
    }

    // Also check merchant's own wallets (non-managed) — just report balances
    if (result.transfers.length === 0 && result.errors.length === 0) {
      result.errors.push('No funds found in managed wallets to consolidate');
      result.success = false;
    }

    return result;
  }

  /**
   * Bridge USDC from one chain to another via Circle CCTP
   */
  async bridgeViaCCTP(
    wallet: ethers.Wallet,
    fromChain: string,
    toChain: string,
    toAddress: string,
    amount: bigint
  ): Promise<{ txHash: string; burnTx: string }> {
    const fromDomain = CCTP_DOMAINS[fromChain];
    const toDomain = CCTP_DOMAINS[toChain];
    const chainConf = CHAIN_RPC[fromChain];

    if (fromDomain === undefined || toDomain === undefined || !chainConf) {
      throw new Error(`CCTP not supported for ${fromChain} → ${toChain}`);
    }

    const usdcAddress = chainConf.tokens.USDC;
    if (!usdcAddress) throw new Error(`No USDC on ${fromChain}`);

    // Step 1: Approve TokenMessenger v2 to spend USDC
    const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, wallet);
    const approveTx = await usdc.approve(CCTP_TOKEN_MESSENGER_V2, amount);
    await approveTx.wait();

    // Step 2: Call depositForBurn (v2 — includes destinationCaller, maxFee, minFinalityThreshold)
    const messenger = new ethers.Contract(CCTP_TOKEN_MESSENGER_V2, TOKEN_MESSENGER_V2_ABI, wallet);
    const mintRecipient = addressToBytes32(toAddress);
    const zeroCaller = ethers.zeroPadValue('0x', 32); // Allow anyone to relay
    const maxFee = 0; // No fee cap
    const minFinality = 1000; // Fast Transfer mode

    const burnTx = await messenger.depositForBurn(
      amount,
      toDomain,
      mintRecipient,
      usdcAddress,
      zeroCaller,
      maxFee,
      minFinality
    );
    await burnTx.wait();

    logger.info('CCTP v2 burn initiated', {
      fromChain, toChain, amount: ethers.formatUnits(amount, 6),
      burnTxHash: burnTx.hash, toAddress, fromDomain, toDomain,
    });

    // Circle's attestation service monitors the burn event and auto-mints on destination.
    // Fast Transfer mode (~seconds). Track via: https://iris-api.circle.com/v2/messages/{fromDomain}?transactionHash={txHash}
    return { txHash: burnTx.hash, burnTx: burnTx.hash };
  }

  /**
   * Bridge USDC using a merchant's managed wallet
   */
  async bridgeFromManagedWallet(
    merchantId: string,
    fromChain: string,
    toChain: string,
    toAddress: string,
    amount: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const managedWallet = await db.managedWallet.findUnique({
      where: { merchantId_chain: { merchantId, chain: fromChain } },
    });

    if (!managedWallet) {
      return { success: false, error: `No managed wallet on ${fromChain}` };
    }

    const conf = CHAIN_RPC[fromChain];
    if (!conf) return { success: false, error: `Unsupported chain: ${fromChain}` };

    try {
      // Sponsor gas
      await this.sponsorGas(fromChain, managedWallet.address);

      const provider = new ethers.JsonRpcProvider(conf.rpc);
      const privateKey = decryptKey(managedWallet.encryptedKey).trim();
      const wallet = new ethers.Wallet(privateKey, provider);

      const amountRaw = ethers.parseUnits(amount.toString(), 6);

      // Check balance
      const usdc = new ethers.Contract(conf.tokens.USDC, ERC20_ABI, wallet);
      const balance = await usdc.balanceOf(managedWallet.address);
      if (balance < amountRaw) {
        return { success: false, error: `Insufficient USDC. Available: $${ethers.formatUnits(balance, 6)}` };
      }

      const result = await this.bridgeViaCCTP(wallet, fromChain, toChain, toAddress, amountRaw);

      return { success: true, txHash: result.txHash };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

export const consolidationService = new ConsolidationService();
