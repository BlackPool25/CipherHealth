"""
Unit tests for Access Management endpoints.

Tests the client-side-first workflow:
1. POST /request-access
2. POST /approve-access
3. POST /redeem
4. GET /records/:patient_id

Uses mocked chain client to avoid actual blockchain transactions.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport
import os
import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

# Set test environment
os.environ["DEV_MODE"] = "true"
os.environ["DATABASE_URL"] = "sqlite:///./test_access.db"
os.environ["JWT_SECRET"] = "test-secret-for-testing-only"

from app.main import app
from app.db import (
    init_db,
    create_user,
    create_file_record,
    create_invite_code,
    use_invite_code,
    UserCreate,
    FileRecord,
    DATABASE_PATH,
)
from app.routes.auth import create_access_token


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
async def test_db():
    """Initialize test database."""
    # Remove old test db if exists
    db_path = Path(DATABASE_PATH)
    if db_path.exists():
        db_path.unlink()
    
    await init_db()
    yield
    
    # Cleanup
    if db_path.exists():
        db_path.unlink()


@pytest.fixture
async def owner_user(test_db):
    """Create an owner/patient user."""
    user_data = UserCreate(
        username="test_owner",
        email="owner@test.com",
        invite_code="TEST_INVITE_1",
        public_key="04abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
    )
    
    # Create invite code
    try:
        await create_invite_code("TEST_INVITE_1")
    except:
        pass  # Already exists
    
    try:
        user_id = await create_user(user_data)
        await use_invite_code("TEST_INVITE_1", user_id)
    except:
        # User might already exist from previous test
        from app.db import get_user_by_username
        user = await get_user_by_username("test_owner")
        user_id = user["id"] if user else 1
    
    return {"id": user_id, "username": "test_owner", "public_key": user_data.public_key}


@pytest.fixture
async def requester_user(test_db):
    """Create a requester user."""
    user_data = UserCreate(
        username="test_requester",
        email="requester@test.com",
        invite_code="TEST_INVITE_2",
        public_key="04fedcba0987654321fedcba0987654321fedcba0987654321fedcba09876543",
    )
    
    try:
        await create_invite_code("TEST_INVITE_2")
    except:
        pass
    
    try:
        user_id = await create_user(user_data)
        await use_invite_code("TEST_INVITE_2", user_id)
    except:
        from app.db import get_user_by_username
        user = await get_user_by_username("test_requester")
        user_id = user["id"] if user else 2
    
    return {"id": user_id, "username": "test_requester", "public_key": user_data.public_key}


@pytest.fixture
async def test_file(test_db, owner_user):
    """Create a test file record."""
    file_record = FileRecord(
        cid="bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        owner_id=owner_user["id"],
        filename="test_medical_record.pdf",
        encrypted_cek="encrypted_cek_placeholder_1234567890",
        capsule="capsule_placeholder_0987654321fedcba",
    )
    
    try:
        file_id = await create_file_record(file_record)
    except:
        # File might already exist
        from app.db import get_file_by_cid
        existing = await get_file_by_cid(file_record.cid)
        file_id = existing["id"] if existing else 1
    
    return {
        "id": file_id,
        "cid": file_record.cid,
        "owner_id": owner_user["id"],
    }


@pytest.fixture
def owner_token(owner_user):
    """Create JWT token for owner."""
    return create_access_token(owner_user["id"], owner_user["username"])


@pytest.fixture
def requester_token(requester_user):
    """Create JWT token for requester."""
    return create_access_token(requester_user["id"], requester_user["username"])


@pytest.fixture
async def client():
    """Create async test client."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as ac:
        yield ac


# ============================================================================
# Test: POST /request-access
# ============================================================================

@pytest.mark.anyio
async def test_request_access_success(client, test_file, requester_user):
    """Test creating an access request."""
    response = await client.post(
        "/access/request-access",
        json={
            "cid": test_file["cid"],
            "requester_pubkey": requester_user["public_key"],
            "purpose": "Medical consultation review",
        },
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "request_id" in data
    assert data["status"] == "pending"


@pytest.mark.anyio
async def test_request_access_invalid_cid(client, requester_user):
    """Test that invalid CID format is rejected."""
    response = await client.post(
        "/access/request-access",
        json={
            "cid": "not-a-valid-cid",
            "requester_pubkey": requester_user["public_key"],
            "purpose": "Testing",
        },
    )
    
    assert response.status_code == 400
    assert "Invalid CID" in response.json()["detail"]


@pytest.mark.anyio
async def test_request_access_empty_purpose(client, test_file, requester_user):
    """Test that empty purpose is rejected."""
    response = await client.post(
        "/access/request-access",
        json={
            "cid": test_file["cid"],
            "requester_pubkey": requester_user["public_key"],
            "purpose": "",
        },
    )
    
    assert response.status_code == 400
    assert "Purpose is required" in response.json()["detail"]


# ============================================================================
# Test: POST /approve-access
# ============================================================================

@pytest.mark.anyio
async def test_approve_access_success(client, test_file, owner_token, requester_user):
    """Test approving an access request with mocked chain."""
    # First create a request
    request_response = await client.post(
        "/access/request-access",
        json={
            "cid": test_file["cid"],
            "requester_pubkey": requester_user["public_key"],
            "purpose": "Consultation",
        },
    )
    request_id = request_response.json()["request_id"]
    
    # Mock the chain client
    with patch("app.routes.access.CHAIN_AVAILABLE", False):
        with patch("app.routes.access.UMBRAL_AVAILABLE", False):
            response = await client.post(
                "/access/approve-access",
                headers={"Authorization": f"Bearer {owner_token}"},
                json={
                    "request_id": request_id,
                    "expiry_seconds": 3600,
                },
            )
    
    assert response.status_code == 200
    data = response.json()
    assert data["granted"] is True
    assert "tx_hash" in data
    assert "etherscan_url" in data


@pytest.mark.anyio
async def test_approve_access_not_owner(client, test_file, requester_token, requester_user):
    """Test that non-owner cannot approve access."""
    # Create a request first
    request_response = await client.post(
        "/access/request-access",
        json={
            "cid": test_file["cid"],
            "requester_pubkey": requester_user["public_key"],
            "purpose": "Testing",
        },
    )
    request_id = request_response.json()["request_id"]
    
    # Try to approve with non-owner token
    response = await client.post(
        "/access/approve-access",
        headers={"Authorization": f"Bearer {requester_token}"},
        json={"request_id": request_id, "expiry_seconds": 3600},
    )
    
    assert response.status_code == 403
    assert "not the owner" in response.json()["detail"]


@pytest.mark.anyio
async def test_approve_access_requires_auth(client):
    """Test that approve-access requires authentication."""
    response = await client.post(
        "/access/approve-access",
        json={"request_id": 1, "expiry_seconds": 3600},
    )
    
    assert response.status_code == 401


# ============================================================================
# Test: POST /redeem
# ============================================================================

@pytest.mark.anyio
async def test_redeem_access_no_approved_request(client, test_file, requester_token):
    """Test that redeem fails without approved request."""
    response = await client.post(
        "/access/redeem",
        headers={"Authorization": f"Bearer {requester_token}"},
        json={"cid": test_file["cid"]},
    )
    
    # Should fail because no approved access
    assert response.status_code in [400, 403]


@pytest.mark.anyio
async def test_redeem_access_requires_auth(client, test_file):
    """Test that redeem requires authentication."""
    response = await client.post(
        "/access/redeem",
        json={"cid": test_file["cid"]},
    )
    
    assert response.status_code == 401


# ============================================================================
# Test: GET /records/:patient_id
# ============================================================================

@pytest.mark.anyio
async def test_get_records_success(client, test_file, owner_user, owner_token):
    """Test getting patient records."""
    response = await client.get(
        f"/access/records/{owner_user['id']}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "records" in data
    assert "count" in data
    assert data["count"] >= 1
    
    # Verify record structure - should have capsule but no plaintext CEK
    if data["count"] > 0:
        record = data["records"][0]
        assert "cid" in record
        assert "filename" in record
        assert "capsule" in record
        assert "encrypted_cek" in record


@pytest.mark.anyio
async def test_get_records_requires_owner(client, owner_user, requester_token):
    """Test that you can only view your own records."""
    response = await client.get(
        f"/access/records/{owner_user['id']}",
        headers={"Authorization": f"Bearer {requester_token}"},
    )
    
    assert response.status_code == 403
    assert "only view your own records" in response.json()["detail"]


@pytest.mark.anyio
async def test_get_records_requires_auth(client, owner_user):
    """Test that records endpoint requires authentication."""
    response = await client.get(f"/access/records/{owner_user['id']}")
    
    assert response.status_code == 401


# ============================================================================
# Test: Full Flow (Request -> Approve -> Redeem)
# ============================================================================

@pytest.mark.anyio
async def test_full_access_flow(client, test_file, owner_user, requester_user, owner_token, requester_token):
    """Test the complete access request flow."""
    
    # Step 1: Requester requests access
    request_response = await client.post(
        "/access/request-access",
        json={
            "cid": test_file["cid"],
            "requester_pubkey": requester_user["public_key"],
            "purpose": "Full flow test - consultation",
        },
    )
    assert request_response.status_code == 200
    request_id = request_response.json()["request_id"]
    
    # Step 2: Owner sees pending request
    pending_response = await client.get(
        "/access/pending-requests",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert pending_response.status_code == 200
    assert pending_response.json()["count"] >= 1
    
    # Step 3: Owner approves (with mocked chain and umbral)
    with patch("app.routes.access.CHAIN_AVAILABLE", False):
        with patch("app.routes.access.UMBRAL_AVAILABLE", False):
            approve_response = await client.post(
                "/access/approve-access",
                headers={"Authorization": f"Bearer {owner_token}"},
                json={"request_id": request_id, "expiry_seconds": 3600},
            )
    
    assert approve_response.status_code == 200
    assert approve_response.json()["granted"] is True
    
    # Step 4: Requester redeems (with mocked umbral)
    with patch("app.routes.access.UMBRAL_AVAILABLE", False):
        with patch("app.routes.access.CHAIN_AVAILABLE", False):
            redeem_response = await client.post(
                "/access/redeem",
                headers={"Authorization": f"Bearer {requester_token}"},
                json={"cid": test_file["cid"]},
            )
    
    assert redeem_response.status_code == 200
    data = redeem_response.json()
    assert "reenc_capsule" in data
    assert "cid" in data
    assert "blob_url" in data
    assert data["cid"] == test_file["cid"]


# ============================================================================
# Test: Pending Requests
# ============================================================================

@pytest.mark.anyio
async def test_get_pending_requests(client, owner_token):
    """Test listing pending access requests."""
    response = await client.get(
        "/access/pending-requests",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "requests" in data
    assert "count" in data


@pytest.mark.anyio
async def test_pending_requests_requires_auth(client):
    """Test that pending-requests requires authentication."""
    response = await client.get("/access/pending-requests")
    
    assert response.status_code == 401


# ============================================================================
# Test: Deny Access
# ============================================================================

@pytest.mark.anyio
async def test_deny_access(client, test_file, owner_token, requester_user):
    """Test denying an access request."""
    # Create a request
    request_response = await client.post(
        "/access/request-access",
        json={
            "cid": test_file["cid"],
            "requester_pubkey": requester_user["public_key"],
            "purpose": "To be denied",
        },
    )
    request_id = request_response.json()["request_id"]
    
    # Deny it
    response = await client.post(
        f"/access/deny-access/{request_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    
    assert response.status_code == 200
    assert response.json()["request_id"] == request_id


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
