/**
 * StablePay Splitter Contract Configuration
 * This file contains deployed contract addresses and ABI for the payment splitter
 */

const SPLITTER_CONFIG = {
  // Contract addresses per chain (update after deployment)
  addresses: {
    // Testnets
    BASE_SEPOLIA: '0xCf6A9F0dA89aA829ACB49Ff3A853df196D4E322d',
    ETHEREUM_SEPOLIA: null,    // Deploy and update
    POLYGON_MUMBAI: null,      // Deploy and update
    ARBITRUM_SEPOLIA: null,    // Deploy and update

    // Mainnets
    BASE_MAINNET: null,        // Deploy and update
    ETHEREUM_MAINNET: null,    // Deploy and update
    POLYGON_MAINNET: null,     // Deploy and update
    ARBITRUM_MAINNET: null,    // Deploy and update
  },

  // StablePay fee wallet per chain (where fees are collected)
  feeWallets: {
    // Use same wallet across all chains for simplicity, or different per chain
    BASE_SEPOLIA: null,
    ETHEREUM_SEPOLIA: null,
    POLYGON_MUMBAI: null,
    ARBITRUM_SEPOLIA: null,
    BASE_MAINNET: null,
    ETHEREUM_MAINNET: null,
    POLYGON_MAINNET: null,
    ARBITRUM_MAINNET: null,
  },

  // Fee tiers in basis points
  feeTiers: {
    STARTER: 50,    // 0.50% - $0-10k monthly volume
    GROWTH: 40,     // 0.40% - $10k-50k monthly volume
    SCALE: 30,      // 0.30% - $50k-250k monthly volume
    VOLUME: 20,     // 0.20% - $250k+ monthly volume
    MINIMUM: 10,    // 0.10% - Minimum allowed
    MAXIMUM: 500,   // 5.00% - Maximum allowed (safety cap)
  },

  // Volume thresholds for automatic tier upgrades
  volumeThresholds: {
    STARTER: 0,
    GROWTH: 10000,
    SCALE: 50000,
    VOLUME: 250000,
  },

  // Minimal ABI for the splitter contract (only functions we need)
  abi: [
    // Process payment
    "function processPayment(address token, address merchant, uint256 amount, uint16 feeBasisPoints, bytes32 orderId) external",

    // Process payment with permit (gasless approval)
    "function processPaymentWithPermit(address token, address merchant, uint256 amount, uint16 feeBasisPoints, bytes32 orderId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",

    // View functions
    "function calculateSplit(uint256 amount, uint16 feeBasisPoints) external pure returns (uint256 merchantAmount, uint256 feeAmount)",
    "function isTokenAllowed(address token) external view returns (bool)",
    "function feeRecipient() external view returns (address)",
    "function allowedTokens(address) external view returns (bool)",

    // Events
    "event PaymentProcessed(bytes32 indexed orderId, address indexed token, address indexed merchant, address payer, uint256 totalAmount, uint256 merchantAmount, uint256 feeAmount, uint16 feeBasisPoints)"
  ],

  // ERC20 ABI for token approval
  erc20Abi: [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)"
  ]
};

/**
 * Get the fee in basis points for a merchant based on their monthly volume
 * @param {number} monthlyVolume - Merchant's 30-day rolling volume in USD
 * @param {number|null} customFee - Custom enterprise fee in basis points (if set)
 * @returns {number} Fee in basis points
 */
function getFeeBasisPoints(monthlyVolume, customFee = null) {
  // If custom fee is set (enterprise), use it
  if (customFee !== null && customFee >= SPLITTER_CONFIG.feeTiers.MINIMUM) {
    return customFee;
  }

  // Determine tier based on volume
  if (monthlyVolume >= SPLITTER_CONFIG.volumeThresholds.VOLUME) {
    return SPLITTER_CONFIG.feeTiers.VOLUME;
  } else if (monthlyVolume >= SPLITTER_CONFIG.volumeThresholds.SCALE) {
    return SPLITTER_CONFIG.feeTiers.SCALE;
  } else if (monthlyVolume >= SPLITTER_CONFIG.volumeThresholds.GROWTH) {
    return SPLITTER_CONFIG.feeTiers.GROWTH;
  } else {
    return SPLITTER_CONFIG.feeTiers.STARTER;
  }
}

/**
 * Generate a unique order ID (bytes32)
 * @param {string} merchantId - Merchant's ID
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Bytes32 order ID
 */
function generateOrderId(merchantId, timestamp = Date.now()) {
  // Create a unique identifier using hex encoding (browser-compatible)
  const timestampHex = timestamp.toString(16).padStart(12, '0');
  const randomHex = Math.floor(Math.random() * 0xFFFFFFFFFFFF).toString(16).padStart(12, '0');

  // Convert merchantId chars to hex (first 20 chars = 40 hex chars)
  let merchantHex = '';
  const cleanId = (merchantId || 'unknown').slice(0, 20);
  for (let i = 0; i < cleanId.length; i++) {
    merchantHex += cleanId.charCodeAt(i).toString(16).padStart(2, '0');
  }

  // Combine: merchantHex + timestampHex + randomHex, pad to 64 chars
  const combined = (merchantHex + timestampHex + randomHex).slice(0, 64).padEnd(64, '0');

  return '0x' + combined;
}

/**
 * Calculate the split amounts for a payment
 * @param {number} amount - Total amount in token units
 * @param {number} feeBasisPoints - Fee in basis points
 * @returns {{merchantAmount: number, feeAmount: number}}
 */
function calculateSplit(amount, feeBasisPoints) {
  const feeAmount = Math.floor((amount * feeBasisPoints) / 10000);
  const merchantAmount = amount - feeAmount;
  return { merchantAmount, feeAmount };
}

// Export for use in browser
if (typeof window !== 'undefined') {
  window.SPLITTER_CONFIG = SPLITTER_CONFIG;
  window.getFeeBasisPoints = getFeeBasisPoints;
  window.generateOrderId = generateOrderId;
  window.calculateSplit = calculateSplit;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPLITTER_CONFIG,
    getFeeBasisPoints,
    generateOrderId,
    calculateSplit
  };
}
