import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { db } from '../config/database';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const SOLANA_TOKEN_MINTS: Record<string, string> = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  EURC: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
};

// RPC endpoints + token addresses per chain
const CHAIN_TOKENS: Record<string, { rpc: string; tokens: Record<string, string> }> = {
  BASE_MAINNET: {
    rpc: process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org',
    tokens: {
      USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42',
    },
  },
  ETHEREUM_MAINNET: {
    rpc: process.env.ETHEREUM_MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com',
    tokens: {
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      EURC: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c',
    },
  },
  POLYGON_MAINNET: {
    rpc: process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',
    tokens: {
      USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    },
  },
  ARBITRUM_MAINNET: {
    rpc: process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com',
    tokens: {
      USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    },
  },
};

interface WalletBalance {
  chain: string;
  address: string;
  tokens: { token: string; balance: string; balanceUSD: number }[];
  totalUSD: number;
}

class TreasuryService {
  /**
   * Get balances for all of a merchant's wallets
   */
  async getMerchantBalances(merchantId: string): Promise<{
    wallets: WalletBalance[];
    totalUSD: number;
    feesDue: number;
    netAvailable: number;
  }> {
    const merchant = await db.merchant.findUnique({
      where: { id: merchantId },
      include: { wallets: { where: { isActive: true } } },
    });

    if (!merchant) throw new Error('Merchant not found');

    const wallets: WalletBalance[] = [];
    let totalUSD = 0;

    for (const wallet of merchant.wallets) {
      let balances: { token: string; balance: string; balanceUSD: number }[];

      if (wallet.chain === 'SOLANA_MAINNET') {
        balances = await this.getSolanaTokenBalances(wallet.address, wallet.supportedTokens);
      } else {
        const chainConfig = CHAIN_TOKENS[wallet.chain];
        if (!chainConfig) continue;
        balances = await this.getWalletTokenBalances(wallet.address, wallet.chain, wallet.supportedTokens);
      }

      const walletTotal = balances.reduce((sum, b) => sum + b.balanceUSD, 0);
      totalUSD += walletTotal;

      wallets.push({
        chain: wallet.chain,
        address: wallet.address,
        tokens: balances,
        totalUSD: walletTotal,
      });
    }

    const feesDue = Number(merchant.feesDue || 0);

    return {
      wallets,
      totalUSD: Math.round(totalUSD * 100) / 100,
      feesDue: Math.round(feesDue * 100) / 100,
      netAvailable: Math.round((totalUSD - feesDue) * 100) / 100,
    };
  }

  /**
   * Get token balances for a single wallet on a specific chain
   */
  async getWalletTokenBalances(
    address: string,
    chain: string,
    supportedTokens: string[]
  ): Promise<{ token: string; balance: string; balanceUSD: number }[]> {
    const chainConfig = CHAIN_TOKENS[chain];
    if (!chainConfig) return [];

    const provider = new ethers.JsonRpcProvider(chainConfig.rpc);
    const results: { token: string; balance: string; balanceUSD: number }[] = [];

    for (const token of supportedTokens) {
      const tokenAddr = chainConfig.tokens[token];
      if (!tokenAddr) continue;

      try {
        const contract = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
        const rawBalance = await contract.balanceOf(address);
        const formatted = ethers.formatUnits(rawBalance, 6); // All stablecoins are 6 decimals
        const balanceNum = parseFloat(formatted);

        results.push({
          token,
          balance: formatted,
          balanceUSD: balanceNum, // 1:1 for stablecoins
        });
      } catch (err) {
        // RPC failure — skip this token
        results.push({ token, balance: '0', balanceUSD: 0 });
      }
    }

    return results;
  }

  /**
   * Get SPL token balances for a Solana wallet
   */
  async getSolanaTokenBalances(
    address: string,
    supportedTokens: string[]
  ): Promise<{ token: string; balance: string; balanceUSD: number }[]> {
    const results: { token: string; balance: string; balanceUSD: number }[] = [];

    try {
      const connection = new Connection(SOLANA_RPC, 'confirmed');
      const ownerPubkey = new PublicKey(address);
      const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

      // Get all token accounts for this owner
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(ownerPubkey, {
        programId: TOKEN_PROGRAM_ID,
      });

      // Build mint → balance map
      const mintBalances: Record<string, number> = {};
      for (const account of tokenAccounts.value) {
        const info = account.account.data.parsed?.info;
        if (info) {
          mintBalances[info.mint] = (mintBalances[info.mint] || 0) + (info.tokenAmount?.uiAmount || 0);
        }
      }

      for (const token of supportedTokens) {
        const mint = SOLANA_TOKEN_MINTS[token];
        if (!mint) continue;
        const balance = mintBalances[mint] || 0;
        results.push({
          token,
          balance: balance.toFixed(6),
          balanceUSD: balance,
        });
      }
    } catch (err) {
      // RPC failure — return zeros
      for (const token of supportedTokens) {
        if (SOLANA_TOKEN_MINTS[token]) {
          results.push({ token, balance: '0', balanceUSD: 0 });
        }
      }
    }

    return results;
  }

  /**
   * Get recent confirmed payments for a merchant (incoming flow)
   */
  async getRecentIncoming(merchantId: string, days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const orders = await db.order.findMany({
      where: {
        merchantId,
        status: 'CONFIRMED',
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amount: true,
        token: true,
        chain: true,
        updatedAt: true,
      },
    });

    const totalIncoming = orders.reduce((sum, o) => sum + Number(o.amount), 0);

    return {
      orders,
      totalIncoming: Math.round(totalIncoming * 100) / 100,
      period: `${days} days`,
    };
  }
}

export const treasuryService = new TreasuryService();
