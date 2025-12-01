"""
Integration tests for ConsentRegistry on-chain functions.

These tests interact with the actual deployed contract on Sepolia.
Requires:
- SEPOLIA_RPC_URL
- SIGNER_PRIVATE_KEY (funded with Sepolia ETH)
- HEALTH_RECORDS_CONTRACT_ADDRESS
"""

import asyncio
import os
from pathlib import Path
import pytest
from datetime import datetime, timezone

# Load environment variables from .env
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

# Skip all tests if chain is not configured
pytestmark = pytest.mark.skipif(
    not all([
        os.getenv("SEPOLIA_RPC_URL"),
        os.getenv("SIGNER_PRIVATE_KEY"),
        os.getenv("HEALTH_RECORDS_CONTRACT_ADDRESS"),
    ]),
    reason="Chain environment variables not configured"
)


class TestConsentRegistryOnChain:
    """Integration tests for ConsentRegistry contract on Sepolia."""
    
    @pytest.fixture
    def test_data(self):
        """Generate unique test data for each test."""
        timestamp = int(datetime.now(timezone.utc).timestamp())
        return {
            "cid": f"bafytest{timestamp}",
            "patient_id": f"patient-{timestamp}",
            "hospital_id": f"hospital-{timestamp}",
        }
    
    @pytest.mark.asyncio
    async def test_record_upload_on_chain(self, test_data):
        """Test recording an upload on the ConsentRegistry contract."""
        from app.utils.chain import record_upload_consent_registry
        
        result = await record_upload_consent_registry(
            cid=test_data["cid"],
            patient_id=test_data["patient_id"],
            hospital_id=test_data["hospital_id"],
        )
        
        assert result is not None
        assert "tx_hash" in result
        assert result["tx_hash"].startswith("0x")
        assert "block_number" in result
        assert result["block_number"] > 0
        
        print(f"\n✅ AUDIT OK: UploadRecorded on-chain")
        print(f"   TX: {result['tx_hash']}")
        print(f"   Block: {result['block_number']}")
        print(f"   View on Etherscan: https://sepolia.etherscan.io/tx/{result['tx_hash']}")
    
    @pytest.mark.asyncio
    async def test_verify_upload_on_chain(self, test_data):
        """Test verifying an upload exists on-chain."""
        from app.utils.chain import (
            record_upload_consent_registry,
            verify_upload_on_chain,
        )
        
        # First record the upload
        await record_upload_consent_registry(
            cid=test_data["cid"],
            patient_id=test_data["patient_id"],
            hospital_id=test_data["hospital_id"],
        )
        
        # Then verify it exists
        exists = await verify_upload_on_chain(test_data["cid"])
        assert exists is True
        
        # Verify non-existent CID returns False
        not_exists = await verify_upload_on_chain("nonexistent-cid-12345")
        assert not_exists is False
        
        print("\n✅ Upload verification OK")
    
    @pytest.mark.asyncio
    async def test_grant_access_on_chain(self, test_data):
        """Test granting access on the ConsentRegistry contract."""
        from app.utils.chain import (
            record_upload_consent_registry,
            grant_access_consent_registry,
            verify_grant_on_chain,
        )
        
        # First record the upload
        await record_upload_consent_registry(
            cid=test_data["cid"],
            patient_id=test_data["patient_id"],
            hospital_id=test_data["hospital_id"],
        )
        
        # Grant access with 1 hour expiry
        expiry = int(datetime.now(timezone.utc).timestamp()) + 3600
        
        result = await grant_access_consent_registry(
            cid=test_data["cid"],
            patient_id=test_data["patient_id"],
            hospital_id=test_data["hospital_id"],
            expiry=expiry,
        )
        
        assert result is not None
        assert "tx_hash" in result
        
        # Verify grant is valid
        is_valid = await verify_grant_on_chain(
            cid=test_data["cid"],
            patient_id=test_data["patient_id"],
            hospital_id=test_data["hospital_id"],
        )
        assert is_valid is True
        
        print(f"\n✅ GRANT FLOW OK: AccessGranted on-chain")
        print(f"   TX: {result['tx_hash']}")
    
    @pytest.mark.asyncio
    async def test_revoke_access_on_chain(self, test_data):
        """Test revoking access on the ConsentRegistry contract."""
        from app.utils.chain import (
            record_upload_consent_registry,
            grant_access_consent_registry,
            revoke_access_consent_registry,
            verify_grant_on_chain,
        )
        
        # First record and grant
        await record_upload_consent_registry(
            cid=test_data["cid"],
            patient_id=test_data["patient_id"],
            hospital_id=test_data["hospital_id"],
        )
        
        expiry = int(datetime.now(timezone.utc).timestamp()) + 3600
        await grant_access_consent_registry(
            cid=test_data["cid"],
            patient_id=test_data["patient_id"],
            hospital_id=test_data["hospital_id"],
            expiry=expiry,
        )
        
        # Then revoke
        result = await revoke_access_consent_registry(
            cid=test_data["cid"],
            patient_id=test_data["patient_id"],
            hospital_id=test_data["hospital_id"],
        )
        
        assert result is not None
        assert "tx_hash" in result
        
        # Verify grant is no longer valid
        is_valid = await verify_grant_on_chain(
            cid=test_data["cid"],
            patient_id=test_data["patient_id"],
            hospital_id=test_data["hospital_id"],
        )
        assert is_valid is False
        
        print(f"\n✅ REVOKE OK: AccessRevoked on-chain")
        print(f"   TX: {result['tx_hash']}")


def run_self_tests():
    """
    Run integration tests against the deployed contract.
    Returns True if all tests pass.
    """
    import sys
    
    # Check environment
    missing = []
    if not os.getenv("SEPOLIA_RPC_URL"):
        missing.append("SEPOLIA_RPC_URL")
    if not os.getenv("SIGNER_PRIVATE_KEY"):
        missing.append("SIGNER_PRIVATE_KEY")
    if not os.getenv("HEALTH_RECORDS_CONTRACT_ADDRESS"):
        missing.append("HEALTH_RECORDS_CONTRACT_ADDRESS")
    
    if missing:
        print(f"❌ FAIL: Missing environment variables: {', '.join(missing)}")
        return False
    
    exit_code = pytest.main([
        __file__,
        "-v",
        "--tb=short",
        "-x",  # Stop on first failure
    ])
    
    if exit_code == 0:
        print("\n✅ PASS: All on-chain integration tests passed")
        return True
    else:
        print("\n❌ FAIL: Some tests failed")
        return False


if __name__ == "__main__":
    success = run_self_tests()
    exit(0 if success else 1)
