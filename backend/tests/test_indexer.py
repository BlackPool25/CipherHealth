"""
Tests for the Alchemy webhook handler and audit log integration.

These tests verify:
1. Webhook signature verification
2. Event parsing from Alchemy webhook payloads
3. Audit log creation from events
"""

import hashlib
import hmac
import json
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch, MagicMock

# Test data for webhook payloads
SAMPLE_UPLOAD_RECORDED_PAYLOAD = {
    "id": "webhook-123",
    "createdAt": "2025-12-01T12:00:00Z",
    "type": "ADDRESS_ACTIVITY",
    "event": {
        "network": "ETH_SEPOLIA",
        "activity": [
            {
                "rawContract": {
                    "address": "0x1234567890abcdef1234567890abcdef12345678"
                },
                "log": {
                    "topics": [
                        "0xUploadRecordedTopic",
                        "0x0000000000000000000000000000000000000000000000000000000000000001",  # cidHash
                        "0x0000000000000000000000000000000000000000000000000000000000000002",  # patientIdHash
                        "0x0000000000000000000000000000000000000000000000000000000000000003",  # hospitalIdHash
                    ],
                    "data": "0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef120000000000000000000000000000000000000000000000000000000065432100",
                    "transactionHash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
                    "blockNumber": "0x100",
                }
            }
        ]
    }
}


class TestSignatureVerification:
    """Tests for webhook signature verification."""
    
    def test_verify_signature_valid(self):
        """Test that valid signatures are accepted."""
        from app.indexer.alchemy_webhook_handler import verify_alchemy_signature
        
        payload = b'{"test": "data"}'
        signing_key = "test-secret-key"
        
        # Compute expected signature
        expected_sig = hmac.new(
            signing_key.encode("utf-8"),
            payload,
            hashlib.sha256
        ).hexdigest()
        
        assert verify_alchemy_signature(payload, expected_sig, signing_key) is True
    
    def test_verify_signature_invalid(self):
        """Test that invalid signatures are rejected."""
        from app.indexer.alchemy_webhook_handler import verify_alchemy_signature
        
        payload = b'{"test": "data"}'
        signing_key = "test-secret-key"
        invalid_sig = "invalid-signature"
        
        assert verify_alchemy_signature(payload, invalid_sig, signing_key) is False
    
    def test_verify_signature_no_key(self):
        """Test that verification is skipped when no key is configured (dev mode)."""
        from app.indexer.alchemy_webhook_handler import verify_alchemy_signature
        
        payload = b'{"test": "data"}'
        
        # Empty signing key should skip verification
        assert verify_alchemy_signature(payload, "any-signature", "") is True


class TestEventParsing:
    """Tests for event parsing from webhook payloads."""
    
    def test_parse_upload_recorded_event(self):
        """Test parsing UploadRecorded event."""
        from app.indexer.alchemy_webhook_handler import parse_event_data
        
        log = {
            "topics": [
                "0xUploadRecorded",
                "0x0000000000000000000000000000000000000000000000000000000000000001",
                "0x0000000000000000000000000000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000000000000000000000000000003",
            ],
            "data": "0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef120000000000000000000000000000000000000000000000000000000065432100",
        }
        
        result = parse_event_data(log)
        
        # The function should parse the event
        assert result is not None
        assert result["event_type"] == "UploadRecorded"
        assert "cid_hash" in result
        assert "patient_id_hash" in result
        assert "hospital_id_hash" in result
    
    def test_parse_access_granted_event(self):
        """Test parsing AccessGranted event."""
        from app.indexer.alchemy_webhook_handler import parse_event_data
        
        log = {
            "topics": [
                "0xAccessGranted",
                "0x0000000000000000000000000000000000000000000000000000000000000001",
                "0x0000000000000000000000000000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000000000000000000000000000003",
            ],
            "data": "0x0000000000000000000000000000000000000000000000000000000065432100" +
                    "0000000000000000000000000000000000000000000000000000000065432100",
        }
        
        result = parse_event_data(log)
        
        assert result is not None
        assert result["event_type"] == "AccessGranted"
    
    def test_parse_access_revoked_event(self):
        """Test parsing AccessRevoked event."""
        from app.indexer.alchemy_webhook_handler import parse_event_data
        
        log = {
            "topics": [
                "0xAccessRevoked",
                "0x0000000000000000000000000000000000000000000000000000000000000001",
                "0x0000000000000000000000000000000000000000000000000000000000000002",
                "0x0000000000000000000000000000000000000000000000000000000000000003",
            ],
            "data": "0x0000000000000000000000000000000000000000000000000000000065432100",
        }
        
        result = parse_event_data(log)
        
        assert result is not None
        assert result["event_type"] == "AccessRevoked"
    
    def test_parse_empty_log(self):
        """Test that empty logs return None."""
        from app.indexer.alchemy_webhook_handler import parse_event_data
        
        result = parse_event_data({})
        assert result is None
        
        result = parse_event_data({"topics": []})
        assert result is None


class TestAuditLogIntegration:
    """Tests for audit log creation from webhook events."""
    
    @pytest.mark.asyncio
    async def test_create_audit_log_from_event(self):
        """Test creating an audit log entry from a parsed event."""
        from app.db import create_audit_log, init_db
        
        # Initialize test database
        await init_db()
        
        # Create an audit log entry
        log_id = await create_audit_log(
            event_type="UploadRecorded",
            cid_hash="0x1234",
            patient_id_hash="0x5678",
            hospital_id_hash="0x9abc",
            details='{"test": "data"}',
            tx_hash="0xabcdef",
            block_number=100,
            chain_timestamp=1701432000,
        )
        
        assert log_id > 0
        print("AUDIT OK: Audit log created successfully")


def run_self_tests():
    """
    Run all self-tests for the indexer module.
    Returns True if all tests pass, False otherwise.
    """
    import sys
    
    # Run pytest programmatically
    exit_code = pytest.main([
        __file__,
        "-v",
        "--tb=short",
    ])
    
    if exit_code == 0:
        print("\n✅ PASS: All indexer tests passed")
        return True
    else:
        print("\n❌ FAIL: Some indexer tests failed")
        return False


if __name__ == "__main__":
    success = run_self_tests()
    exit(0 if success else 1)
