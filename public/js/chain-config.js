// Complete chain configurations for all supported networks
const CHAIN_CONFIGS = {
    // Ethereum Networks
    ETHEREUM_MAINNET: {
        chainId: '0x1',
        chainName: 'Ethereum Mainnet',
        rpcUrls: ['https://mainnet.infura.io/v3/YOUR_API_KEY'],
        blockExplorerUrls: ['https://etherscan.io'],
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        usdcAddress: '0xA0b86a33E6441C8C8C8DFc6C2dE08FD00aaa3f5A', // USDC on Ethereum
        type: 'EVM',
        network: 'MAINNET'
    },
    ETHEREUM_SEPOLIA: {
        chainId: '0xaa36a7',
        chainName: 'Ethereum Sepolia',
        rpcUrls: ['https://eth-sepolia.g.alchemy.com/v2/alcht_YbDiff1KAqK0fNAzBgycHfz7G0iz4n'],
        blockExplorerUrls: ['https://sepolia.etherscan.io'],
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        type: 'EVM',
        network: 'TESTNET'
    },

    // Base Networks
    BASE_MAINNET: {
        chainId: '0x2105',
        chainName: 'Base Mainnet',
        rpcUrls: ['https://mainnet.base.org'],
        blockExplorerUrls: ['https://basescan.org'],
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
        type: 'EVM',
        network: 'MAINNET'
    },
    BASE_SEPOLIA: {
        chainId: '0x14a34',
        chainName: 'Base Sepolia',
        rpcUrls: ['https://sepolia.base.org'],
        blockExplorerUrls: ['https://sepolia.basescan.org'],
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        type: 'EVM',
        network: 'TESTNET'
    },

    // Polygon Networks
    POLYGON_MAINNET: {
        chainId: '0x89',
        chainName: 'Polygon Mainnet',
        rpcUrls: ['https://polygon-rpc.com'],
        blockExplorerUrls: ['https://polygonscan.com'],
        nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
        usdcAddress: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC on Polygon
        type: 'EVM',
        network: 'MAINNET'
    },
    POLYGON_MUMBAI: {
        chainId: '0x13881',
        chainName: 'Polygon Mumbai',
        rpcUrls: ['https://rpc-mumbai.maticvigil.com'],
        blockExplorerUrls: ['https://mumbai.polygonscan.com'],
        nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
        usdcAddress: '0xe11a86849d99f524cac3e7a0ec1241828e332c62', // USDC.e on Mumbai
        type: 'EVM',
        network: 'TESTNET'
    },

    // Arbitrum Networks  
    ARBITRUM_MAINNET: {
        chainId: '0xa4b1',
        chainName: 'Arbitrum One',
        rpcUrls: ['https://arb1.arbitrum.io/rpc'],
        blockExplorerUrls: ['https://arbiscan.io'],
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
        type: 'EVM',
        network: 'MAINNET'
    },
    ARBITRUM_SEPOLIA: {
        chainId: '0x66eee',
        chainName: 'Arbitrum Sepolia',
        rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
        blockExplorerUrls: ['https://sepolia.arbiscan.io'],
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        usdcAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // USDC on Arbitrum Sepolia
        type: 'EVM',
        network: 'TESTNET'
    },

    // Solana Networks
    SOLANA_MAINNET: {
        chainId: null, // Solana doesn't use chainId
        chainName: 'Solana Mainnet',
        rpcUrls: ['https://api.mainnet-beta.solana.com'],
        blockExplorerUrls: ['https://solscan.io'],
        nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
        usdcAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC SPL token
        type: 'SOLANA',
        network: 'MAINNET'
    },
    SOLANA_DEVNET: {
        chainId: null,
        chainName: 'Solana Devnet',
        rpcUrls: ['https://api.devnet.solana.com'],
        blockExplorerUrls: ['https://solscan.io'],
        nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
        usdcAddress: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC SPL token on devnet
        type: 'SOLANA',
        network: 'TESTNET'
    }
};

// Helper functions
function getChainsByNetwork(networkMode) {
    return Object.entries(CHAIN_CONFIGS).filter(([key, config]) => 
        config.network === networkMode
    );
}

function getEVMChains() {
    return Object.entries(CHAIN_CONFIGS).filter(([key, config]) => 
        config.type === 'EVM'
    );
}

function getSolanaChains() {
    return Object.entries(CHAIN_CONFIGS).filter(([key, config]) => 
        config.type === 'SOLANA'
    );
}

function validateAddress(address, chainType) {
    if (chainType === 'EVM') {
        // Ethereum address validation
        return /^0x[a-fA-F0-9]{40}$/.test(address);
    } else if (chainType === 'SOLANA') {
        // Solana address validation (base58, 32-44 chars)
        return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    }
    return false;
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CHAIN_CONFIGS, getChainsByNetwork, getEVMChains, getSolanaChains, validateAddress };
}