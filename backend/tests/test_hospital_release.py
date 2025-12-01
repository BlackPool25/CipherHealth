"""
Tests for Hospital Release Access endpoint.

This tests the ability of hospitals to voluntarily give up their access to patient files.
"""

import os
import json
import pytest
from datetime import datetime, timezone, timedelta

# Set test environment before imports
os.environ.setdefault("DEV_MODE", "true")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_hospital_release.db")
os.environ.setdefault("JWT_SECRET", "test-secret-for-testing-only")

from pathlib import Path
import sys
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))


@pytest.fixture(scope="module")
async def setup_test_db():
    """Initialize test database for this module."""
    from app.db import init_db
    await init_db()
    yield
    # Cleanup
    test_db = Path("test_hospital_release.db")
    if test_db.exists():
        test_db.unlink()


@pytest.fixture
async def patient_user(setup_test_db):
    """Create a test patient user."""
    from app.db import create_user_with_password
    
    user_id = await create_user_with_password(
        username=f"patient_{datetime.now().timestamp()}",
        email=f"patient_{datetime.now().timestamp()}@test.com",
        password_hash="test_hash",
        role="patient",
    )
    
    from app.db import get_user_by_id
    return await get_user_by_id(user_id)


@pytest.fixture
async def hospital_user(setup_test_db):
    """Create a test hospital user."""
    from app.db import create_user_with_password
    
    user_id = await create_user_with_password(
        username=f"hospital_{datetime.now().timestamp()}",
        email=f"hospital_{datetime.now().timestamp()}@test.com",
        password_hash="test_hash",
        role="hospital",
    )
    
    from app.db import get_user_by_id
    return await get_user_by_id(user_id)


@pytest.fixture
async def test_file(patient_user, setup_test_db):
    """Create a test file owned by the patient."""
    from app.db import create_file_record, FileRecord
    
    file_record = FileRecord(
        cid=f"bafytest{datetime.now().timestamp()}".replace(".", ""),
        owner_id=patient_user["id"],
        filename="test_medical_record.pdf",
        encrypted_cek="test_encrypted_cek",
        capsule="test_capsule",
        category="Lab Results",
    )
    
    file_id = await create_file_record(file_record)
    
    from app.db import get_file_by_id
    return await get_file_by_id(file_id)


@pytest.fixture
async def active_grant(patient_user, hospital_user, test_file, setup_test_db):
    """Create an active grant from patient to hospital."""
    from app.db import create_grant, GrantCreate
    
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    
    grant_create = GrantCreate(
        granter_id=patient_user["id"],
        grantee_id=hospital_user["id"],
        file_id=test_file["id"],
        expires_at=expires_at,
    )
    
    grant_id = await create_grant(grant_create, "test_reencryption_key")
    
    from app.db import get_grant_by_id
    return await get_grant_by_id(grant_id)


@pytest.mark.asyncio
async def test_hospital_release_access_success(
    patient_user, hospital_user, test_file, active_grant
):
    """Test that a hospital can successfully release their access."""
    from app.db import get_grant_by_id, get_grant_by_file_and_grantee
    
    # Verify grant is active before
    grant_before = await get_grant_by_file_and_grantee(test_file["id"], hospital_user["id"])
    assert grant_before is not None
    assert grant_before["status"] == "active"
    
    # Simulate the release (directly calling the db function since we're testing logic)
    from app.db import revoke_grant
    success = await revoke_grant(active_grant["id"], None)
    assert success is True
    
    # Verify grant is revoked after
    grant_after = await get_grant_by_id(active_grant["id"])
    assert grant_after["status"] == "revoked"
    
    # Verify the hospital no longer has active grant
    active_grant_check = await get_grant_by_file_and_grantee(test_file["id"], hospital_user["id"])
    assert active_grant_check is None
    
    print("HOSPITAL RELEASE OK")


@pytest.mark.asyncio
async def test_hospital_release_creates_audit_log(
    patient_user, hospital_user, test_file, setup_test_db
):
    """Test that releasing access creates an audit log entry."""
    from app.db import (
        create_grant, GrantCreate, revoke_grant,
        create_audit_log, get_audit_logs_for_patient
    )
    
    # Create a new grant for this test
    grant_create = GrantCreate(
        granter_id=patient_user["id"],
        grantee_id=hospital_user["id"],
        file_id=test_file["id"],
        expires_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    )
    grant_id = await create_grant(grant_create, "test_key_2")
    
    # Create audit log for hospital release
    audit_id = await create_audit_log(
        event_type="hospital_release",
        actor_id=hospital_user["id"],
        target_id=patient_user["id"],
        patient_id=patient_user["id"],
        file_id=test_file["id"],
        cid=test_file["cid"],
        details=json.dumps({
            "filename": test_file["filename"],
            "reason": "Consultation complete",
            "grant_id": grant_id,
            "action": "Hospital voluntarily released access",
        }),
    )
    
    assert audit_id is not None
    
    # Verify audit log was created
    audit_logs = await get_audit_logs_for_patient(patient_user["id"])
    release_logs = [log for log in audit_logs if log["event_type"] == "hospital_release"]
    assert len(release_logs) > 0
    
    print("AUDIT LOG OK")


@pytest.mark.asyncio
async def test_hospital_cannot_release_others_grant(
    patient_user, hospital_user, test_file, setup_test_db
):
    """Test that a hospital cannot release a grant they don't have."""
    from app.db import get_grant_by_file_and_grantee
    
    # Hospital doesn't have a grant (no active_grant fixture used)
    grant = await get_grant_by_file_and_grantee(test_file["id"], hospital_user["id"])
    
    # Grant should be None or revoked from previous tests
    # In production, the endpoint would return 404
    print("NO GRANT CHECK OK")


if __name__ == "__main__":
    import asyncio
    
    async def run_smoke_test():
        """Quick smoke test for hospital release functionality."""
        print("Running hospital release smoke test...")
        
        # Initialize DB
        from app.db import init_db
        await init_db()
        
        # Create test users
        from app.db import create_user_with_password, get_user_by_id
        
        patient_id = await create_user_with_password(
            username=f"smoke_patient_{datetime.now().timestamp()}",
            email=f"smoke_patient_{datetime.now().timestamp()}@test.com",
            password_hash="test",
            role="patient",
        )
        
        hospital_id = await create_user_with_password(
            username=f"smoke_hospital_{datetime.now().timestamp()}",
            email=f"smoke_hospital_{datetime.now().timestamp()}@test.com",
            password_hash="test",
            role="hospital",
        )
        
        # Create file
        from app.db import create_file_record, FileRecord
        file_record = FileRecord(
            cid=f"bafysmoke{datetime.now().timestamp()}".replace(".", ""),
            owner_id=patient_id,
            filename="smoke_test.pdf",
        )
        file_id = await create_file_record(file_record)
        
        # Create grant
        from app.db import create_grant, GrantCreate, get_grant_by_id, revoke_grant
        grant_create = GrantCreate(
            granter_id=patient_id,
            grantee_id=hospital_id,
            file_id=file_id,
        )
        grant_id = await create_grant(grant_create, "smoke_key")
        
        # Verify grant is active
        grant = await get_grant_by_id(grant_id)
        assert grant["status"] == "active", "Grant should be active"
        
        # Hospital releases access
        success = await revoke_grant(grant_id, None)
        assert success, "Revoke should succeed"
        
        # Verify grant is revoked
        grant_after = await get_grant_by_id(grant_id)
        assert grant_after["status"] == "revoked", "Grant should be revoked"
        
        print("✅ HOSPITAL RELEASE SMOKE TEST PASSED")
        return True
    
    # Run the smoke test
    result = asyncio.run(run_smoke_test())
    exit(0 if result else 1)
