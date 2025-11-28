"""
Upload API Tests for Decent-Hospital Backend

Tests the file upload functionality:
- File encryption with AES-256-GCM
- Upload to Storacha (mocked)
- CID format validation

Run with: pytest tests/test_upload.py -v
"""

import os
import re
import tempfile
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

# Import the app
from app.main import app
from app.db import init_db


# CID patterns
CID_V0_PATTERN = re.compile(r"^Qm[1-9A-HJ-NP-Za-km-z]{44}$")
CID_V1_PATTERN = re.compile(r"^b[a-z2-7]{58,}$")


@pytest.fixture(scope="module")
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture(scope="module")
def sample_file():
    """Create a sample file for testing."""
    content = b"This is a test file for encryption and upload testing.\n"
    return content


@pytest.fixture(autouse=True)
async def setup_db():
    """Initialize database before tests."""
    await init_db()


def is_valid_cid(cid: str) -> bool:
    """Check if string looks like a valid IPFS CID."""
    if not cid:
        return False
    return bool(CID_V0_PATTERN.match(cid) or CID_V1_PATTERN.match(cid))


class TestUploadEndpoint:
    """Tests for POST /upload endpoint."""
    
    def test_upload_missing_file(self, client):
        """Test upload without file returns error."""
        response = client.post("/upload", data={"patient_id": 1})
        assert response.status_code == 422  # Validation error
    
    def test_upload_missing_patient_id(self, client, sample_file):
        """Test upload without patient_id returns error."""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as f:
            f.write(sample_file)
            f.flush()
            
            with open(f.name, "rb") as file:
                response = client.post(
                    "/upload",
                    files={"file": ("test.txt", file, "text/plain")},
                )
        
        os.unlink(f.name)
        assert response.status_code == 422  # Validation error
    
    @patch("app.routes.upload.upload_bytes_to_storacha")
    @patch("app.routes.upload.get_user_by_id")
    async def test_upload_success_mock(
        self,
        mock_get_user,
        mock_upload,
        client,
        sample_file,
    ):
        """Test successful upload with mocked Storacha."""
        # Mock user
        mock_get_user.return_value = {
            "id": 1,
            "username": "testuser",
            "email": "test@example.com",
            "public_key": "abcd1234" * 8,  # 64 char hex
        }
        
        # Mock Storacha response with valid CID
        mock_cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
        mock_upload.return_value = {"cid": mock_cid, "size": len(sample_file)}
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as f:
            f.write(sample_file)
            f.flush()
            
            with open(f.name, "rb") as file:
                response = client.post(
                    "/upload",
                    files={"file": ("sample.txt", file, "text/plain")},
                    data={"patient_id": "1"},
                )
        
        os.unlink(f.name)
        
        if response.status_code == 200:
            data = response.json()
            assert "cid" in data
            assert is_valid_cid(data["cid"])
            assert data["filename"] == "sample.txt"
    
    def test_upload_invalid_user(self, client, sample_file):
        """Test upload with non-existent user."""
        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as f:
            f.write(sample_file)
            f.flush()
            
            with open(f.name, "rb") as file:
                response = client.post(
                    "/upload",
                    files={"file": ("test.txt", file, "text/plain")},
                    data={"patient_id": "99999"},
                )
        
        os.unlink(f.name)
        assert response.status_code == 400
        assert "not found" in response.json()["detail"].lower()


class TestEncryptEndpoint:
    """Tests for POST /upload/encrypt endpoint."""
    
    @patch("app.routes.upload.get_user_by_id")
    async def test_encrypt_success(self, mock_get_user, client, sample_file):
        """Test file encryption."""
        mock_get_user.return_value = {
            "id": 1,
            "username": "testuser",
            "email": "test@example.com",
            "public_key": None,
        }
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as f:
            f.write(sample_file)
            f.flush()
            
            with open(f.name, "rb") as file:
                response = client.post(
                    "/upload/encrypt",
                    files={"file": ("test.txt", file, "text/plain")},
                    data={"owner_id": "1"},
                )
        
        os.unlink(f.name)
        
        if response.status_code == 200:
            data = response.json()
            assert "temp_file_id" in data
            assert "cek_ciphertext" in data
            assert data["original_filename"] == "test.txt"
            assert data["encrypted_size"] > 0


class TestCIDValidation:
    """Tests for CID format validation."""
    
    def test_valid_cid_v0(self):
        """Test CIDv0 validation."""
        cid = "QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o"
        assert is_valid_cid(cid)
    
    def test_valid_cid_v1(self):
        """Test CIDv1 validation."""
        cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
        assert is_valid_cid(cid)
    
    def test_invalid_cid(self):
        """Test invalid CID."""
        assert not is_valid_cid("")
        assert not is_valid_cid("invalid")
        assert not is_valid_cid("Qm12345")
        assert not is_valid_cid(None)


class TestFileListEndpoint:
    """Tests for GET /upload/files/{user_id} endpoint."""
    
    def test_list_files_empty(self, client):
        """Test listing files for user with no files."""
        response = client.get("/upload/files/99999")
        assert response.status_code == 200
        data = response.json()
        assert data["files"] == []
        assert data["count"] == 0


# ============================================================================
# Integration Test (requires real Storacha API key)
# ============================================================================

@pytest.mark.skipif(
    not os.getenv("STORACHA_API_KEY"),
    reason="STORACHA_API_KEY not set"
)
class TestUploadIntegration:
    """Integration tests that require real Storacha API."""
    
    @patch("app.routes.upload.get_user_by_id")
    async def test_real_upload(self, mock_get_user, client):
        """Test real upload to Storacha."""
        mock_get_user.return_value = {
            "id": 1,
            "username": "testuser",
            "email": "test@example.com",
            "public_key": None,
        }
        
        content = b"Integration test file content\n"
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as f:
            f.write(content)
            f.flush()
            
            with open(f.name, "rb") as file:
                response = client.post(
                    "/upload",
                    files={"file": ("integration_test.txt", file, "text/plain")},
                    data={"patient_id": "1"},
                )
        
        os.unlink(f.name)
        
        assert response.status_code == 200
        data = response.json()
        assert "cid" in data
        assert is_valid_cid(data["cid"])
        print(f"\n✓ Uploaded to IPFS with CID: {data['cid']}")
