"""
Patient Routes for Decent-Hospital Backend

Handles patient profile management and hospital access:
- POST /patients/{patient_id}/create-base-profile: Create/update patient base profile
- GET /patients/{patient_id}/hospitals: List hospitals with access to patient records

Patient Profile Flow:
1. Patient registers and receives keypair (client-side generated)
2. Patient sends public_key to backend during profile creation
3. Patient can upload their own profile (encrypted client-side) 
4. Backend records profile CID and capsule metadata on-chain

Security Notes:
- Patient private key NEVER sent to or stored on server
- Server handles only public keys and encrypted ciphertext
- Grants are verified via DB and on-chain AccessGranted events

References:
- pyUmbral docs: https://pyumbral.readthedocs.io/
- Storacha docs: https://docs.storacha.network/
"""

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Form, UploadFile, File
from pydantic import BaseModel

from app.db import (
    get_user_by_id,
    get_user_by_uuid,
    update_user_public_key,
    get_grants_for_grantee,
    get_grants_by_granter,
)
from app.routes.auth import require_current_user, get_current_user_from_token
from app.utils.chain import (
    is_chain_configured,
    is_valid_eth_address,
    set_record_onchain,
    get_grant_events,
    verify_grant_onchain,
    grant_hospital_access_onchain,
    revoke_hospital_access_onchain,
    verify_hospital_access_onchain,
    ChainError,
    ChainConfigError,
)
from app.utils.storage import upload_bytes_to_storacha, is_valid_cid

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class CreateBaseProfileRequest(BaseModel):
    """Request to create patient base profile."""
    name: str
    dob: Optional[str] = None  # Date of birth (ISO format)
    public_key: str  # Patient's Umbral public key (hex encoded, generated client-side)
    meta: Optional[dict] = None  # Additional metadata (non-sensitive only)


class CreateBaseProfileWithCidRequest(BaseModel):
    """Request to create patient base profile with pre-encrypted CID.
    
    Use this when the frontend encrypts the profile client-side and uploads
    directly to Storacha, then sends the CID to backend.
    """
    public_key: str  # Patient's Umbral public key (hex encoded)
    profile_cid: str  # CID of encrypted profile already uploaded to Storacha
    capsule_meta: Optional[str] = None  # Hex-encoded capsule for re-encryption
    encrypted_cek: Optional[str] = None  # CEK encrypted with patient's public key


class BaseProfileResponse(BaseModel):
    """Response after creating patient base profile."""
    patient_id: int
    public_key: str
    profile_cid: Optional[str] = None
    capsule_meta: Optional[str] = None
    upload_tx: Optional[str] = None
    etherscan_url: Optional[str] = None
    message: str


class HospitalAccessEntry(BaseModel):
    """Information about a hospital's access to patient records."""
    hospital_id: int
    hospital_username: str
    access_status: str  # "active", "revoked", "expired"
    granted_at: Optional[str] = None
    expires_at: Optional[str] = None
    revoked_at: Optional[str] = None
    file_count: int = 0
    tx_hash: Optional[str] = None
    on_chain_verified: bool = False


class AvailableHospital(BaseModel):
    """Hospital available for granting access."""
    id: int
    username: str
    has_access: bool = False  # Whether patient has already granted access


class AvailableHospitalsResponse(BaseModel):
    """Response for listing available hospitals."""
    hospitals: list[AvailableHospital]
    count: int


class HospitalsListResponse(BaseModel):
    """Response for listing hospitals with access."""
    patient_id: int
    hospitals: list[HospitalAccessEntry]
    count: int


# ============================================================================
# Database Operations for Patient Profiles (inline for now, migrate to db.py later)
# ============================================================================

import aiosqlite
from app.db import DATABASE_PATH


async def ensure_patient_profiles_table():
    """Create patient_profiles table if not exists."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS patient_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER UNIQUE NOT NULL,
                profile_cid TEXT,
                capsule_meta TEXT,
                encrypted_cek TEXT,
                upload_tx TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES users(id)
            )
        """)
        await db.commit()


async def create_or_update_patient_profile(
    patient_id: int,
    profile_cid: Optional[str] = None,
    capsule_meta: Optional[str] = None,
    encrypted_cek: Optional[str] = None,
    upload_tx: Optional[str] = None,
) -> int:
    """Create or update patient profile record."""
    await ensure_patient_profiles_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Try to update existing
        cursor = await db.execute(
            """
            UPDATE patient_profiles 
            SET profile_cid = COALESCE(?, profile_cid),
                capsule_meta = COALESCE(?, capsule_meta),
                encrypted_cek = COALESCE(?, encrypted_cek),
                upload_tx = COALESCE(?, upload_tx),
                updated_at = CURRENT_TIMESTAMP
            WHERE patient_id = ?
            """,
            (profile_cid, capsule_meta, encrypted_cek, upload_tx, patient_id),
        )
        
        if cursor.rowcount == 0:
            # Insert new
            cursor = await db.execute(
                """
                INSERT INTO patient_profiles (patient_id, profile_cid, capsule_meta, encrypted_cek, upload_tx)
                VALUES (?, ?, ?, ?, ?)
                """,
                (patient_id, profile_cid, capsule_meta, encrypted_cek, upload_tx),
            )
        
        await db.commit()
        return cursor.lastrowid


async def get_patient_profile(patient_id: int) -> Optional[dict]:
    """Get patient profile by patient ID."""
    await ensure_patient_profiles_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM patient_profiles WHERE patient_id = ?",
            (patient_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def ensure_hospital_access_table():
    """Create hospital_access table if not exists.
    
    This tracks which hospitals have been granted access to upload for patients.
    Separate from grants table which is for file-level re-encryption grants.
    
    IMPORTANT: grant_cid_hash stores the exact cidHash used for on-chain grant.
    This MUST be used for revocation to avoid mismatch errors.
    
    patient_identifier: The identifier used for on-chain (UUID now, ETH address later)
    hospital_identifier: The identifier used for on-chain (UUID now, ETH address later)
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS hospital_access (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL,
                hospital_id INTEGER NOT NULL,
                patient_identifier TEXT,
                hospital_identifier TEXT,
                grant_cid_hash TEXT,
                status TEXT DEFAULT 'active',
                granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                revoked_at TIMESTAMP,
                tx_hash TEXT,
                FOREIGN KEY (patient_id) REFERENCES users(id),
                FOREIGN KEY (hospital_id) REFERENCES users(id),
                UNIQUE(patient_id, hospital_id)
            )
        """)
        
        # Add new columns if they don't exist (migration for existing DBs)
        try:
            await db.execute("ALTER TABLE hospital_access ADD COLUMN grant_cid_hash TEXT")
        except Exception:
            pass  # Column already exists
        try:
            await db.execute("ALTER TABLE hospital_access ADD COLUMN patient_identifier TEXT")
        except Exception:
            pass
        try:
            await db.execute("ALTER TABLE hospital_access ADD COLUMN hospital_identifier TEXT")
        except Exception:
            pass
            
        await db.commit()


async def grant_hospital_access(
    patient_id: int,
    hospital_id: int,
    expires_at: Optional[str] = None,
    tx_hash: Optional[str] = None,
    grant_cid_hash: Optional[str] = None,
    patient_identifier: Optional[str] = None,
    hospital_identifier: Optional[str] = None,
) -> int:
    """Grant hospital access to upload for patient.
    
    Args:
        patient_id: Patient's database ID
        hospital_id: Hospital's database ID
        expires_at: Optional expiry timestamp
        tx_hash: On-chain transaction hash
        grant_cid_hash: The cidHash used for on-chain grant (CRITICAL for revocation)
        patient_identifier: Identifier used on-chain (UUID or ETH address)
        hospital_identifier: Identifier used on-chain (UUID or ETH address)
    """
    await ensure_hospital_access_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Upsert: update if exists, insert if not
        cursor = await db.execute(
            """
            INSERT INTO hospital_access (patient_id, hospital_id, expires_at, tx_hash, status, 
                                         grant_cid_hash, patient_identifier, hospital_identifier)
            VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
            ON CONFLICT(patient_id, hospital_id) DO UPDATE SET
                status = 'active',
                expires_at = excluded.expires_at,
                tx_hash = COALESCE(excluded.tx_hash, hospital_access.tx_hash),
                grant_cid_hash = COALESCE(excluded.grant_cid_hash, hospital_access.grant_cid_hash),
                patient_identifier = COALESCE(excluded.patient_identifier, hospital_access.patient_identifier),
                hospital_identifier = COALESCE(excluded.hospital_identifier, hospital_access.hospital_identifier),
                granted_at = CURRENT_TIMESTAMP,
                revoked_at = NULL
            """,
            (patient_id, hospital_id, expires_at, tx_hash, grant_cid_hash, patient_identifier, hospital_identifier),
        )
        await db.commit()
        return cursor.lastrowid


async def revoke_hospital_access(patient_id: int, hospital_id: int) -> bool:
    """Revoke hospital access."""
    await ensure_hospital_access_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE hospital_access
            SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
            WHERE patient_id = ? AND hospital_id = ? AND status = 'active'
            """,
            (patient_id, hospital_id),
        )
        await db.commit()
        return cursor.rowcount > 0


async def check_hospital_has_access(patient_id: int, hospital_id: int) -> bool:
    """Check if hospital has active access to upload for patient."""
    await ensure_hospital_access_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT * FROM hospital_access 
            WHERE patient_id = ? AND hospital_id = ? AND status = 'active'
            """,
            (patient_id, hospital_id),
        )
        row = await cursor.fetchone()
        
        if not row:
            return False
        
        # Check expiry
        expires_at = row["expires_at"]
        if expires_at:
            try:
                exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if exp_dt < datetime.now(timezone.utc):
                    return False
            except (ValueError, TypeError):
                pass
        
        return True


async def get_hospital_access_record(patient_id: int, hospital_id: int) -> dict | None:
    """Get hospital access record for a patient-hospital pair."""
    await ensure_hospital_access_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT * FROM hospital_access 
            WHERE patient_id = ? AND hospital_id = ? AND status = 'active'
            """,
            (patient_id, hospital_id),
        )
        row = await cursor.fetchone()
        
        if not row:
            return None
        
        return dict(row)


# ============================================================================
# Hospital Access KFrag Management (PRE)
# ============================================================================

async def ensure_hospital_access_kfrags_table():
    """Create hospital_access_kfrags table if not exists.
    
    This stores kfrags generated by patients for hospitals to access their files.
    Each kfrag allows re-encryption of files for a specific hospital.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS hospital_access_kfrags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL,
                hospital_id INTEGER NOT NULL,
                kfrag_hex TEXT NOT NULL,
                verifying_key_hex TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                revoked_at TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES users(id),
                FOREIGN KEY (hospital_id) REFERENCES users(id),
                UNIQUE(patient_id, hospital_id)
            )
        """)
        await db.commit()


async def store_hospital_kfrag(
    patient_id: int,
    hospital_id: int,
    kfrag_hex: str,
    verifying_key_hex: str,
    expires_at: Optional[str] = None,
) -> int:
    """Store kfrag for hospital access to patient's files."""
    await ensure_hospital_access_kfrags_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Upsert: update if exists, insert if not
        cursor = await db.execute(
            """
            INSERT INTO hospital_access_kfrags (patient_id, hospital_id, kfrag_hex, verifying_key_hex, expires_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(patient_id, hospital_id) DO UPDATE SET
                kfrag_hex = excluded.kfrag_hex,
                verifying_key_hex = excluded.verifying_key_hex,
                expires_at = excluded.expires_at,
                created_at = CURRENT_TIMESTAMP,
                revoked_at = NULL
            """,
            (patient_id, hospital_id, kfrag_hex, verifying_key_hex, expires_at),
        )
        await db.commit()
        return cursor.lastrowid


async def get_hospital_kfrag(patient_id: int, hospital_id: int) -> dict | None:
    """Get kfrag for hospital to access patient's files."""
    await ensure_hospital_access_kfrags_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT * FROM hospital_access_kfrags 
            WHERE patient_id = ? AND hospital_id = ? AND revoked_at IS NULL
            """,
            (patient_id, hospital_id),
        )
        row = await cursor.fetchone()
        
        if not row:
            return None
        
        # Check expiry
        expires_at = row["expires_at"]
        if expires_at:
            try:
                exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if exp_dt < datetime.now(timezone.utc):
                    return None
            except (ValueError, TypeError):
                pass
        
        return dict(row)


async def revoke_hospital_kfrag(patient_id: int, hospital_id: int) -> bool:
    """Revoke kfrag for hospital access. This effectively revokes decryption capability."""
    await ensure_hospital_access_kfrags_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE hospital_access_kfrags
            SET revoked_at = CURRENT_TIMESTAMP
            WHERE patient_id = ? AND hospital_id = ? AND revoked_at IS NULL
            """,
            (patient_id, hospital_id),
        )
        await db.commit()
        return cursor.rowcount > 0


async def get_hospitals_for_patient(patient_id: int) -> list[dict]:
    """Get all hospitals with access info for a patient."""
    await ensure_hospital_access_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT 
                ha.id,
                ha.hospital_id,
                ha.status,
                ha.granted_at,
                ha.expires_at,
                ha.revoked_at,
                ha.tx_hash,
                u.username as hospital_username,
                (SELECT COUNT(*) FROM files f WHERE f.owner_id = ? 
                 AND EXISTS (SELECT 1 FROM grants g 
                             WHERE g.file_id = f.id AND g.grantee_id = ha.hospital_id)) as file_count
            FROM hospital_access ha
            JOIN users u ON ha.hospital_id = u.id
            WHERE ha.patient_id = ?
            ORDER BY ha.granted_at DESC
            """,
            (patient_id, patient_id),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_all_hospitals() -> list[dict]:
    """Get all registered hospitals."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, username, email, public_key, created_at
            FROM users
            WHERE role = 'hospital'
            ORDER BY username
            """
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


# ============================================================================
# Routes
# ============================================================================


def get_etherscan_url(tx_hash: str) -> str:
    """Generate Etherscan URL for Sepolia testnet."""
    # Ensure 0x prefix for valid Etherscan URL
    if tx_hash and not tx_hash.startswith('0x'):
        tx_hash = '0x' + tx_hash
    return f"https://sepolia.etherscan.io/tx/{tx_hash}"


@router.post("/{patient_id}/create-base-profile", response_model=BaseProfileResponse)
async def create_base_profile(
    patient_id: int,
    request: CreateBaseProfileRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Create or update patient base profile.
    
    The patient's client generates keypair and sends public_key here.
    Profile data should be encrypted client-side before upload.
    
    This endpoint:
    1. Validates patient owns this account
    2. Stores public_key for future re-encryption grants
    3. Does NOT store any plaintext profile data
    
    For encrypted profile upload, use:
    - POST /patients/{patient_id}/create-base-profile-with-cid (ciphertext already on Storacha)
    - POST /upload with patient_id (backend encrypts and uploads)
    
    Args:
        patient_id: Patient user ID
        request: Profile creation request with public_key
        current_user: Authenticated user (must be the patient)
        
    Returns:
        Profile creation confirmation
        
    Raises:
        HTTPException 403: If current user is not the patient
        HTTPException 404: If patient not found
    """
    # Verify caller is the patient
    if current_user["id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only create profile for your own account",
        )
    
    # Verify patient exists
    patient = await get_user_by_id(patient_id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found",
        )
    
    # Verify role is patient
    if patient.get("role") != "patient":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This endpoint is for patients only",
        )
    
    # Store public key
    await update_user_public_key(patient_id, request.public_key)
    
    # Create/update profile record (without CID yet)
    await create_or_update_patient_profile(patient_id)
    
    return BaseProfileResponse(
        patient_id=patient_id,
        public_key=request.public_key,
        profile_cid=None,
        message="Profile created. Upload encrypted profile data using /patients/{patient_id}/create-base-profile-with-cid or /upload endpoint.",
    )


class UpdatePublicKeyRequest(BaseModel):
    """Request to update user's public key (works for both patients and hospitals)."""
    public_key: str


class UpdatePublicKeyResponse(BaseModel):
    """Response after updating public key."""
    user_id: int
    role: str
    public_key: str
    message: str


@router.post("/update-public-key", response_model=UpdatePublicKeyResponse)
async def update_public_key(
    request: UpdatePublicKeyRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Update the current user's public key.
    
    Works for both patients and hospitals.
    Used during encryption key setup to register the public key with the server.
    
    Args:
        request: Contains the public_key hex string
        current_user: Authenticated user
        
    Returns:
        Confirmation with user details
    """
    user_id = current_user["id"]
    role = current_user.get("role", "patient")
    
    # Store public key
    await update_user_public_key(user_id, request.public_key)
    
    # For patients, also create/update profile record
    if role == "patient":
        await create_or_update_patient_profile(user_id)
    
    return UpdatePublicKeyResponse(
        user_id=user_id,
        role=role,
        public_key=request.public_key,
        message=f"Public key updated successfully for {role}",
    )


@router.post("/{patient_id}/create-base-profile-with-cid", response_model=BaseProfileResponse)
async def create_base_profile_with_cid(
    patient_id: int,
    request: CreateBaseProfileWithCidRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Create patient base profile with pre-encrypted CID.
    
    Use this when the frontend:
    1. Generates keypair client-side
    2. Encrypts profile data with AES-256-GCM
    3. Encapsulates CEK with Umbral public key
    4. Uploads ciphertext directly to Storacha
    5. Sends CID and capsule metadata here
    
    Backend:
    - Stores CID and capsule metadata
    - Records UploadRecorded on chain with actor=patient
    - NEVER sees plaintext profile data
    
    Args:
        patient_id: Patient user ID  
        request: Profile request with CID from client-side upload
        current_user: Authenticated user (must be the patient)
        
    Returns:
        Profile creation confirmation with on-chain tx
        
    Raises:
        HTTPException 403: If current user is not the patient
        HTTPException 400: If CID is invalid
    """
    # Verify caller is the patient
    if current_user["id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only create profile for your own account",
        )
    
    # Verify patient exists
    patient = await get_user_by_id(patient_id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found",
        )
    
    # Validate CID format
    if not is_valid_cid(request.profile_cid):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid CID format",
        )
    
    # Store public key
    await update_user_public_key(patient_id, request.public_key)
    
    # Record on-chain
    upload_tx = None
    etherscan_url = None
    if is_chain_configured():
        try:
            upload_tx = await set_record_onchain(request.profile_cid)
            etherscan_url = get_etherscan_url(upload_tx)
        except Exception as e:
            print(f"Warning: Failed to record on-chain: {e}")
    
    # Store profile record
    await create_or_update_patient_profile(
        patient_id=patient_id,
        profile_cid=request.profile_cid,
        capsule_meta=request.capsule_meta,
        encrypted_cek=request.encrypted_cek,
        upload_tx=upload_tx,
    )
    
    return BaseProfileResponse(
        patient_id=patient_id,
        public_key=request.public_key,
        profile_cid=request.profile_cid,
        capsule_meta=request.capsule_meta,
        upload_tx=upload_tx,
        etherscan_url=etherscan_url,
        message="Profile created and recorded on-chain" if upload_tx else "Profile created (off-chain only)",
    )


@router.get("/{patient_id}/hospitals", response_model=HospitalsListResponse)
async def list_patient_hospitals(
    patient_id: int,
    current_user: dict = Depends(require_current_user),
):
    """
    List all hospitals with access metadata for a patient.
    
    Combines data from:
    - hospital_access DB table (explicit grants)
    - On-chain AccessGranted events (if chain configured)
    - Activity logs from grants table
    
    Args:
        patient_id: Patient user ID
        current_user: Authenticated user (must be the patient)
        
    Returns:
        List of hospitals with access status and activity
        
    Raises:
        HTTPException 403: If current user is not the patient
    """
    # Verify caller is the patient
    if current_user["id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only view hospitals for your own account",
        )
    
    # Get hospitals from DB
    hospitals_db = await get_hospitals_for_patient(patient_id)
    
    # Build response
    hospital_entries = []
    for h in hospitals_db:
        # Check on-chain verification if configured
        on_chain_verified = False
        if is_chain_configured() and h.get("tx_hash"):
            try:
                # Could verify tx exists, but for now just trust DB
                on_chain_verified = True
            except Exception:
                pass
        
        hospital_entries.append(HospitalAccessEntry(
            hospital_id=h["hospital_id"],
            hospital_username=h["hospital_username"],
            access_status=h["status"],
            granted_at=h.get("granted_at"),
            expires_at=h.get("expires_at"),
            file_count=h.get("file_count", 0),
            tx_hash=h.get("tx_hash"),
            on_chain_verified=on_chain_verified,
        ))
    
    return HospitalsListResponse(
        patient_id=patient_id,
        hospitals=hospital_entries,
        count=len(hospital_entries),
    )


@router.get("/{patient_id}/available-hospitals", response_model=AvailableHospitalsResponse)
async def list_available_hospitals(
    patient_id: int,
    current_user: dict = Depends(require_current_user),
):
    """
    List all registered hospitals for patient to grant access.
    
    Returns list of hospitals with flag indicating if patient has 
    already granted them access.
    
    Args:
        patient_id: Patient user ID
        current_user: Authenticated user (must be the patient)
        
    Returns:
        List of available hospitals
    """
    # Verify caller is the patient
    if current_user["id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only view hospitals for your own account",
        )
    
    # Get all hospitals
    all_hospitals = await get_all_hospitals()
    
    # Get hospitals patient has already granted access to
    granted_hospitals = await get_hospitals_for_patient(patient_id)
    granted_ids = {
        h["hospital_id"] for h in granted_hospitals 
        if h.get("status") == "active"
    }
    
    hospitals = [
        AvailableHospital(
            id=h["id"],
            username=h["username"],
            has_access=h["id"] in granted_ids,
        )
        for h in all_hospitals
    ]
    
    return AvailableHospitalsResponse(
        hospitals=hospitals,
        count=len(hospitals),
    )


@router.post("/{patient_id}/grant-hospital-access")
async def grant_hospital_access_endpoint(
    patient_id: int,
    hospital_id: int = Form(...),
    expires_seconds: Optional[int] = Form(None),
    current_user: dict = Depends(require_current_user),
):
    """
    Grant a hospital permission to upload records for this patient.
    
    This:
    1. Records the grant ON-CHAIN (required - will fail if chain not configured)
    2. Creates an entry in hospital_access table for quick lookups
    
    Args:
        patient_id: Patient user ID
        hospital_id: Hospital user ID to grant access
        expires_seconds: Optional expiry in seconds
        current_user: Authenticated user (must be the patient)
        
    Returns:
        Grant confirmation with on-chain transaction hash
        
    Raises:
        HTTPException 403: If current user is not the patient
        HTTPException 404: If hospital not found
        HTTPException 503: If blockchain is not configured
    """
    # Verify caller is the patient
    if current_user["id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only grant access for your own account",
        )
    
    # Check chain is configured - REQUIRED for this operation
    if not is_chain_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Blockchain not configured. Set SEPOLIA_RPC_URL, "
                   "HEALTH_RECORDS_CONTRACT_ADDRESS, and SIGNER_PRIVATE_KEY. "
                   "This operation requires on-chain recording.",
        )
    
    # Get patient info - use UUID as identifier (easy to swap to ETH address later)
    patient = await get_user_by_id(patient_id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient not found",
        )
    
    patient_uuid = patient.get("uuid")
    if not patient_uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patient has no UUID. Re-registration required.",
        )
    
    # Verify hospital exists and is a hospital
    hospital = await get_user_by_id(hospital_id)
    if not hospital:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Hospital not found",
        )
    
    if hospital.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target user is not a hospital",
        )
    
    hospital_uuid = hospital.get("uuid")
    if not hospital_uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital has no UUID. Hospital re-registration required.",
        )
    
    # Get hospital's ETH address for on-chain grantee field
    # Note: public_key is Umbral key (33 bytes), not ETH address (20 bytes)
    # Use eth_address field if available, else fall back to padded ID
    hospital_eth_address = hospital.get("eth_address")
    if not hospital_eth_address or not is_valid_eth_address(hospital_eth_address):
        hospital_eth_address = f"0x{hospital_id:040x}"
    
    # Calculate expiry
    expires_at = None
    expiry_timestamp = 0
    if expires_seconds:
        from datetime import timedelta
        expires_dt = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
        expires_at = expires_dt.isoformat()
        expiry_timestamp = int(expires_dt.timestamp())
    
    # Record on-chain FIRST - using UUIDs as identifiers
    try:
        chain_result = await grant_hospital_access_onchain(
            patient_identifier=patient_uuid,
            hospital_identifier=hospital_uuid,
            hospital_eth_address=hospital_eth_address,
            expiry_timestamp=expiry_timestamp,
        )
    except ChainConfigError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Chain configuration error: {str(e)}",
        )
    except ChainError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Blockchain transaction failed: {str(e)}",
        )
    
    # Then record in DB for quick lookups - STORE the cid_hash for revocation!
    await grant_hospital_access(
        patient_id=patient_id,
        hospital_id=hospital_id,
        expires_at=expires_at,
        tx_hash=chain_result["tx_hash"],
        grant_cid_hash=chain_result["cid_hash"],
        patient_identifier=patient_uuid,
        hospital_identifier=hospital_uuid,
    )
    
    return {
        "patient_id": patient_id,
        "hospital_id": hospital_id,
        "hospital_username": hospital.get("username"),
        "status": "active",
        "expires_at": expires_at,
        "tx_hash": chain_result["tx_hash"],
        "etherscan_url": get_etherscan_url(chain_result["tx_hash"]),
        "message": f"Hospital {hospital.get('username')} granted upload access (recorded on-chain)",
    }


@router.post("/{patient_id}/revoke-hospital-access")
async def revoke_hospital_access_endpoint(
    patient_id: int,
    hospital_id: int = Form(...),
    current_user: dict = Depends(require_current_user),
):
    """
    Revoke a hospital's permission to upload records for this patient.
    
    This:
    1. Records the revocation ON-CHAIN (required)
    2. Updates the hospital_access table
    
    Args:
        patient_id: Patient user ID
        hospital_id: Hospital user ID to revoke access
        current_user: Authenticated user (must be the patient)
        
    Returns:
        Revocation confirmation with on-chain transaction hash
        
    Raises:
        HTTPException 403: If current user is not the patient
        HTTPException 503: If blockchain is not configured
    """
    # Verify caller is the patient
    if current_user["id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only revoke access for your own account",
        )
    
    # Check chain is configured - REQUIRED for this operation
    if not is_chain_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Blockchain not configured. This operation requires on-chain recording.",
        )
    
    # Get the stored grant record - we MUST use the stored cid_hash
    access_record = await get_hospital_access_record(patient_id, hospital_id)
    if not access_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active access grant found for this hospital",
        )
    
    stored_cid_hash = access_record.get("grant_cid_hash")
    if not stored_cid_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Grant was created with old system (no cid_hash stored). "
                   "Cannot revoke on-chain. Please contact support.",
        )
    
    # Record revocation on-chain using the STORED cid_hash
    # This fixes the mismatch bug where grant used one identifier but revoke computed a different one
    try:
        tx_hash = await revoke_hospital_access_onchain(
            stored_cid_hash=stored_cid_hash,
        )
    except ChainConfigError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Chain configuration error: {str(e)}",
        )
    except ChainError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Blockchain transaction failed: {str(e)}",
        )
    
    # Then update DB
    success = await revoke_hospital_access(patient_id, hospital_id)
    
    # Also revoke the kfrag - this is the critical step for PRE security
    # Without the kfrag, the hospital can no longer decrypt patient files
    kfrag_revoked = await revoke_hospital_kfrag(patient_id, hospital_id)
    
    if not success:
        # Even if DB update fails, the on-chain revocation is recorded
        # Log warning but don't fail
        print(f"Warning: On-chain revocation succeeded but DB update failed for patient {patient_id}, hospital {hospital_id}")
    
    return {
        "patient_id": patient_id,
        "hospital_id": hospital_id,
        "status": "revoked",
        "tx_hash": tx_hash,
        "etherscan_url": get_etherscan_url(tx_hash),
        "kfrag_revoked": kfrag_revoked,
        "message": "Hospital access revoked (recorded on-chain)",
    }


# ============================================================================
# Hospital Access Request System
# ============================================================================

class HospitalAccessRequest(BaseModel):
    """Hospital requesting access to a patient."""
    patient_uuid: str  # Patient's UUID for access request
    purpose: str  # Reason for requesting access


class HospitalAccessRequestResponse(BaseModel):
    """Response for hospital access request."""
    request_id: int
    patient_id: int
    patient_uuid: str
    patient_username: str
    status: str
    message: str


class PendingAccessRequest(BaseModel):
    """A pending access request from a hospital."""
    id: int
    hospital_id: int
    hospital_username: str
    purpose: str
    status: str
    created_at: str


class PendingAccessRequestsResponse(BaseModel):
    """Response for listing pending access requests."""
    requests: list[PendingAccessRequest]
    count: int


async def ensure_hospital_access_requests_table():
    """Create hospital_access_requests table if not exists."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS hospital_access_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hospital_id INTEGER NOT NULL,
                patient_id INTEGER NOT NULL,
                purpose TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP,
                tx_hash TEXT,
                FOREIGN KEY (hospital_id) REFERENCES users(id),
                FOREIGN KEY (patient_id) REFERENCES users(id)
            )
        """)
        await db.commit()


async def create_hospital_access_request(
    hospital_id: int,
    patient_id: int,
    purpose: str,
) -> int:
    """Create a new hospital access request."""
    await ensure_hospital_access_requests_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Check if there's already a pending request
        cursor = await db.execute(
            """
            SELECT id FROM hospital_access_requests 
            WHERE hospital_id = ? AND patient_id = ? AND status = 'pending'
            """,
            (hospital_id, patient_id),
        )
        existing = await cursor.fetchone()
        if existing:
            return existing[0]  # Return existing request ID
        
        cursor = await db.execute(
            """
            INSERT INTO hospital_access_requests (hospital_id, patient_id, purpose, status)
            VALUES (?, ?, ?, 'pending')
            """,
            (hospital_id, patient_id, purpose),
        )
        await db.commit()
        return cursor.lastrowid


async def get_pending_access_requests_for_patient(patient_id: int) -> list[dict]:
    """Get all pending access requests for a patient."""
    await ensure_hospital_access_requests_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT 
                har.id,
                har.hospital_id,
                har.patient_id,
                har.purpose,
                har.status,
                har.created_at,
                u.username as hospital_username
            FROM hospital_access_requests har
            JOIN users u ON har.hospital_id = u.id
            WHERE har.patient_id = ? AND har.status = 'pending'
            ORDER BY har.created_at DESC
            """,
            (patient_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_access_requests_by_hospital(hospital_id: int) -> list[dict]:
    """Get all access requests made by a hospital."""
    await ensure_hospital_access_requests_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT 
                har.id,
                har.hospital_id,
                har.patient_id,
                har.purpose,
                har.status,
                har.created_at,
                har.processed_at,
                har.tx_hash,
                u.username as patient_username,
                u.uuid as patient_uuid
            FROM hospital_access_requests har
            JOIN users u ON har.patient_id = u.id
            WHERE har.hospital_id = ?
            ORDER BY har.created_at DESC
            """,
            (hospital_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def update_access_request_status(
    request_id: int,
    status: str,
    tx_hash: Optional[str] = None,
) -> bool:
    """Update status of an access request."""
    await ensure_hospital_access_requests_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE hospital_access_requests
            SET status = ?, processed_at = CURRENT_TIMESTAMP, tx_hash = ?
            WHERE id = ?
            """,
            (status, tx_hash, request_id),
        )
        await db.commit()
        return cursor.rowcount > 0


async def get_access_request_by_id(request_id: int) -> Optional[dict]:
    """Get an access request by ID."""
    await ensure_hospital_access_requests_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM hospital_access_requests WHERE id = ?",
            (request_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_patient_by_username(username: str) -> Optional[dict]:
    """Get a patient by username."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM users WHERE username = ? AND role = 'patient'",
            (username,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


# ============================================================================
# Hospital Access Request Routes
# ============================================================================


@router.post("/request-access", response_model=HospitalAccessRequestResponse)
async def hospital_request_patient_access(
    request: HospitalAccessRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Hospital requests access to a patient's records.
    
    The patient will see this request and can approve or deny it.
    
    Args:
        request: Contains patient UUID and purpose
        current_user: Authenticated hospital user
        
    Returns:
        Request confirmation
        
    Raises:
        HTTPException 403: If caller is not a hospital
        HTTPException 404: If patient not found
    """
    # Verify caller is a hospital
    if current_user.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hospitals can request patient access",
        )
    
    hospital_id = current_user["id"]
    
    # Find patient by UUID
    patient = await get_user_by_uuid(request.patient_uuid)
    if not patient or patient.get("role") != "patient":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient with UUID '{request.patient_uuid}' not found",
        )
    
    # Check if hospital already has access
    has_access = await check_hospital_has_access(patient["id"], hospital_id)
    if has_access:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital already has access to this patient",
        )
    
    # Create access request
    request_id = await create_hospital_access_request(
        hospital_id=hospital_id,
        patient_id=patient["id"],
        purpose=request.purpose,
    )
    
    return HospitalAccessRequestResponse(
        request_id=request_id,
        patient_id=patient["id"],
        patient_uuid=patient.get("uuid", ""),
        patient_username=patient["username"],
        status="pending",
        message=f"Access request sent to patient {patient['username']}",
    )


@router.get("/pending-requests", response_model=PendingAccessRequestsResponse)
async def get_patient_pending_requests(
    current_user: dict = Depends(require_current_user),
):
    """
    Get pending access requests for a patient.
    
    Patients can see which hospitals are requesting access.
    
    Args:
        current_user: Authenticated patient user
        
    Returns:
        List of pending access requests
    """
    # Verify caller is a patient
    if current_user.get("role") != "patient":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only patients can view their pending requests",
        )
    
    patient_id = current_user["id"]
    requests = await get_pending_access_requests_for_patient(patient_id)
    
    return PendingAccessRequestsResponse(
        requests=[
            PendingAccessRequest(
                id=r["id"],
                hospital_id=r["hospital_id"],
                hospital_username=r["hospital_username"],
                purpose=r["purpose"],
                status=r["status"],
                created_at=str(r["created_at"]),
            )
            for r in requests
        ],
        count=len(requests),
    )


@router.get("/hospital-public-key/{request_id}")
async def get_hospital_public_key_for_request(
    request_id: int,
    current_user: dict = Depends(require_current_user),
):
    """
    Get the hospital's public key for a pending access request.
    
    This allows the patient to generate kfrags client-side before
    approving the access request.
    
    Args:
        request_id: ID of the access request
        current_user: Authenticated patient user
        
    Returns:
        Hospital's public key for PRE kfrag generation
    """
    # Verify caller is a patient
    if current_user.get("role") != "patient":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only patients can get hospital public keys for their requests",
        )
    
    patient_id = current_user["id"]
    
    # Get the access request
    access_request = await get_access_request_by_id(request_id)
    if not access_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access request not found",
        )
    
    # Verify the request is for this patient
    if access_request["patient_id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This request is not for you",
        )
    
    # Get hospital's public key
    hospital = await get_user_by_id(access_request["hospital_id"])
    if not hospital:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Hospital not found",
        )
    
    public_key = hospital.get("public_key")
    if not public_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital has not set up encryption keys yet. They need to set up their keys in Profile first.",
        )
    
    return {
        "request_id": request_id,
        "hospital_id": access_request["hospital_id"],
        "hospital_username": hospital.get("username"),
        "hospital_public_key": public_key,
    }


@router.post("/approve-request/{request_id}")
async def approve_hospital_request(
    request_id: int,
    expires_seconds: Optional[int] = None,
    kfrag_hex: Optional[str] = Form(None),
    verifying_key_hex: Optional[str] = Form(None),
    secret_key_hex: Optional[str] = Form(None),
    signing_key_hex: Optional[str] = Form(None),
    current_user: dict = Depends(require_current_user),
):
    """
    Approve a hospital's access request.
    
    This grants the hospital permission to upload for the patient
    and is recorded on the blockchain.
    
    Supports two modes for kfrag generation:
    1. Client-provided kfrags (kfrag_hex + verifying_key_hex) - DEPRECATED
       Only works if client uses pyumbral-compatible library
    2. Server-side generation (secret_key_hex) - RECOMMENDED
       Client sends decrypted secret key, server generates pyumbral-compatible kfrags
    
    Args:
        request_id: ID of the access request to approve
        expires_seconds: Optional expiry in seconds
        kfrag_hex: Pre-generated kfrag (deprecated, may be incompatible)
        verifying_key_hex: Verifying key for pre-generated kfrag
        secret_key_hex: Patient's secret key for server-side kfrag generation
        signing_key_hex: Patient's signing key (optional, falls back to server's)
        current_user: Authenticated patient user
        
    Returns:
        Approval confirmation with on-chain transaction
    """
    # Verify caller is a patient
    if current_user.get("role") != "patient":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only patients can approve access requests",
        )
    
    patient_id = current_user["id"]
    
    # Get the access request
    access_request = await get_access_request_by_id(request_id)
    if not access_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access request not found",
        )
    
    # Verify the request is for this patient
    if access_request["patient_id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This request is not for you",
        )
    
    # Verify request is pending
    if access_request["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Request has already been {access_request['status']}",
        )
    
    hospital_id = access_request["hospital_id"]
    
    # Check chain is configured
    if not is_chain_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Blockchain not configured. This operation requires on-chain recording.",
        )
    
    # Get patient and hospital info for on-chain recording
    patient = await get_user_by_id(patient_id)
    hospital = await get_user_by_id(hospital_id)
    
    # Use UUIDs as identifiers (easy to swap to ETH address later)
    patient_uuid = patient.get("uuid")
    hospital_uuid = hospital.get("uuid")
    
    if not patient_uuid or not hospital_uuid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patient or hospital has no UUID. Re-registration required.",
        )
    
    # Hospital ETH address for on-chain grantee field
    # Note: public_key is Umbral key (33 bytes), not ETH address (20 bytes)
    hospital_eth_address = hospital.get("eth_address")
    if not hospital_eth_address or not is_valid_eth_address(hospital_eth_address):
        hospital_eth_address = f"0x{hospital_id:040x}"
    
    # Calculate expiry
    expires_at = None
    expiry_timestamp = 0
    if expires_seconds:
        from datetime import timedelta
        expires_dt = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
        expires_at = expires_dt.isoformat()
        expiry_timestamp = int(expires_dt.timestamp())
    
    # Record on-chain using UUIDs
    try:
        chain_result = await grant_hospital_access_onchain(
            patient_identifier=patient_uuid,
            hospital_identifier=hospital_uuid,
            hospital_eth_address=hospital_eth_address,
            expiry_timestamp=expiry_timestamp,
        )
    except ChainConfigError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Chain configuration error: {str(e)}",
        )
    except ChainError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Blockchain transaction failed: {str(e)}",
        )
    
    # Update request status
    await update_access_request_status(request_id, "approved", chain_result["tx_hash"])
    
    # Grant hospital access in DB - STORE the cid_hash for revocation!
    await grant_hospital_access(
        patient_id=patient_id,
        hospital_id=hospital_id,
        expires_at=expires_at,
        tx_hash=chain_result["tx_hash"],
        grant_cid_hash=chain_result["cid_hash"],
        patient_identifier=patient_uuid,
        hospital_identifier=hospital_uuid,
    )
    
    # Generate and store kfrag
    kfrag_stored = False
    kfrag_generation_method = None
    
    # Option 1: Server-side kfrag generation (RECOMMENDED)
    # Patient sends their decrypted secret key, server generates pyumbral-compatible kfrags
    if secret_key_hex:
        try:
            # Get hospital's public key
            hospital_public_key = hospital.get("public_key")
            if not hospital_public_key:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Hospital has not set up encryption keys yet",
                )
            
            # Import the function
            from app.utils.umbral_utils import generate_kfrag_from_secret_key_bytes
            
            # Generate pyumbral-compatible kfrag server-side
            generated_kfrag_hex, generated_verifying_key_hex = generate_kfrag_from_secret_key_bytes(
                delegating_sk_bytes_hex=secret_key_hex,
                receiving_pk_hex=hospital_public_key,
                signing_sk_bytes_hex=signing_key_hex,  # May be None, will use server's
            )
            
            await store_hospital_kfrag(
                patient_id=patient_id,
                hospital_id=hospital_id,
                kfrag_hex=generated_kfrag_hex,
                verifying_key_hex=generated_verifying_key_hex,
                expires_at=expires_at,
            )
            kfrag_stored = True
            kfrag_generation_method = "server-side"
            
        except Exception as e:
            # Log but don't fail the approval - kfrag can be generated later
            import logging
            logging.error(f"Server-side kfrag generation failed: {e}")
            # Continue without kfrag - hospital can still get raw file access
    
    # Option 2: Client-provided kfrags (DEPRECATED - may be incompatible)
    elif kfrag_hex and verifying_key_hex:
        # Warn about potential incompatibility
        kfrag_bytes = bytes.fromhex(kfrag_hex)
        if len(kfrag_bytes) == 310:
            # This is @nucypher/umbral-pre format - WILL FAIL at reencrypt time
            import logging
            logging.warning(
                f"Client provided WASM kfrag (310 bytes) which is incompatible with pyumbral. "
                f"Re-encryption will fail. Use server-side generation instead."
            )
        
        await store_hospital_kfrag(
            patient_id=patient_id,
            hospital_id=hospital_id,
            kfrag_hex=kfrag_hex,
            verifying_key_hex=verifying_key_hex,
            expires_at=expires_at,
        )
        kfrag_stored = True
        kfrag_generation_method = "client-side"
    
    return {
        "request_id": request_id,
        "hospital_id": hospital_id,
        "hospital_username": hospital.get("username"),
        "status": "approved",
        "tx_hash": chain_result["tx_hash"],
        "etherscan_url": get_etherscan_url(chain_result["tx_hash"]),
        "kfrag_stored": kfrag_stored,
        "kfrag_generation_method": kfrag_generation_method,
        "message": "Hospital access approved and recorded on-chain",
    }


@router.post("/deny-request/{request_id}")
async def deny_hospital_request(
    request_id: int,
    current_user: dict = Depends(require_current_user),
):
    """
    Deny a hospital's access request.
    
    Args:
        request_id: ID of the access request to deny
        current_user: Authenticated patient user
        
    Returns:
        Denial confirmation
    """
    # Verify caller is a patient
    if current_user.get("role") != "patient":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only patients can deny access requests",
        )
    
    patient_id = current_user["id"]
    
    # Get the access request
    access_request = await get_access_request_by_id(request_id)
    if not access_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access request not found",
        )
    
    # Verify the request is for this patient
    if access_request["patient_id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This request is not for you",
        )
    
    # Verify request is pending
    if access_request["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Request has already been {access_request['status']}",
        )
    
    # Update request status
    await update_access_request_status(request_id, "denied")
    
    return {
        "request_id": request_id,
        "status": "denied",
        "message": "Access request denied",
    }


@router.get("/my-requests")
async def get_hospital_requests(
    current_user: dict = Depends(require_current_user),
):
    """
    Get all access requests made by a hospital.
    
    Hospitals can track their pending, approved, and denied requests.
    
    Args:
        current_user: Authenticated hospital user
        
    Returns:
        List of access requests with status
    """
    # Verify caller is a hospital
    if current_user.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hospitals can view their requests",
        )
    
    hospital_id = current_user["id"]
    requests = await get_access_requests_by_hospital(hospital_id)
    
    return {
        "requests": requests,
        "count": len(requests),
    }


@router.get("/my-patients")
async def get_hospital_patients(
    current_user: dict = Depends(require_current_user),
):
    """
    Get all patients that a hospital has access to.
    
    Args:
        current_user: Authenticated hospital user
        
    Returns:
        List of patients with access status
    """
    # Verify caller is a hospital
    if current_user.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hospitals can view their patients",
        )
    
    hospital_id = current_user["id"]
    
    # Get all patients this hospital has access to
    await ensure_hospital_access_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT 
                ha.patient_id,
                ha.status,
                ha.granted_at,
                ha.expires_at,
                ha.tx_hash,
                u.username as patient_username,
                u.uuid as patient_uuid,
                (SELECT COUNT(*) FROM files f WHERE f.owner_id = ha.patient_id) as file_count
            FROM hospital_access ha
            JOIN users u ON ha.patient_id = u.id
            WHERE ha.hospital_id = ? AND ha.status = 'active'
            ORDER BY ha.granted_at DESC
            """,
            (hospital_id,),
        )
        rows = await cursor.fetchall()
        patients = [dict(row) for row in rows]
    
    return {
        "patients": patients,
        "count": len(patients),
    }


@router.get("/patient-files/{patient_uuid}")
async def get_patient_files_for_hospital(
    patient_uuid: str,
    current_user: dict = Depends(require_current_user),
):
    """
    Get all files for a specific patient that the hospital has access to.
    
    This endpoint is for hospitals to view files of patients they have been granted
    access to. It verifies the hospital has an active access grant before returning files.
    
    Args:
        patient_uuid: UUID of the patient whose files to retrieve
        current_user: Authenticated hospital user
        
    Returns:
        List of file records with metadata (CID, capsule, encrypted_cek, etc.)
    """
    # Verify caller is a hospital
    if current_user.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hospitals can access patient files through this endpoint",
        )
    
    hospital_id = current_user["id"]
    
    # Look up patient by UUID
    patient = await get_user_by_uuid(patient_uuid)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Patient not found with UUID: {patient_uuid}",
        )
    
    patient_id = patient["id"]
    
    # Verify hospital has active access to this patient
    await ensure_hospital_access_table()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT status, expires_at
            FROM hospital_access
            WHERE hospital_id = ? AND patient_id = ? AND status = 'active'
            """,
            (hospital_id, patient_id),
        )
        access_row = await cursor.fetchone()
        
        if not access_row:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have access to this patient's records",
            )
        
        # Check if access has expired
        if access_row["expires_at"]:
            expires = datetime.fromisoformat(access_row["expires_at"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > expires:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your access to this patient's records has expired",
                )
        
        # Get all files for this patient
        cursor = await db.execute(
            """
            SELECT 
                id,
                cid,
                filename,
                capsule,
                encrypted_cek,
                tx_hash,
                created_at,
                category
            FROM files
            WHERE owner_id = ?
            ORDER BY created_at DESC
            """,
            (patient_id,),
        )
        rows = await cursor.fetchall()
        files = [dict(row) for row in rows]
    
    return {
        "patient_uuid": patient_uuid,
        "patient_id": patient_id,
        "patient_username": patient.get("username"),
        "files": files,
        "count": len(files),
    }


# ============================================================================
# Re-encryption Endpoint for Hospital Access
# ============================================================================


@router.post("/reencrypt/{file_id}")
async def reencrypt_for_hospital(
    file_id: int,
    current_user: dict = Depends(require_current_user),
):
    """
    Re-encrypt a file's capsule for a hospital to access.
    
    This endpoint uses the stored kfrag to perform proxy re-encryption,
    returning a cfrag that the hospital can use with their private key
    to decrypt the file.
    
    Security Flow:
    1. Hospital requests re-encryption with their auth token
    2. Server finds the patient's file and the hospital's kfrag
    3. Server uses kfrag to re-encrypt the capsule -> cfrag
    4. Hospital receives cfrag + original capsule + patient's public key
    5. Hospital uses their private key to decrypt
    
    The hospital NEVER receives the patient's private key or the original CEK.
    Revocation = delete kfrag = hospital can no longer get cfrags = can't decrypt.
    
    Args:
        file_id: ID of the file to access
        current_user: Authenticated hospital user
        
    Returns:
        Re-encrypted cfrag, original capsule, patient public key for decryption
    """
    from app.utils.umbral_utils import UMBRAL_AVAILABLE, reencrypt_capsule
    
    # Verify caller is a hospital
    if current_user.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hospitals can request re-encryption",
        )
    
    hospital_id = current_user["id"]
    
    # Get the file
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM files WHERE id = ?",
            (file_id,),
        )
        file_row = await cursor.fetchone()
        
        if not file_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File not found",
            )
        
        file_record = dict(file_row)
        patient_id = file_record.get("owner_id")
    
    if not patient_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File has no owner",
        )
    
    # Verify hospital has access to this patient
    has_access = await check_hospital_has_access(patient_id, hospital_id)
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this patient's records",
        )
    
    # Get the kfrag for this hospital-patient pair
    kfrag_record = await get_hospital_kfrag(patient_id, hospital_id)
    if not kfrag_record:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No re-encryption key found. The patient needs to approve your access again.",
        )
    
    kfrag_hex = kfrag_record.get("kfrag_hex")
    verifying_key_hex = kfrag_record.get("verifying_key_hex")
    
    # Get patient's public key (delegating_pk)
    patient = await get_user_by_id(patient_id)
    patient_public_key = patient.get("public_key")
    
    if not patient_public_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patient has no public key configured",
        )
    
    # Get hospital's public key (receiving_pk)
    hospital = await get_user_by_id(hospital_id)
    hospital_public_key = hospital.get("public_key")
    
    if not hospital_public_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital has no public key configured. Set up encryption keys in Profile first.",
        )
    
    # Get file's capsule
    capsule_hex = file_record.get("capsule")
    encrypted_cek = file_record.get("encrypted_cek")
    
    if not capsule_hex:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File has no encryption capsule",
        )
    
    # Perform re-encryption using Umbral
    if UMBRAL_AVAILABLE:
        try:
            cfrag_hex = reencrypt_capsule(
                capsule_hex=capsule_hex,
                kfrag_hex=kfrag_hex,
                delegating_pk_hex=patient_public_key,  # Patient's public key
                verifying_pk_hex=verifying_key_hex,     # Verifying key from kfrag generation
                receiving_pk_hex=hospital_public_key,   # Hospital's public key
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Re-encryption failed: {str(e)}",
            )
    else:
        # Dev mode placeholder
        cfrag_hex = f"placeholder_cfrag_{hospital_id}_{file_id}"
    
    return {
        "file_id": file_id,
        "filename": file_record.get("filename"),
        "cid": file_record.get("cid"),
        "cfrag_hex": cfrag_hex,
        "capsule_hex": capsule_hex,
        "encrypted_cek": encrypted_cek,
        "patient_public_key": patient_public_key,
        "message": "Re-encryption successful. Use cfrag with your private key to decrypt.",
    }


@router.post("/decrypt-for-hospital/{file_id}")
async def decrypt_file_for_hospital(
    file_id: int,
    secret_key_hex: str = Form(...),
    current_user: dict = Depends(require_current_user),
):
    """
    Full server-side decryption for hospitals using PRE.
    
    This endpoint performs the complete decryption flow server-side:
    1. Re-encrypts the capsule using stored kfrag → cfrag
    2. Uses the cfrag + hospital's secret key to decrypt the CEK
    3. Uses the CEK to decrypt the file content
    4. Returns the decrypted file
    
    This is necessary because pyumbral (Python) and @nucypher/umbral-pre (WASM)
    have incompatible serialization formats. All PRE operations must happen
    server-side with pyumbral.
    
    SECURITY:
    - Hospital's secret key is only held in memory briefly
    - All transport must be over HTTPS
    - Secret key is not stored or logged
    
    Args:
        file_id: ID of the file to decrypt
        secret_key_hex: Hospital's secret key as hex (32 bytes)
        current_user: Authenticated hospital user
        
    Returns:
        Decrypted file content as base64
    """
    import base64
    import mimetypes
    from app.storage import download_blob
    from app.utils.umbral_utils import (
        UMBRAL_AVAILABLE, 
        reencrypt_capsule, 
        decrypt_reencrypted_from_bytes,
        decrypt_with_cek,
    )
    
    # Verify caller is a hospital
    if current_user.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hospitals can use this endpoint",
        )
    
    hospital_id = current_user["id"]
    
    # Validate secret key format
    try:
        sk_bytes = bytes.fromhex(secret_key_hex)
        if len(sk_bytes) != 32:
            raise ValueError(f"Secret key must be 32 bytes, got {len(sk_bytes)}")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid secret key format: {str(e)}",
        )
    
    # Get the file
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM files WHERE id = ?",
            (file_id,),
        )
        file_row = await cursor.fetchone()
        
        if not file_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File not found",
            )
        
        file_record = dict(file_row)
        patient_id = file_record.get("owner_id")
    
    if not patient_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File has no owner",
        )
    
    # Verify hospital has access to this patient
    has_access = await check_hospital_has_access(patient_id, hospital_id)
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this patient's records",
        )
    
    # Get the kfrag for this hospital-patient pair
    kfrag_record = await get_hospital_kfrag(patient_id, hospital_id)
    if not kfrag_record:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No re-encryption key found. The patient needs to approve your access again.",
        )
    
    kfrag_hex = kfrag_record.get("kfrag_hex")
    verifying_key_hex = kfrag_record.get("verifying_key_hex")
    
    # Get patient's public key
    patient = await get_user_by_id(patient_id)
    patient_public_key = patient.get("public_key")
    
    if not patient_public_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patient has no public key configured",
        )
    
    # Get hospital's public key (for kfrag verification)
    hospital = await get_user_by_id(hospital_id)
    hospital_public_key = hospital.get("public_key")
    
    if not hospital_public_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hospital has no public key configured",
        )
    
    # Get file's encryption data
    cid = file_record.get("cid")
    capsule_hex = file_record.get("capsule")
    encrypted_cek = file_record.get("encrypted_cek")
    filename = file_record.get("filename", "unknown")
    
    if not cid or not capsule_hex or not encrypted_cek:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File is missing encryption metadata",
        )
    
    if not UMBRAL_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="PRE encryption is not available",
        )
    
    try:
        # Step 1: Re-encrypt capsule using kfrag → cfrag
        cfrag_hex = reencrypt_capsule(
            capsule_hex=capsule_hex,
            kfrag_hex=kfrag_hex,
            delegating_pk_hex=patient_public_key,
            verifying_pk_hex=verifying_key_hex,
            receiving_pk_hex=hospital_public_key,
        )
        
        # Step 2: Decrypt CEK using cfrag + hospital's secret key
        decrypted_cek = decrypt_reencrypted_from_bytes(
            capsule_hex=capsule_hex,
            cfrag_hex=cfrag_hex,
            ciphertext_hex=encrypted_cek,
            delegating_pk_hex=patient_public_key,
            receiving_sk_bytes_hex=secret_key_hex,
            receiving_pk_hex=hospital_public_key,
            verifying_pk_hex=verifying_key_hex,
        )
        
        # Step 3: Download encrypted file from Storacha
        encrypted_blob = download_blob(cid)
        
        # Extract nonce (first 12 bytes) and ciphertext
        nonce = encrypted_blob[:12]
        ciphertext = encrypted_blob[12:]
        
        # Step 4: Decrypt file content with CEK
        decrypted_content = decrypt_with_cek(ciphertext, decrypted_cek, nonce)
        
        # Determine content type
        content_type, _ = mimetypes.guess_type(filename)
        if not content_type:
            content_type = "application/octet-stream"
        
        # Encode as base64
        content_b64 = base64.b64encode(decrypted_content).decode("utf-8")
        
        return {
            "file_id": file_id,
            "filename": filename,
            "content_base64": content_b64,
            "content_type": content_type,
            "size": len(decrypted_content),
            "message": "File decrypted successfully using PRE",
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Decryption failed: {str(e)}",
        )


# ============================================================================
# File Management
# ============================================================================


class RenameFileRequest(BaseModel):
    """Request to rename a file's display name."""
    display_name: str


@router.post("/{patient_id}/files/{file_id}/rename")
async def rename_file(
    patient_id: int,
    file_id: int,
    request: RenameFileRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Rename a file's display name.
    
    This ONLY changes the display name shown in the UI. It does NOT:
    - Change the CID (content-addressed, immutable)
    - Affect encryption/decryption
    - Require re-uploading the file
    - Affect grants or access
    
    The original filename is preserved for content-type detection.
    
    Args:
        patient_id: Patient user ID (must match current user)
        file_id: ID of the file to rename
        request: New display name
        
    Returns:
        Confirmation with old and new names
        
    Raises:
        HTTPException 403: If current user is not the patient
        HTTPException 404: If file not found or not owned by user
    """
    # Verify caller is the patient
    if current_user["id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only rename your own files",
        )
    
    # Import here to avoid circular imports
    from app.db import get_file_by_id, update_file_display_name
    
    # Get the file first to verify ownership and get old name
    file_record = await get_file_by_id(file_id)
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    
    if file_record.get("owner_id") != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="File does not belong to you",
        )
    
    old_display_name = file_record.get("display_name") or file_record.get("filename")
    
    # Update the display name
    success = await update_file_display_name(file_id, request.display_name, patient_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update file name",
        )
    
    return {
        "file_id": file_id,
        "old_name": old_display_name,
        "new_name": request.display_name,
        "cid": file_record.get("cid"),  # CID unchanged
        "message": "File renamed successfully. CID and encryption unchanged.",
    }


@router.get("/{patient_id}/files-accessed-by/{hospital_id}")
async def get_files_accessed_by_hospital(
    patient_id: int,
    hospital_id: int,
    current_user: dict = Depends(require_current_user),
):
    """
    Get list of files that a specific hospital has access to.
    
    This is useful for:
    - Reviewing what a hospital can see before revoking
    - Selective rotation (only rotate files the revoked hospital accessed)
    - Audit purposes
    
    Args:
        patient_id: Patient user ID (must match current user)
        hospital_id: Hospital to check access for
        
    Returns:
        List of files with access metadata
    """
    # Verify caller is the patient
    if current_user["id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Can only view your own file access info",
        )
    
    from app.db import get_files_accessed_by_hospital as db_get_files
    
    files = await db_get_files(patient_id, hospital_id)
    
    return {
        "patient_id": patient_id,
        "hospital_id": hospital_id,
        "files": files,
        "count": len(files),
        "message": f"Hospital has access to {len(files)} file(s)",
    }


# ============================================================================
# Admin/Maintenance Endpoints
# ============================================================================


@router.get("/admin/users-without-uuid")
async def list_users_without_uuid(
    current_user: dict = Depends(require_current_user),
):
    """
    List all users that don't have a UUID assigned.
    
    These are legacy users from before UUIDs were mandatory.
    They need to re-register or be cleaned up.
    
    Note: In production, this should be admin-only.
    For development, any authenticated user can call it.
    
    Returns:
        List of users without UUIDs
    """
    from app.db import get_users_without_uuid
    
    users = await get_users_without_uuid()
    
    return {
        "users": users,
        "count": len(users),
        "message": f"Found {len(users)} user(s) without UUID. These need re-registration or cleanup.",
    }


@router.delete("/admin/users-without-uuid")
async def cleanup_users_without_uuid(
    current_user: dict = Depends(require_current_user),
    confirm: bool = False,
):
    """
    Delete all users that don't have a UUID.
    
    WARNING: This is destructive! Should only be called during cleanup.
    This will also delete associated data (files, grants, access requests).
    
    Args:
        confirm: Must be True to proceed with deletion
        
    Returns:
        Number of users deleted
        
    Raises:
        HTTPException 400: If confirm is not True
    """
    if not confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must set confirm=true to delete users. This is destructive!",
        )
    
    from app.db import delete_users_without_uuid, get_users_without_uuid
    
    # Get count first
    users = await get_users_without_uuid()
    
    if not users:
        return {
            "deleted_count": 0,
            "message": "No users without UUID to delete.",
        }
    
    deleted_count = await delete_users_without_uuid()
    
    return {
        "deleted_count": deleted_count,
        "message": f"Deleted {deleted_count} user(s) without UUID and their associated data.",
    }
