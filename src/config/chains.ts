import { Chain } from '../types';

export interface ChainConfig {
  name: string;
  rpcUrl: string;
  usdcAddress: string;
  paymentAddress: string;
  requiredConfirms: number;
  blockTimeSeconds: number;
  explorerUrl: string;
  isTestnet: boolean;
  faucetUrl?: string;
  chainId: number;
}

export const CHAIN_CONFIGS: Record<Chain, ChainConfig> = {
  BASE_SEPOLIA: {
    name: 'Base Sepolia',
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL!,
    usdcAddress: process.env.USDC_BASE_SEPOLIA!,
    paymentAddress: process.env.PAYMENT_ADDRESS_BASE_SEPOLIA!,
    requiredConfirms: 1,
    blockTimeSeconds: 2,
    explorerUrl: 'https://sepolia.basescan.org',
    isTestnet: true,
    faucetUrl: 'https://faucet.quicknode.com/base/sepolia',
    chainId: 84532,
  },
  ETHEREUM_SEPOLIA: {
    name: 'Ethereum Sepolia',
    rpcUrl: process.env.ETHEREUM_SEPOLIA_RPC_URL!,
    usdcAddress: process.env.USDC_ETHEREUM_SEPOLIA!,
    paymentAddress: process.env.PAYMENT_ADDRESS_ETHEREUM_SEPOLIA!,
    requiredConfirms: 3,
    blockTimeSeconds: 12,
    explorerUrl: 'https://sepolia.etherscan.io',
    isTestnet: true,
    faucetUrl: 'https://sepoliafaucet.com',
    chainId: 11155111,
  },
};