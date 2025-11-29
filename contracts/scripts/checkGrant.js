/**
 * checkGrant.js - Verify on-chain grant state for a given CID
 * 
 * Usage:
 *   npx hardhat run scripts/checkGrant.js --network sepolia
 * 
 * Environment Variables Required:
 *   - CID: The IPFS Content Identifier to check (or pass via --cid)
 *   - HEALTH_RECORDS_CONTRACT_ADDRESS: Deployed contract address
 *   - SEPOLIA_RPC_URL: Ethereum RPC endpoint
 * 
 * Example:
 *   CID=bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi \
 *   npx hardhat run scripts/checkGrant.js --network sepolia
 * 
 * References:
 * - Hardhat docs: https://hardhat.org/hardhat-runner/docs/guides/scripts
 * - ethers.js v6: https://docs.ethers.org/v6/
 * - Sepolia testnet: https://sepolia.dev/
 */

const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env" });

// Minimal ABI for the functions we need
const HEALTH_RECORDS_ABI = [
  {
    inputs: [{ name: "cidHash", type: "bytes32" }],
    name: "getLatestGrant",
    outputs: [
      { name: "grantee", type: "address" },
      { name: "expiry", type: "uint256" },
      { name: "active", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ name: "cid", type: "string" }],
    name: "computeCidHash",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "pure",
    type: "function"
  }
];

async function main() {
  // Get CID from environment or command line
  const cid = process.env.CID;
  
  if (!cid) {
    console.error("Error: CID is required.");
    console.error("Usage: CID=<your-cid> npx hardhat run scripts/checkGrant.js --network sepolia");
    console.error("");
    console.error("Example:");
    console.error("  CID=bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi \\");
    console.error("  npx hardhat run scripts/checkGrant.js --network sepolia");
    process.exit(1);
  }

  // Get contract address from environment
  const contractAddress = process.env.HEALTH_RECORDS_CONTRACT_ADDRESS;
  
  if (!contractAddress) {
    console.error("Error: HEALTH_RECORDS_CONTRACT_ADDRESS environment variable is not set.");
    console.error("Deploy the contract first and set the address in your .env file.");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("Grant Verification Script");
  console.log("=".repeat(60));
  console.log("");
  console.log(`CID: ${cid}`);
  console.log(`Contract: ${contractAddress}`);
  console.log("");

  // Compute cidHash: keccak256(abi.encodePacked(cid))
  // This matches Solidity's: keccak256(abi.encodePacked(cid))
  const cidHash = ethers.keccak256(ethers.toUtf8Bytes(cid));
  console.log(`CID Hash (bytes32): ${cidHash}`);
  console.log("");

  // Connect to contract
  const contract = new ethers.Contract(
    contractAddress,
    HEALTH_RECORDS_ABI,
    ethers.provider
  );

  try {
    // Call getLatestGrant
    const [grantee, expiry, active] = await contract.getLatestGrant(cidHash);

    // Format expiry timestamp
    let expiryFormatted;
    if (expiry === 0n) {
      expiryFormatted = "No expiry (0)";
    } else {
      const expiryDate = new Date(Number(expiry) * 1000);
      const isExpired = Date.now() > Number(expiry) * 1000;
      expiryFormatted = `${expiry.toString()} (${expiryDate.toISOString()})${isExpired ? " [EXPIRED]" : ""}`;
    }

    // Output results
    console.log("Grant Details:");
    console.log("-".repeat(40));
    console.log(JSON.stringify({
      grantee: grantee,
      expiry: expiry.toString(),
      active: active
    }, null, 2));
    console.log("-".repeat(40));
    console.log("");
    console.log(`Grantee:  ${grantee}`);
    console.log(`Expiry:   ${expiryFormatted}`);
    console.log(`Active:   ${active}`);
    console.log("");

    // Status summary
    if (grantee === ethers.ZeroAddress && !active) {
      console.log("Status: No grant found for this CID hash.");
    } else if (active) {
      const expiryNum = Number(expiry);
      if (expiryNum === 0 || Date.now() / 1000 <= expiryNum) {
        console.log("Status: ✓ Grant is ACTIVE and VALID");
      } else {
        console.log("Status: ⚠ Grant is marked active but has EXPIRED");
      }
    } else {
      console.log("Status: ✗ Grant has been REVOKED");
    }

  } catch (error) {
    console.error("Error calling getLatestGrant:", error.message);
    
    if (error.message.includes("call revert exception")) {
      console.error("");
      console.error("This may indicate:");
      console.error("  1. The contract does not have the getLatestGrant function");
      console.error("  2. The contract address is incorrect");
      console.error("  3. The contract is not deployed on this network");
    }
    
    process.exit(1);
  }

  console.log("");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
