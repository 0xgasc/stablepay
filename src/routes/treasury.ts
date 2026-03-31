import { Router } from 'express';
import { ethers } from 'ethers';
import { requireMerchantAuth, AuthenticatedRequest } from '../middleware/auth';
import { treasuryService } from '../services/treasuryService';
import { db } from '../config/database';
import { logger } from '../utils/logger';
import crypto from 'crypto';

const router = Router();

const CHAIN_RPC: Record<string, { rpc: string; tokens: Record<string, string> }> = {
  BASE_MAINNET: { rpc: process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org', tokens: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' } },
  ETHEREUM_MAINNET: { rpc: process.env.ETHEREUM_MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com', tokens: { USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', EURC: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c' } },
  POLYGON_MAINNET: { rpc: process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-bor-rpc.publicnode.com', tokens: { USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', EURC: '0x390f28e7b2a5Ce76b67F0cD10EA0950A3a19F803' } },
  ARBITRUM_MAINNET: { rpc: process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com', tokens: { USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', EURC: '0x7Cb7cA2D5c848a1b3e6eCc8De1d8E4F79dAF96c8' } },
  BNB_MAINNET: { rpc: process.env.BNB_MAINNET_RPC_URL || 'https://bsc-dataseed.binance.org', tokens: { USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', USDT: '0x55d398326f99059fF775485246999027B3197955' } },
};
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function transfer(address, uint256) returns (bool)'];
const ENCRYPTION_KEY = process.env.JWT_SECRET || process.env.AGENT_WALLET_KEY;
const AGENT_WALLET_KEY = process.env.AGENT_WALLET_KEY?.trim();

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

// Get all wallet balances
router.get('/balances', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as AuthenticatedRequest).merchant;
    const data = await treasuryService.getMerchantBalances(merchant.id);
    res.json(data);
  } catch (error) {
    console.error('Treasury balances error:', error);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

// Get recent incoming payments
router.get('/incoming', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as AuthenticatedRequest).merchant;
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);
    const data = await treasuryService.getRecentIncoming(merchant.id, days);
    res.json(data);
  } catch (error) {
    console.error('Treasury incoming error:', error);
    res.status(500).json({ error: 'Failed to fetch incoming data' });
  }
});

// Withdraw from managed wallet to external address
router.post('/withdraw', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as AuthenticatedRequest).merchant;
    const { toAddress, amount, chain, token } = req.body;

    if (!toAddress || !amount || !chain) {
      return res.status(400).json({ error: 'toAddress, amount, and chain are required' });
    }
    if (amount <= 0) return res.status(400).json({ error: 'Amount must be positive' });
    if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
      return res.status(400).json({ error: 'Invalid EVM address' });
    }

    const chainConf = CHAIN_RPC[chain];
    if (!chainConf) return res.status(400).json({ error: `Unsupported chain: ${chain}` });

    const managedWallet = await db.managedWallet.findUnique({
      where: { merchantId_chain: { merchantId: merchant.id, chain } },
    });

    if (!managedWallet) {
      return res.status(404).json({ error: `No managed wallet for ${chain}` });
    }

    const tokenName = token || 'USDC';
    const tokenAddress = chainConf.tokens[tokenName];
    if (!tokenAddress) return res.status(400).json({ error: `Token ${tokenName} not supported on ${chain}` });

    const decimals = chain === 'BNB_MAINNET' ? 18 : 6;
    const amountRaw = ethers.parseUnits(amount.toString(), decimals);

    const privateKey = decryptKey(managedWallet.encryptedKey).trim();
    const provider = new ethers.JsonRpcProvider(chainConf.rpc);
    const wallet = new ethers.Wallet(privateKey, provider);

    // Check gas balance, sponsor if needed
    let gasTxHash: string | undefined;
    const gasBalance = await provider.getBalance(managedWallet.address);
    if (gasBalance < ethers.parseEther('0.0005')) {
      if (!AGENT_WALLET_KEY) {
        return res.status(400).json({ error: 'Insufficient gas and no agent wallet to sponsor' });
      }
      const agentWallet = new ethers.Wallet(AGENT_WALLET_KEY, provider);
      const agentBalance = await provider.getBalance(agentWallet.address);
      if (agentBalance < ethers.parseEther('0.002')) {
        return res.status(400).json({
          error: `Agent wallet needs funding for gas sponsorship on ${chain}`,
          agentWallet: agentWallet.address,
          agentBalance: ethers.formatEther(agentBalance) + ' ' + (chain.includes('POLYGON') ? 'MATIC' : 'ETH'),
          needed: '~0.002 ' + (chain.includes('POLYGON') ? 'MATIC' : 'ETH'),
        });
      }
      const gasTx = await agentWallet.sendTransaction({
        to: managedWallet.address,
        value: ethers.parseEther('0.001'),
      });
      await gasTx.wait();
      gasTxHash = gasTx.hash;
    }

    // Check token balance
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const balance = await tokenContract.balanceOf(managedWallet.address);
    if (balance < amountRaw) {
      const available = ethers.formatUnits(balance, decimals);
      return res.status(400).json({ error: `Insufficient balance. Available: $${available}` });
    }

    // Send transfer
    const tx = await tokenContract.transfer(toAddress, amountRaw);
    await tx.wait();

    logger.info('Managed wallet withdrawal', {
      merchantId: merchant.id,
      chain, token: tokenName, amount,
      from: managedWallet.address,
      to: toAddress,
      txHash: tx.hash,
      gasTxHash,
      event: 'treasury.withdrawal',
    });

    res.json({
      success: true,
      txHash: tx.hash,
      gasTxHash,
      amount,
      token: tokenName,
      chain,
      from: managedWallet.address,
      to: toAddress,
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Withdrawal failed' });
  }
});

// Get managed wallets for merchant
router.get('/managed-wallets', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as AuthenticatedRequest).merchant;
    const wallets = await db.managedWallet.findMany({
      where: { merchantId: merchant.id },
      select: { chain: true, address: true, createdAt: true },
    });
    res.json({ wallets });
  } catch (error) {
    console.error('Get managed wallets error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const treasuryRouter = router;
