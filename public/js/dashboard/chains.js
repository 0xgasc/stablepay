// StablePay Dashboard - Chain Configuration Module

// Chain configuration - grouped by blockchain
const CHAIN_GROUPS = [
    {
        name: 'Base',
        color: '#0052FF',
        networks: [
            { id: 'BASE_MAINNET', label: 'Mainnet', type: 'mainnet' },
            { id: 'BASE_SEPOLIA', label: 'Sepolia (Testnet)', type: 'testnet' }
        ]
    },
    {
        name: 'Ethereum',
        color: '#627EEA',
        networks: [
            { id: 'ETHEREUM_MAINNET', label: 'Mainnet', type: 'mainnet' },
            { id: 'ETHEREUM_SEPOLIA', label: 'Sepolia (Testnet)', type: 'testnet' }
        ]
    },
    {
        name: 'Polygon',
        color: '#8247E5',
        networks: [
            { id: 'POLYGON_MAINNET', label: 'Mainnet', type: 'mainnet' },
            { id: 'POLYGON_MUMBAI', label: 'Mumbai (Testnet)', type: 'testnet' }
        ]
    },
    {
        name: 'Arbitrum',
        color: '#28A0F0',
        networks: [
            { id: 'ARBITRUM_MAINNET', label: 'Mainnet', type: 'mainnet' },
            { id: 'ARBITRUM_SEPOLIA', label: 'Sepolia (Testnet)', type: 'testnet' }
        ]
    },
    {
        name: 'Solana',
        color: '#9945FF',
        networks: [
            { id: 'SOLANA_MAINNET', label: 'Mainnet', type: 'mainnet' },
            { id: 'SOLANA_DEVNET', label: 'Devnet (Testnet)', type: 'testnet' }
        ]
    }
];

// Legacy CHAINS array for compatibility with other functions
const CHAINS = CHAIN_GROUPS.flatMap(group =>
    group.networks.map(net => ({
        id: net.id,
        name: `${group.name} ${net.label}`,
        network: net.type,
        color: group.color
    }))
);

// Chain display names
const CHAIN_DISPLAY_NAMES = {
    'BASE_MAINNET': 'Base',
    'BASE_SEPOLIA': 'Base Sepolia',
    'ETHEREUM_MAINNET': 'Ethereum',
    'ETHEREUM_SEPOLIA': 'Ethereum Sepolia',
    'POLYGON_MAINNET': 'Polygon',
    'POLYGON_MUMBAI': 'Polygon Mumbai',
    'ARBITRUM_MAINNET': 'Arbitrum One',
    'ARBITRUM_SEPOLIA': 'Arbitrum Sepolia',
    'SOLANA_MAINNET': 'Solana',
    'SOLANA_DEVNET': 'Solana Devnet'
};

// Format chain name for display
function formatChainName(chain) {
    return CHAIN_DISPLAY_NAMES[chain] || chain.replace(/_/g, ' ').toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
}

// Get explorer link for transaction
function getExplorerLink(chain, txHash) {
    const explorers = {
        'BASE_MAINNET': 'https://basescan.org',
        'BASE_SEPOLIA': 'https://sepolia.basescan.org',
        'ETHEREUM_MAINNET': 'https://etherscan.io',
        'ETHEREUM_SEPOLIA': 'https://sepolia.etherscan.io',
        'POLYGON_MAINNET': 'https://polygonscan.com',
        'POLYGON_MUMBAI': 'https://mumbai.polygonscan.com',
        'ARBITRUM_MAINNET': 'https://arbiscan.io',
        'ARBITRUM_SEPOLIA': 'https://sepolia.arbiscan.io',
        'SOLANA_MAINNET': 'https://solscan.io',
        'SOLANA_DEVNET': 'https://solscan.io'
    };

    const base = explorers[chain] || 'https://etherscan.io';

    if (chain.startsWith('SOLANA')) {
        const cluster = chain === 'SOLANA_DEVNET' ? '?cluster=devnet' : '';
        return `${base}/tx/${txHash}${cluster}`;
    }

    return `${base}/tx/${txHash}`;
}

// Alias for backwards compatibility
function getExplorerUrl(chainId, txHash) {
    return getExplorerLink(chainId, txHash);
}

// Get chain configuration including RPC and token addresses
function getChainConfig(chainId, token = 'USDC') {
    // Use window.CHAIN_CONFIG from chain-config.js if available
    if (window.CHAIN_CONFIG && window.CHAIN_CONFIG[chainId]) {
        const config = window.CHAIN_CONFIG[chainId];
        return {
            ...config,
            tokenAddress: config.tokens?.[token] || config.usdcAddress
        };
    }

    // Fallback configurations
    const configs = {
        'BASE_SEPOLIA': {
            chainId: '0x14a34',
            rpcUrl: 'https://sepolia.base.org',
            usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            tokens: {
                'USDC': '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
            }
        },
        'BASE_MAINNET': {
            chainId: '0x2105',
            rpcUrl: 'https://mainnet.base.org',
            usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            tokens: {
                'USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
            }
        },
        'ETHEREUM_SEPOLIA': {
            chainId: '0xaa36a7',
            rpcUrl: 'https://rpc.sepolia.org',
            usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
            tokens: {
                'USDC': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
            }
        },
        'ETHEREUM_MAINNET': {
            chainId: '0x1',
            rpcUrl: 'https://eth.llamarpc.com',
            usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            tokens: {
                'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
            }
        },
        'POLYGON_MAINNET': {
            chainId: '0x89',
            rpcUrl: 'https://polygon-rpc.com',
            usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
            tokens: {
                'USDC': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
            }
        },
        'ARBITRUM_MAINNET': {
            chainId: '0xa4b1',
            rpcUrl: 'https://arb1.arbitrum.io/rpc',
            usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
            tokens: {
                'USDC': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
            }
        },
        'SOLANA_MAINNET': {
            rpcUrl: 'https://api.mainnet-beta.solana.com',
            usdcAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            tokens: {
                'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
            }
        },
        'SOLANA_DEVNET': {
            rpcUrl: 'https://api.devnet.solana.com',
            usdcAddress: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
            tokens: {
                'USDC': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
            }
        }
    };

    const config = configs[chainId] || {};
    return {
        ...config,
        tokenAddress: config.tokens?.[token] || config.usdcAddress
    };
}

// Check if chain is EVM-based
function isEVMChain(chainId) {
    return !chainId.startsWith('SOLANA');
}

// Check if chain is Solana-based
function isSolanaChain(chainId) {
    return chainId.startsWith('SOLANA');
}

// Export for use in other modules
window.DashboardChains = {
    CHAIN_GROUPS,
    CHAINS,
    CHAIN_DISPLAY_NAMES,
    formatChainName,
    getExplorerLink,
    getExplorerUrl,
    getChainConfig,
    isEVMChain,
    isSolanaChain
};
