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
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    usdcAddress: process.env.USDC_BASE_SEPOLIA || '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    paymentAddress: process.env.PAYMENT_ADDRESS_BASE_SEPOLIA || '',
    requiredConfirms: 1,
    blockTimeSeconds: 2,
    explorerUrl: 'https://sepolia.basescan.org',
    isTestnet: true,
    faucetUrl: 'https://faucet.quicknode.com/base/sepolia',
    chainId: 84532,
  },
  ETHEREUM_SEPOLIA: {
    name: 'Ethereum Sepolia',
    rpcUrl: process.env.ETHEREUM_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
    usdcAddress: process.env.USDC_ETHEREUM_SEPOLIA || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    paymentAddress: process.env.PAYMENT_ADDRESS_ETHEREUM_SEPOLIA || '',
    requiredConfirms: 3,
    blockTimeSeconds: 12,
    explorerUrl: 'https://sepolia.etherscan.io',
    isTestnet: true,
    faucetUrl: 'https://sepoliafaucet.com',
    chainId: 11155111,
  },
  BASE_MAINNET: {
    name: 'Base',
    rpcUrl: process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org',
    usdcAddress: process.env.USDC_BASE_MAINNET || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    paymentAddress: process.env.PAYMENT_ADDRESS_BASE_MAINNET || '',
    requiredConfirms: 5,
    blockTimeSeconds: 2,
    explorerUrl: 'https://basescan.org',
    isTestnet: false,
    chainId: 8453,
  },
  ETHEREUM_MAINNET: {
    name: 'Ethereum',
    rpcUrl: process.env.ETHEREUM_MAINNET_RPC_URL || 'https://eth.llamarpc.com',
    usdcAddress: process.env.USDC_ETHEREUM_MAINNET || '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    paymentAddress: process.env.PAYMENT_ADDRESS_ETHEREUM_MAINNET || '',
    requiredConfirms: 12,
    blockTimeSeconds: 12,
    explorerUrl: 'https://etherscan.io',
    isTestnet: false,
    chainId: 1,
  },
  POLYGON_MAINNET: {
    name: 'Polygon',
    rpcUrl: process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-rpc.com',
    usdcAddress: process.env.USDC_POLYGON_MAINNET || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    paymentAddress: process.env.PAYMENT_ADDRESS_POLYGON_MAINNET || '',
    requiredConfirms: 128,
    blockTimeSeconds: 2,
    explorerUrl: 'https://polygonscan.com',
    isTestnet: false,
    chainId: 137,
  },
  POLYGON_MUMBAI: {
    name: 'Polygon Mumbai',
    rpcUrl: process.env.POLYGON_MUMBAI_RPC_URL || 'https://rpc-mumbai.maticvigil.com',
    usdcAddress: process.env.USDC_POLYGON_MUMBAI || '0x9999f7Fea5938fD3b1E26A12c3f2fb024e194f97',
    paymentAddress: process.env.PAYMENT_ADDRESS_POLYGON_MUMBAI || '',
    requiredConfirms: 10,
    blockTimeSeconds: 2,
    explorerUrl: 'https://mumbai.polygonscan.com',
    isTestnet: true,
    faucetUrl: 'https://faucet.polygon.technology',
    chainId: 80001,
  },
  ARBITRUM_MAINNET: {
    name: 'Arbitrum',
    rpcUrl: process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    usdcAddress: process.env.USDC_ARBITRUM_MAINNET || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    paymentAddress: process.env.PAYMENT_ADDRESS_ARBITRUM_MAINNET || '',
    requiredConfirms: 5,
    blockTimeSeconds: 0.25,
    explorerUrl: 'https://arbiscan.io',
    isTestnet: false,
    chainId: 42161,
  },
  ARBITRUM_SEPOLIA: {
    name: 'Arbitrum Sepolia',
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    usdcAddress: process.env.USDC_ARBITRUM_SEPOLIA || '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    paymentAddress: process.env.PAYMENT_ADDRESS_ARBITRUM_SEPOLIA || '',
    requiredConfirms: 1,
    blockTimeSeconds: 0.25,
    explorerUrl: 'https://sepolia.arbiscan.io',
    isTestnet: true,
    faucetUrl: 'https://faucet.quicknode.com/arbitrum/sepolia',
    chainId: 421614,
  },
  SOLANA_MAINNET: {
    name: 'Solana',
    rpcUrl: process.env.SOLANA_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com',
    usdcAddress: process.env.USDC_SOLANA_MAINNET || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    paymentAddress: process.env.PAYMENT_ADDRESS_SOLANA_MAINNET || '',
    requiredConfirms: 32,
    blockTimeSeconds: 0.4,
    explorerUrl: 'https://solscan.io',
    isTestnet: false,
    chainId: 900,
  },
  SOLANA_DEVNET: {
    name: 'Solana Devnet',
    rpcUrl: process.env.SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    usdcAddress: process.env.USDC_SOLANA_DEVNET || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    paymentAddress: process.env.PAYMENT_ADDRESS_SOLANA_DEVNET || '',
    requiredConfirms: 1,
    blockTimeSeconds: 0.4,
    explorerUrl: 'https://solscan.io',
    isTestnet: true,
    faucetUrl: 'https://solfaucet.com',
    chainId: 901,
  },
};