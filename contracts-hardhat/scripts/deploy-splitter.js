import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Token addresses per chain
const TOKEN_ADDRESSES = {
  // ============ TESTNETS ============
  baseSepolia: {
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
  },
  ethereumSepolia: {
    USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
  },
  polygonAmoy: {
    USDC: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"
  },
  arbitrumSepolia: {
    USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"
  },

  // ============ MAINNETS ============
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42"
  },
  ethereum: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    EURC: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c"
  },
  polygon: {
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"
  },
  arbitrum: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"
  }
};

// StablePay fee recipient wallet (CHANGE THIS TO YOUR WALLET)
const FEE_RECIPIENT = process.env.STABLEPAY_FEE_WALLET || "0x0000000000000000000000000000000000000000";

async function main() {
  const networkName = hre.network.name;
  console.log(`\n========================================`);
  console.log(`Deploying StablePaySplitter to ${networkName}`);
  console.log(`========================================\n`);

  // Validate fee recipient
  if (FEE_RECIPIENT === "0x0000000000000000000000000000000000000000") {
    console.error("ERROR: Please set STABLEPAY_FEE_WALLET environment variable");
    process.exit(1);
  }

  // Get token addresses for this network
  const tokens = TOKEN_ADDRESSES[networkName];
  if (!tokens) {
    console.error(`ERROR: No token addresses configured for network: ${networkName}`);
    process.exit(1);
  }

  const tokenAddresses = Object.values(tokens);
  console.log(`Fee Recipient: ${FEE_RECIPIENT}`);
  console.log(`Whitelisting ${tokenAddresses.length} token(s):`);
  Object.entries(tokens).forEach(([symbol, addr]) => {
    console.log(`  - ${symbol}: ${addr}`);
  });

  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log(`\nDeploying with account: ${deployer.address}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${hre.ethers.formatEther(balance)} ETH\n`);

  // Deploy contract
  console.log("Deploying StablePaySplitter...");
  const StablePaySplitter = await hre.ethers.getContractFactory("StablePaySplitter");
  const splitter = await StablePaySplitter.deploy(FEE_RECIPIENT, tokenAddresses);

  await splitter.waitForDeployment();
  const contractAddress = await splitter.getAddress();

  console.log(`\n StablePaySplitter deployed to: ${contractAddress}`);

  // Save deployment info
  const deploymentInfo = {
    network: networkName,
    chainId: hre.network.config.chainId,
    contractAddress: contractAddress,
    feeRecipient: FEE_RECIPIENT,
    whitelistedTokens: tokens,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address
  };

  // Save to deployments file
  const deploymentsPath = path.join(__dirname, "../deployments.json");
  let deployments = {};

  if (fs.existsSync(deploymentsPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }

  deployments[networkName] = deploymentInfo;
  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2));
  console.log(`\nDeployment info saved to deployments.json`);

  // Verify contract (if not local)
  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log("\nWaiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    try {
      console.log("Verifying contract on block explorer...");
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [FEE_RECIPIENT, tokenAddresses],
      });
      console.log("Contract verified!");
    } catch (error) {
      console.log("Verification failed (may already be verified):", error.message);
    }
  }

  // Print summary
  console.log("\n========================================");
  console.log("DEPLOYMENT SUMMARY");
  console.log("========================================");
  console.log(`Network:          ${networkName}`);
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Fee Recipient:    ${FEE_RECIPIENT}`);
  console.log(`Tokens:           ${Object.keys(tokens).join(", ")}`);
  console.log("========================================\n");

  return contractAddress;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
