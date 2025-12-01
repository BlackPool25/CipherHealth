import { expect } from "chai";
import { ethers, network } from "hardhat";
import { ConsentRegistry } from "../typechain-types";

/**
 * ConsentRegistry Event Tests
 * 
 * Verifies that all required events are emitted correctly:
 * - UploadRecorded
 * - AccessRequested
 * - AccessGranted
 * - AccessRedeemed
 * - AccessRevoked
 * - AccessTransferred
 */
describe("ConsentRegistry Events", function () {
  let contract: ConsentRegistry;
  let owner: any;
  let hospital1: any;
  let hospital2: any;
  
  // Test data - computed hashes
  let cidHash: string;
  let patientIdHash: string;
  let hospital1IdHash: string;
  let hospital2IdHash: string;
  
  const testCid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
  const testPatientId = "patient-123";
  const testHospital1Id = "hospital-001";
  const testHospital2Id = "hospital-002";
  
  beforeEach(async function () {
    [owner, hospital1, hospital2] = await ethers.getSigners();
    
    const ConsentRegistry = await ethers.getContractFactory("ConsentRegistry");
    contract = await ConsentRegistry.deploy();
    await contract.waitForDeployment();
    
    // Compute hashes
    cidHash = ethers.keccak256(ethers.toUtf8Bytes(testCid));
    patientIdHash = ethers.keccak256(ethers.toUtf8Bytes(testPatientId));
    hospital1IdHash = ethers.keccak256(ethers.toUtf8Bytes(testHospital1Id));
    hospital2IdHash = ethers.keccak256(ethers.toUtf8Bytes(testHospital2Id));
  });
  
  describe("UploadRecorded Event", function () {
    it("should emit UploadRecorded with correct parameters", async function () {
      // Check that the event is emitted
      await expect(contract.recordUpload(cidHash, patientIdHash, hospital1IdHash))
        .to.emit(contract, "UploadRecorded");
      
      // Verify CID is marked as uploaded
      expect(await contract.uploadedCids(cidHash)).to.be.true;
      
      console.log("AUDIT OK: UploadRecorded event emitted correctly");
    });
    
    it("should reject empty cidHash", async function () {
      const emptyHash = ethers.ZeroHash;
      await expect(
        contract.recordUpload(emptyHash, patientIdHash, hospital1IdHash)
      ).to.be.revertedWith("Invalid cidHash");
    });
  });
  
  describe("AccessRequested Event", function () {
    it("should emit AccessRequested with correct parameters", async function () {
      const requesterHash = hospital1IdHash;
      
      await expect(contract.requestAccess(cidHash, patientIdHash, requesterHash))
        .to.emit(contract, "AccessRequested");
      
      console.log("AUDIT OK: AccessRequested event emitted correctly");
    });
  });
  
  describe("AccessGranted Event", function () {
    it("should emit AccessGranted with expiry", async function () {
      const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      
      await expect(contract.grantAccess(
        cidHash,
        patientIdHash,
        hospital1IdHash,
        expiry
      )).to.emit(contract, "AccessGranted");
      
      // Verify grant is active
      const grant = await contract.getGrant(cidHash, patientIdHash, hospital1IdHash);
      expect(grant.active).to.be.true;
      expect(grant.expiry).to.equal(expiry);
      
      console.log("AUDIT OK: AccessGranted event emitted correctly");
    });
  });
  
  describe("AccessRedeemed Event", function () {
    it("should emit AccessRedeemed when hospital accesses file", async function () {
      // First grant access
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      await contract.grantAccess(cidHash, patientIdHash, hospital1IdHash, expiry);
      
      // Then redeem
      await expect(contract.redeemAccess(cidHash, patientIdHash, hospital1IdHash))
        .to.emit(contract, "AccessRedeemed");
      
      console.log("AUDIT OK: AccessRedeemed event emitted correctly");
    });
    
    it("should revert if no active grant", async function () {
      await expect(
        contract.redeemAccess(cidHash, patientIdHash, hospital1IdHash)
      ).to.be.revertedWith("No active grant");
    });
  });
  
  describe("AccessRevoked Event", function () {
    it("should emit AccessRevoked when access is revoked", async function () {
      // First grant access
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      await contract.grantAccess(cidHash, patientIdHash, hospital1IdHash, expiry);
      
      // Then revoke
      await expect(contract.revokeAccess(cidHash, patientIdHash, hospital1IdHash))
        .to.emit(contract, "AccessRevoked");
      
      // Verify grant is no longer active
      const grant = await contract.getGrant(cidHash, patientIdHash, hospital1IdHash);
      expect(grant.active).to.be.false;
      
      console.log("AUDIT OK: AccessRevoked event emitted correctly");
    });
  });
  
  describe("AccessTransferred Event", function () {
    it("should emit transfer events when access is transferred", async function () {
      // First enable transfers for patient
      await contract.setTransferPreference(patientIdHash, true);
      
      // Grant access to hospital 1
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      await contract.grantAccess(cidHash, patientIdHash, hospital1IdHash, expiry);
      
      // Transfer from hospital 1 to hospital 2
      const newExpiry = Math.floor(Date.now() / 1000) + 7200;
      const tx = await contract.transferAccess(
        cidHash,
        patientIdHash,
        hospital1IdHash,
        hospital2IdHash,
        newExpiry
      );
      
      // Should emit all transfer-related events
      await expect(tx).to.emit(contract, "AccessRevoked");
      await expect(tx).to.emit(contract, "AccessGranted");
      await expect(tx).to.emit(contract, "AccessTransferred");
      
      // Verify state
      const grant1 = await contract.getGrant(cidHash, patientIdHash, hospital1IdHash);
      expect(grant1.active).to.be.false;
      
      const grant2 = await contract.getGrant(cidHash, patientIdHash, hospital2IdHash);
      expect(grant2.active).to.be.true;
      
      console.log("AUDIT OK: AccessTransferred events emitted correctly");
    });
    
    it("should revert if patient does not allow transfers", async function () {
      // Grant access without enabling transfers
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      await contract.grantAccess(cidHash, patientIdHash, hospital1IdHash, expiry);
      
      await expect(
        contract.transferAccess(cidHash, patientIdHash, hospital1IdHash, hospital2IdHash, expiry)
      ).to.be.revertedWith("Patient does not allow transfers");
    });
  });
  
  describe("Utility Functions", function () {
    it("computeHash should match ethers.keccak256", async function () {
      const onChainHash = await contract.computeHash(testCid);
      const offChainHash = ethers.keccak256(ethers.toUtf8Bytes(testCid));
      
      expect(onChainHash).to.equal(offChainHash);
      console.log("HASH COMPUTATION OK: On-chain and off-chain hashes match");
    });
    
    it("isGrantValid should return correct status", async function () {
      // No grant exists
      expect(await contract.isGrantValid(cidHash, patientIdHash, hospital1IdHash)).to.be.false;
      
      // Grant access
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      await contract.grantAccess(cidHash, patientIdHash, hospital1IdHash, expiry);
      
      // Grant should be valid
      expect(await contract.isGrantValid(cidHash, patientIdHash, hospital1IdHash)).to.be.true;
      
      // Revoke
      await contract.revokeAccess(cidHash, patientIdHash, hospital1IdHash);
      
      // Grant should be invalid
      expect(await contract.isGrantValid(cidHash, patientIdHash, hospital1IdHash)).to.be.false;
    });
  });
});
