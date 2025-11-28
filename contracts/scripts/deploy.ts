import { ethers } from "hardhat";

async function main() {
  const HealthRecords = await ethers.getContractFactory("HealthRecords");
  const contract = await HealthRecords.deploy();
  await contract.waitForDeployment();

  console.log(`HealthRecords deployed to: ${await contract.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
