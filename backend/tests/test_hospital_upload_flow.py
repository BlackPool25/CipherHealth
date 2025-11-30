"""
Hospital Upload Flow Tests

This module tests:
1. Hospital upload WITHOUT grant → HTTP 403
2. Hospital upload WITH grant → Upload success

Run with:
    python -m pytest backend/tests/test_hospital_upload_flow.py -v
    
Or run standalone:
    python backend/tests/test_hospital_upload_flow.py

Environment Variables (mock if not set):
- DEPLOYER_PRIVATE_KEY: If set, uses real chain client; otherwise mocks
- STORACHA_API_KEY: If set, uses real Storacha; otherwise mocks

References:
- FastAPI testing: https://fastapi.tiangolo.com/tutorial/testing/
- pyUmbral docs: https://pyumbral.readthedocs.io/
- Storacha docs: https://docs.storacha.network/
"""

import asyncio
import os
import sys
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from httpx import AsyncClient, ASGITransport


# ============================================================================
# Test Configuration
# ============================================================================

# Check if we should use real chain client
USE_MOCK_CHAIN = not os.getenv("DEPLOYER_PRIVATE_KEY")
USE_MOCK_STORACHA = not os.getenv("STORACHA_API_KEY")


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def mock_chain():
    """Mock chain client if DEPLOYER_PRIVATE_KEY not set."""
    if USE_MOCK_CHAIN:
        with patch("app.utils.chain.is_chain_configured", return_value=False):
            yield
    else:
        yield


@pytest.fixture
def mock_storacha():
    """Mock Storacha uploads if STORACHA_API_KEY not set."""
    if USE_MOCK_STORACHA:
        mock_result = {"cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"}
        with patch("app.utils.storage.upload_bytes_to_storacha", return_value=mock_result):
            with patch("app.utils.storage.is_valid_cid", return_value=True):
                yield
    else:
        yield


@pytest.fixture
def mock_umbral():
    """Mock Umbral operations for testing."""
    with patch("app.utils.umbral_utils.UMBRAL_AVAILABLE", True):
        with patch("app.utils.umbral_utils.generate_cek", return_value=os.urandom(32)):
            with patch("app.utils.umbral_utils.encrypt_with_cek", return_value=(b"encrypted", b"nonce12bytes")):
                with patch("app.utils.umbral_utils.encapsulate_cek", return_value=("capsule_hex", "cek_hex")):
                    yield


# ============================================================================
# Test Helpers
# ============================================================================

async def create_test_user(client: AsyncClient, role: str, username: str) -> dict:
    """Create a test user and return their info with token."""
    # Register user
    response = await client.post(
        "/auth/register-v2",
        json={
            "role": role,
            "username": username,
            "password": "testpass123",
            "email": f"{username}@test.com",
        },
    )
    
    if response.status_code == 200:
        data = response.json()
        return {
            "user_id": data["user_id"],
            "role": role,
            "token": data["access_token"],
            "username": username,
        }
    
    # If user exists, try login
    response = await client.post(
        "/auth/login",
        json={
            "username": username,
            "password": "testpass123",
        },
    )
    
    if response.status_code == 200:
        data = response.json()
        return {
            "user_id": data["user_id"],
            "role": role,
            "token": data["access_token"],
            "username": username,
        }
    
    raise Exception(f"Failed to create/login user: {response.text}")


async def set_patient_public_key(client: AsyncClient, patient: dict, public_key: str) -> None:
    """Set patient's public key via profile creation."""
    response = await client.post(
        f"/patients/{patient['user_id']}/create-base-profile",
        json={
            "name": "Test Patient",
            "public_key": public_key,
        },
        headers={"Authorization": f"Bearer {patient['token']}"},
    )
    assert response.status_code == 200, f"Failed to set public key: {response.text}"


async def grant_hospital_access(client: AsyncClient, patient: dict, hospital_id: int) -> None:
    """Patient grants hospital upload access."""
    response = await client.post(
        f"/patients/{patient['user_id']}/grant-hospital-access",
        data={"hospital_id": hospital_id},
        headers={"Authorization": f"Bearer {patient['token']}"},
    )
    assert response.status_code == 200, f"Failed to grant access: {response.text}"


# ============================================================================
# Tests
# ============================================================================

@pytest.mark.asyncio
async def test_hospital_upload_without_grant_returns_403(mock_chain, mock_storacha, mock_umbral):
    """
    Test that hospital upload without grant returns HTTP 403.
    
    Flow:
    1. Create hospital and patient users
    2. Patient sets up public key (but does NOT grant hospital access)
    3. Hospital attempts upload
    4. Assert 403 Forbidden
    """
    from app.main import app
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create users
        hospital = await create_test_user(client, "hospital", "test_hospital_403")
        patient = await create_test_user(client, "patient", "test_patient_403")
        
        # Patient sets public key (required for encryption)
        test_pubkey = "04" + "ab" * 32  # Fake EC public key
        await set_patient_public_key(client, patient, test_pubkey)
        
        # Hospital attempts upload WITHOUT grant
        file_content = b"This is test medical data"
        files = {"file": ("test.txt", BytesIO(file_content), "text/plain")}
        data = {"patient_id": patient["user_id"]}
        
        response = await client.post(
            "/upload/hospital",
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {hospital['token']}"},
        )
        
        # Should be 403 Forbidden
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        assert "permission" in response.json()["detail"].lower() or "grant" in response.json()["detail"].lower()
        
        print("✓ Upload without grant correctly returned 403")


@pytest.mark.asyncio
async def test_hospital_upload_with_grant_succeeds(mock_chain, mock_storacha, mock_umbral):
    """
    Test that hospital upload with grant succeeds.
    
    Flow:
    1. Create hospital and patient users
    2. Patient sets up public key
    3. Patient grants hospital access
    4. Hospital uploads file
    5. Assert success (200)
    """
    from app.main import app
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create users
        hospital = await create_test_user(client, "hospital", "test_hospital_200")
        patient = await create_test_user(client, "patient", "test_patient_200")
        
        # Patient sets public key
        test_pubkey = "04" + "cd" * 32  # Fake EC public key
        await set_patient_public_key(client, patient, test_pubkey)
        
        # Patient grants hospital access
        await grant_hospital_access(client, patient, hospital["user_id"])
        
        # Hospital uploads WITH grant
        file_content = b"This is authorized medical data"
        files = {"file": ("authorized.txt", BytesIO(file_content), "text/plain")}
        data = {"patient_id": patient["user_id"], "category": "lab_results"}
        
        response = await client.post(
            "/upload/hospital",
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {hospital['token']}"},
        )
        
        # Should succeed
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        result = response.json()
        assert "cid" in result
        assert result["patient_id"] == patient["user_id"]
        assert result["hospital_id"] == hospital["user_id"]
        
        print("✓ Upload with grant succeeded")
        print(f"  CID: {result['cid']}")


@pytest.mark.asyncio
async def test_non_hospital_cannot_use_hospital_endpoint(mock_chain, mock_storacha):
    """
    Test that a patient cannot use the hospital upload endpoint.
    """
    from app.main import app
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create patient (not hospital)
        patient = await create_test_user(client, "patient", "test_patient_not_hospital")
        
        # Attempt to use hospital endpoint
        file_content = b"Unauthorized upload attempt"
        files = {"file": ("hack.txt", BytesIO(file_content), "text/plain")}
        data = {"patient_id": patient["user_id"]}
        
        response = await client.post(
            "/upload/hospital",
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {patient['token']}"},
        )
        
        # Should be 403
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        
        print("✓ Non-hospital correctly rejected from hospital endpoint")


@pytest.mark.asyncio
async def test_patient_profile_creation():
    """
    Test patient profile creation endpoints.
    """
    from app.main import app
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create patient
        patient = await create_test_user(client, "patient", "test_patient_profile")
        
        # Create profile with public key
        response = await client.post(
            f"/patients/{patient['user_id']}/create-base-profile",
            json={
                "name": "John Doe",
                "dob": "1990-01-01",
                "public_key": "04" + "ef" * 32,
            },
            headers={"Authorization": f"Bearer {patient['token']}"},
        )
        
        assert response.status_code == 200
        result = response.json()
        assert result["patient_id"] == patient["user_id"]
        assert result["public_key"] == "04" + "ef" * 32
        
        print("✓ Patient profile creation works")


@pytest.mark.asyncio  
async def test_list_hospitals_for_patient():
    """
    Test listing hospitals with access to patient records.
    """
    from app.main import app
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create users
        hospital = await create_test_user(client, "hospital", "test_hospital_list")
        patient = await create_test_user(client, "patient", "test_patient_list")
        
        # Patient sets public key
        await set_patient_public_key(client, patient, "04" + "11" * 32)
        
        # Patient grants hospital access
        await grant_hospital_access(client, patient, hospital["user_id"])
        
        # List hospitals
        response = await client.get(
            f"/patients/{patient['user_id']}/hospitals",
            headers={"Authorization": f"Bearer {patient['token']}"},
        )
        
        assert response.status_code == 200
        result = response.json()
        assert result["count"] >= 1
        
        hospital_ids = [h["hospital_id"] for h in result["hospitals"]]
        assert hospital["user_id"] in hospital_ids
        
        print("✓ Hospital listing works")


# ============================================================================
# Standalone Runner
# ============================================================================

async def run_all_tests():
    """Run all tests and print summary."""
    print("=" * 60)
    print("Hospital Upload Flow Tests")
    print("=" * 60)
    print(f"Using mock chain: {USE_MOCK_CHAIN}")
    print(f"Using mock Storacha: {USE_MOCK_STORACHA}")
    print("-" * 60)
    
    from app.main import app
    from app.db import init_db
    
    # Initialize database
    await init_db()
    
    tests = [
        ("Upload without grant → 403", test_hospital_upload_without_grant_returns_403),
        ("Upload with grant → 200", test_hospital_upload_with_grant_succeeds),
        ("Non-hospital → 403", test_non_hospital_cannot_use_hospital_endpoint),
        ("Patient profile creation", test_patient_profile_creation),
        ("List hospitals for patient", test_list_hospitals_for_patient),
    ]
    
    passed = 0
    failed = 0
    
    for name, test_func in tests:
        try:
            print(f"\nRunning: {name}...")
            
            # Apply mocks
            if USE_MOCK_CHAIN:
                with patch("app.utils.chain.is_chain_configured", return_value=False):
                    if USE_MOCK_STORACHA:
                        mock_result = {"cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"}
                        with patch("app.utils.storage.upload_bytes_to_storacha", return_value=mock_result):
                            with patch("app.utils.storage.is_valid_cid", return_value=True):
                                with patch("app.utils.umbral_utils.UMBRAL_AVAILABLE", True):
                                    with patch("app.utils.umbral_utils.generate_cek", return_value=os.urandom(32)):
                                        with patch("app.utils.umbral_utils.encrypt_with_cek", return_value=(b"encrypted", b"nonce12bytes")):
                                            with patch("app.utils.umbral_utils.encapsulate_cek", return_value=("capsule_hex", "cek_hex")):
                                                await test_func()
                    else:
                        await test_func()
            else:
                await test_func()
            
            passed += 1
            
        except Exception as e:
            failed += 1
            print(f"  ✗ FAILED: {e}")
    
    print("\n" + "=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    
    if failed == 0:
        print("\nUPLOAD FLOW OK")
    else:
        print("\nSome tests failed!")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(run_all_tests())
