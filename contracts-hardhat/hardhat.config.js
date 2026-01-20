import "@nomicfoundation/hardhat-toolbox";
import dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    // ============ TESTNETS ============
    baseSepolia: {
      url: "https://sepolia.base.org",
      chainId: 84532,
      accounts: [PRIVATE_KEY],
      gasPrice: 1000000000,
    },
    ethereumSepolia: {
      url: process.env.ETHEREUM_SEPOLIA_RPC || "https://eth-sepolia.g.alchemy.com/v2/demo",
      chainId: 11155111,
      accounts: [PRIVATE_KEY],
    },
    polygonAmoy: {
      url: "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: [PRIVATE_KEY],
    },
    arbitrumSepolia: {
      url: "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts: [PRIVATE_KEY],
    },

    // ============ MAINNETS ============
    base: {
      url: "https://mainnet.base.org",
      chainId: 8453,
      accounts: [PRIVATE_KEY],
    },
    ethereum: {
      url: process.env.ETHEREUM_MAINNET_RPC || "https://eth.llamarpc.com",
      chainId: 1,
      accounts: [PRIVATE_KEY],
    },
    polygon: {
      url: "https://polygon-rpc.com",
      chainId: 137,
      accounts: [PRIVATE_KEY],
    },
    arbitrum: {
      url: "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    apiKey: {
      baseSepolia: process.env.BASESCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org"
        }
      }
    ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
