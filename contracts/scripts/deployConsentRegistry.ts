import { ethers } from "hardhat";

/**
 * Deploy script for ConsentRegistry contract
 * 
 * Prerequisites:
 * 1. Set SEPOLIA_RPC_URL in .env
 * 2. Set DEPLOYER_PRIVATE_KEY in .env (funded with Sepolia ETH)
 * 
 * Get Sepolia ETH from:
 * - https://sepoliafaucet.com/
 * - https://sepolia-faucet.pk910.de/
 * 
 * Usage:
 *   cd contracts
 *   npx hardhat run scripts/deployConsentRegistry.ts --network sepolia
 * 
 * After deployment:
 *   Set NEXT_PUBLIC_CONTRACT_ADDRESS and HEALTH_RECORDS_CONTRACT_ADDRESS in .env
 */
async function main() {
  console.log("Deploying ConsentRegistry contract...");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");
  
  if (balance === 0n) {
    throw new Error("Deployer account has no ETH. Fund it from https://sepoliafaucet.com/");
  }
  
  const ConsentRegistry = await ethers.getContractFactory("ConsentRegistry");
  const contract = await ConsentRegistry.deploy();
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  console.log(`\nConsentRegistry deployed to: ${address}`);
  console.log("\nNext steps:");
  console.log(`1. Add to .env: HEALTH_RECORDS_CONTRACT_ADDRESS=${address}`);
  console.log(`2. Add to .env: NEXT_PUBLIC_CONTRACT_ADDRESS=${address}`);
  console.log(`3. Verify on Etherscan: npx hardhat verify --network sepolia ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
