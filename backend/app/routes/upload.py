"""
Upload Routes for Decent-Hospital Backend

Handles file encryption and IPFS pinning:
- POST /upload: Encrypt file and upload to Storacha (single endpoint)
- POST /upload/encrypt: Encrypt a file with a new CEK
- POST /upload/pin: Upload encrypted file to Storacha/web3.storage
- GET /upload/files/{user_id}: List files for a user

Encryption Flow:
1. Generate random AES-256-GCM CEK
2. Encrypt file content with CEK
3. Encapsulate CEK with owner's Umbral public key
4. Upload encrypted blob to Storacha
5. Return CID and capsule metadata
"""

import json
import os
import tempfile
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.db import FileRecord, create_file_record, get_files_by_owner, get_user_by_id, get_file_by_id, get_user_by_uuid, create_grant, create_audit_log
from app.routes.auth import get_current_user_from_token, require_current_user
from app.routes.patients import get_hospital_access_record
from app.utils.storage import upload_to_storacha, upload_bytes_to_storacha, is_valid_cid
from app.utils.umbral_utils import (
    encrypt_with_cek,
    generate_cek,
    encapsulate_cek,
    UMBRAL_AVAILABLE,
)
from app.utils.chain import (
    is_chain_configured, 
    verify_grant_onchain,
    record_upload_consent_registry,
)

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class UploadResponse(BaseModel):
    """Response after uploading and encrypting a file."""

    cid: str
    file_id: int
    filename: str
    encrypted_cek: str  # CEK encrypted with owner's public key (hex)
    capsule: str  # Umbral capsule for re-encryption (hex)
    tx_hash: Optional[str] = None  # Blockchain transaction hash if recorded
    message: str


class EncryptResponse(BaseModel):
    """Response after encrypting a file (before pinning)."""

    temp_file_id: str
    encrypted_file_path: str
    cek_ciphertext: str
    capsule: Optional[str] = None
    original_filename: str
    encrypted_size: int
    message: str


class PinRequest(BaseModel):
    """Request to pin an encrypted file."""

    temp_file_id: str
    owner_id: int
    original_filename: str
    encrypted_cek: str
    capsule: Optional[str] = None


class PinResponse(BaseModel):
    """Response after pinning to IPFS."""

    cid: str
    file_id: int
    filename: str
    message: str


class FileListResponse(BaseModel):
    """Response for listing files."""

    files: list[dict]
    count: int


class HospitalUploadResponse(BaseModel):
    """Response after hospital uploads for patient."""
    
    cid: str
    file_id: int
    filename: str
    patient_id: int
    patient_uuid: str
    hospital_id: int
    category: Optional[str] = None
    description: Optional[str] = None  # Description/notes about the file
    folder: Optional[str] = None  # Folder organization
    encrypted_cek: str
    capsule: str
    hospital_grant_id: Optional[int] = None  # Grant ID for hospital to access
    upload_tx: Optional[str] = None
    etherscan_url: Optional[str] = None
    message: str


class HospitalUploadCiphertextRequest(BaseModel):
    """Request for hospital to upload pre-encrypted ciphertext.
    
    Use this when hospital encrypts client-side with patient's public key.
    """
    
    patient_uuid: str  # Changed to UUID
    category: Optional[str] = None
    description: Optional[str] = None  # Description/notes about the file
    folder: Optional[str] = None  # Folder organization
    ciphertext_cid: str  # CID of ciphertext already uploaded to Storacha
    capsule_meta: str  # Hex-encoded capsule from client-side encryption
    encrypted_cek: str  # CEK encrypted with patient's public key


# Temporary storage for encrypted files awaiting pinning
# In production, use Redis or proper temp storage with TTL
TEMP_ENCRYPTED_FILES: dict[str, dict] = {}


# ============================================================================
# Routes
# ============================================================================


@router.post("", response_model=UploadResponse)
@router.post("/", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    patient_id: int = Form(...),
    owner_public_key: Optional[str] = Form(None),
):
    """
    Upload a file: encrypt with AES-256-GCM and store on Storacha.
    
    This is the main upload endpoint that:
    1. Generates a random CEK (Content Encryption Key)
    2. Encrypts the file with AES-256-GCM
    3. Encapsulates the CEK with owner's Umbral public key
    4. Uploads encrypted blob to Storacha
    5. Stores metadata in database
    
    Args:
        file: The file to encrypt (multipart upload)
        patient_id: ID of the patient/owner
        owner_public_key: Owner's Umbral public key (hex). Required for Umbral.
        
    Returns:
        CID, file_id, and encrypted CEK capsule metadata
        
    Raises:
        HTTPException 400: If owner not found or missing public key
        HTTPException 500: If encryption/upload fails
        
    Example curl:
        curl -X POST http://localhost:8000/upload \\
          -F "file=@sample.txt" \\
          -F "patient_id=1" \\
          -F "owner_public_key=<hex_public_key>"
    """
    # Validate owner exists
    owner = await get_user_by_id(patient_id)
    if not owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patient/owner not found",
        )
    
    # Get public key
    public_key = owner_public_key or owner.get("public_key")
    
    try:
        # Read file content
        file_content = await file.read()
        filename = file.filename or "unknown"
        
        # Generate CEK and encrypt file content
        cek = generate_cek()
        encrypted_content, nonce = encrypt_with_cek(file_content, cek)
        
        # Combine nonce + encrypted content for storage
        encrypted_blob = nonce + encrypted_content
        
        # Encapsulate CEK with owner's public key (if Umbral available)
        if UMBRAL_AVAILABLE and public_key:
            capsule_hex, cek_ciphertext = encapsulate_cek(cek, public_key)
        else:
            # Fallback: just hex encode the CEK (NOT SECURE - dev only)
            capsule_hex = ""
            cek_ciphertext = cek.hex()
        
        # Upload to Storacha
        result = upload_bytes_to_storacha(
            data=encrypted_blob,
            filename=f"{filename}.enc",
        )
        cid = result.get("cid")
        
        if not cid or not is_valid_cid(cid):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get valid CID from Storacha",
            )
        
        # Create file record in database (include capsule for re-encryption)
        file_record = FileRecord(
            cid=cid,
            owner_id=patient_id,
            filename=filename,
            encrypted_cek=cek_ciphertext,
            capsule=capsule_hex,
        )
        file_id = await create_file_record(file_record)
        
        # Optionally record on blockchain using ConsentRegistry
        tx_hash = None
        if is_chain_configured():
            try:
                # Get patient UUID for on-chain hashing
                patient_uuid = owner.get("uuid", str(patient_id))
                
                # Use ConsentRegistry - patient is both uploader and owner
                chain_result = await record_upload_consent_registry(
                    cid=cid,
                    patient_id=patient_uuid,
                    hospital_id=patient_uuid,  # Self-upload
                )
                tx_hash = chain_result["tx_hash"]
                
                # CRITICAL: Update the file record with the tx_hash
                from app.db import update_file_tx_hash
                await update_file_tx_hash(file_id, tx_hash)
            except Exception as chain_err:
                # Log but don't fail the upload
                print(f"Warning: Failed to record on-chain: {chain_err}")
        
        # Record upload in audit log
        try:
            # Determine if this is a hospital uploading for a patient
            is_hospital_upload = current_user["id"] != patient_id
            
            await create_audit_log(
                event_type="upload",
                actor_id=current_user["id"],
                target_id=patient_id if is_hospital_upload else None,
                patient_id=patient_id,
                file_id=file_id,
                cid=cid,
                details=json.dumps({
                    "filename": filename,
                    "uploader_role": current_user.get("role", "unknown"),
                    "uploader_name": current_user.get("username"),
                    "is_hospital_upload": is_hospital_upload,
                    "action": "hospital_upload" if is_hospital_upload else "patient_upload",
                }),
                tx_hash=tx_hash,
            )
        except Exception as e:
            print(f"Warning: Failed to create upload audit log: {e}")
        
        return UploadResponse(
            cid=cid,
            file_id=file_id,
            filename=filename,
            encrypted_cek=cek_ciphertext,
            capsule=capsule_hex,
            tx_hash=tx_hash,
            message="File encrypted and uploaded successfully",
        )
        
    except ValueError as e:
        # Storacha API key not configured
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {str(e)}",
        )


@router.post("/encrypt", response_model=EncryptResponse)
async def encrypt_file(
    file: UploadFile = File(...),
    owner_id: int = Form(...),
    owner_public_key: Optional[str] = Form(None),
):
    """
    Encrypt a file using AES-256-GCM (without uploading).
    
    Generates a new CEK for each file and stores encrypted content
    in temporary storage for later pinning.
    
    Args:
        file: The file to encrypt (multipart upload)
        owner_id: ID of the file owner
        owner_public_key: Owner's Umbral public key (hex)
        
    Returns:
        Encrypted file info and encrypted CEK
    """
    owner = await get_user_by_id(owner_id)
    if not owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Owner not found",
        )
    
    public_key = owner_public_key or owner.get("public_key")
    
    try:
        file_content = await file.read()
        
        # Generate CEK and encrypt
        cek = generate_cek()
        encrypted_content, nonce = encrypt_with_cek(file_content, cek)
        encrypted_blob = nonce + encrypted_content
        
        # Encapsulate CEK
        if UMBRAL_AVAILABLE and public_key:
            capsule_hex, cek_ciphertext = encapsulate_cek(cek, public_key)
        else:
            capsule_hex = None
            cek_ciphertext = cek.hex()
        
        # Save to temp storage
        temp_file_id = str(uuid.uuid4())
        temp_dir = tempfile.gettempdir()
        encrypted_file_path = os.path.join(temp_dir, f"{temp_file_id}.enc")
        
        with open(encrypted_file_path, "wb") as f:
            f.write(encrypted_blob)
        
        # Store reference
        TEMP_ENCRYPTED_FILES[temp_file_id] = {
            "path": encrypted_file_path,
            "capsule": capsule_hex,
            "cek_ciphertext": cek_ciphertext,
        }
        
        return EncryptResponse(
            temp_file_id=temp_file_id,
            encrypted_file_path=encrypted_file_path,
            cek_ciphertext=cek_ciphertext,
            capsule=capsule_hex,
            original_filename=file.filename or "unknown",
            encrypted_size=len(encrypted_blob),
            message="File encrypted successfully",
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Encryption failed: {str(e)}",
        )


# ============================================================================
# Hospital Upload Helpers
# ============================================================================

async def check_hospital_has_grant(patient_id: int, hospital_id: int) -> bool:
    """
    Check if hospital has explicit grant to upload for patient.
    
    Checks:
    1. hospital_access table in DB (explicit permission)
    2. On-chain AccessGranted events (if chain configured)
    
    Args:
        patient_id: Patient's user ID
        hospital_id: Hospital's user ID
        
    Returns:
        True if hospital has active grant
    """
    # Import here to avoid circular imports
    from app.routes.patients import check_hospital_has_access
    
    # Check DB first
    has_db_access = await check_hospital_has_access(patient_id, hospital_id)
    if has_db_access:
        return True
    
    # Check on-chain if configured
    if is_chain_configured():
        try:
            # Get patient's public key for on-chain verification
            patient = await get_user_by_id(patient_id)
            hospital = await get_user_by_id(hospital_id)
            
            if patient and hospital:
                patient_pubkey = patient.get("public_key")
                hospital_pubkey = hospital.get("public_key")
                
                if patient_pubkey and hospital_pubkey:
                    # Check if there's a grant for any of patient's files to hospital
                    # For now, we require explicit DB grant
                    # On-chain grants are for file-level access, not upload permission
                    pass
        except Exception as e:
            print(f"Warning: On-chain grant check failed: {e}")
    
    return False


def get_etherscan_url(tx_hash: str) -> str:
    """Generate Etherscan URL for Sepolia testnet."""
    # Ensure 0x prefix for valid Etherscan URL
    if tx_hash and not tx_hash.startswith('0x'):
        tx_hash = '0x' + tx_hash
    return f"https://sepolia.etherscan.io/tx/{tx_hash}"


# ============================================================================
# Hospital Upload Routes
# ============================================================================


@router.post("/hospital", response_model=HospitalUploadResponse)
async def hospital_upload(
    file: UploadFile = File(...),
    patient_uuid: str = Form(...),
    category: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    folder: Optional[str] = Form(None),
    display_name: Optional[str] = Form(None),
    current_user: dict = Depends(require_current_user),
):
    """
    Hospital uploads a file for a patient.
    
    Pre-conditions:
    1. Caller must be authenticated as a hospital
    2. Patient must exist (identified by UUID)
    3. Hospital must have explicit grant from patient (with valid expiry)
    
    Behavior:
    - Server encrypts CEK with patient's public key using pyUmbral
    - Uploads ciphertext to Storacha
    - Creates a grant for the hospital to access the file
    - Records upload on-chain with actor=hospital
    
    Args:
        file: File to encrypt and upload (multipart)
        patient_uuid: Patient's UUID (share-safe identifier)
        category: Optional category (e.g., "lab_results", "imaging")
        description: Optional description/notes about the file
        folder: Optional folder path for organization
        display_name: Optional custom display name for the file
        current_user: Authenticated hospital user
        
    Returns:
        CID, upload transaction, grant ID for hospital access, and metadata
        
    Raises:
        HTTPException 403: If hospital has no grant for patient or grant expired
        HTTPException 400: If patient not found or has no public key
        
    Example curl:
        curl -X POST http://localhost:8000/upload/hospital \\
          -H "Authorization: Bearer <hospital_jwt>" \\
          -F "file=@lab_results.pdf" \\
          -F "patient_uuid=a1b2c3d4-e5f6-..." \\
          -F "category=lab_results" \\
          -F "description=Blood test results from Nov 2025" \\
          -F "folder=blood_tests/2024"
    """
    hospital_id = current_user["id"]
    
    # Verify caller is a hospital
    if current_user.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hospitals can use this endpoint",
        )
    
    # Look up patient by UUID
    patient = await get_user_by_uuid(patient_uuid)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patient not found with this UUID",
        )
    
    patient_id = patient["id"]
    
    # Check patient has public key
    patient_public_key = patient.get("public_key")
    if not patient_public_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patient has not set up encryption keys. Patient must create profile first.",
        )
    
    # CHECK GRANT - This is the key security check
    has_grant = await check_hospital_has_grant(patient_id, hospital_id)
    if not has_grant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hospital does not have permission to upload for this patient. "
                   "Patient must grant access first via POST /patients/{patient_id}/grant-hospital-access",
        )
    
    try:
        # Read file content
        file_content = await file.read()
        filename = file.filename or "unknown"
        
        # Build organized filename with folder and category
        # Use custom display_name if provided, otherwise build from parts
        if display_name:
            display_filename = display_name
        else:
            display_filename = filename
            if folder:
                display_filename = f"{folder}/{filename}"
            if category:
                display_filename = f"[{category}] {display_filename}"
        
        # Generate CEK and encrypt file content
        cek = generate_cek()
        encrypted_content, nonce = encrypt_with_cek(file_content, cek)
        
        # Combine nonce + encrypted content for storage
        encrypted_blob = nonce + encrypted_content
        
        # Encapsulate CEK with patient's public key (patient is owner)
        if UMBRAL_AVAILABLE and patient_public_key:
            capsule_hex, cek_ciphertext = encapsulate_cek(cek, patient_public_key)
        else:
            # Fallback: just hex encode the CEK (NOT SECURE - dev only)
            capsule_hex = ""
            cek_ciphertext = cek.hex()
            print("WARNING: pyUmbral not available, using insecure CEK storage")
        
        # Upload to Storacha
        result = upload_bytes_to_storacha(
            data=encrypted_blob,
            filename=f"{filename}.enc",
        )
        cid = result.get("cid")
        
        if not cid or not is_valid_cid(cid):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get valid CID from Storacha",
            )
        
        # Create file record in database (PATIENT is owner, hospital uploaded)
        file_record = FileRecord(
            cid=cid,
            owner_id=patient_id,
            filename=display_filename,
            encrypted_cek=cek_ciphertext,
            capsule=capsule_hex,
            category=category,  # Include category in file record
            description=description,  # Include description in file record
            uploaded_by_hospital_id=hospital_id,  # Track which hospital uploaded
        )
        file_id = await create_file_record(file_record)
        
        # Create a grant for the hospital to access this file
        # This allows the hospital to view/decrypt what they uploaded
        hospital_grant_id = None
        try:
            from app.db import GrantCreate
            from datetime import datetime, timezone, timedelta
            
            # Get hospital access expiry from hospital_access table
            from app.routes.patients import get_hospital_access_record
            access_record = await get_hospital_access_record(patient_id, hospital_id)
            
            # Grant expires when hospital's access expires (or 30 days default)
            grant_expires = None
            if access_record and access_record.get("expires_at"):
                grant_expires = access_record["expires_at"]
            else:
                grant_expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
            
            grant = GrantCreate(
                granter_id=patient_id,  # Patient grants access
                grantee_id=hospital_id,  # To the hospital
                file_id=file_id,
                expires_at=grant_expires,
            )
            # Use a placeholder reencryption key for hospital uploads
            # The hospital already has the CEK since they encrypted the file
            hospital_grant_id = await create_grant(grant, reencryption_key="hospital_upload")
            
            # Create audit log for the hospital grant (so it shows in patient's audit)
            try:
                await create_audit_log(
                    event_type="grant",
                    actor_id=patient_id,  # Patient is the granter
                    target_id=hospital_id,  # Hospital is the grantee
                    patient_id=patient_id,
                    file_id=file_id,
                    cid=cid,
                    details=json.dumps({
                        "filename": display_filename,
                        "grantee_name": current_user.get("username"),
                        "grantee_role": "hospital",
                        "auto_grant": True,  # Flag to indicate this was auto-granted on upload
                        "grant_reason": "hospital_upload",
                        "status": "active",
                    }),
                    tx_hash=None,  # No separate on-chain tx for auto-grants
                )
            except Exception as e:
                print(f"Warning: Failed to create hospital grant audit log: {e}")
        except Exception as grant_err:
            print(f"Warning: Failed to create hospital grant: {grant_err}")
        
        # Record on-chain using ConsentRegistry
        upload_tx = None
        etherscan_url = None
        if is_chain_configured():
            try:
                # Get user identifiers for on-chain hashing
                patient_user = await get_user_by_id(patient_id)
                hospital_user = await get_user_by_id(hospital_id)
                
                patient_uuid = patient_user.get("uuid", str(patient_id)) if patient_user else str(patient_id)
                hospital_uuid = hospital_user.get("uuid", str(hospital_id)) if hospital_user else str(hospital_id)
                
                # Use the new ConsentRegistry contract
                chain_result = await record_upload_consent_registry(
                    cid=cid,
                    patient_id=patient_uuid,
                    hospital_id=hospital_uuid,
                )
                upload_tx = chain_result["tx_hash"]
                etherscan_url = get_etherscan_url(upload_tx)
                
                # CRITICAL: Update the file record with the tx_hash so patients can see it
                from app.db import update_file_tx_hash
                await update_file_tx_hash(file_id, upload_tx)
            except Exception as chain_err:
                print(f"Warning: Failed to record on-chain: {chain_err}")
        
        # Record hospital upload in audit log
        try:
            import json
            await create_audit_log(
                event_type="upload",
                actor_id=hospital_id,
                target_id=patient_id,
                patient_id=patient_id,
                file_id=file_id,
                cid=cid,
                details=json.dumps({
                    "filename": display_filename,
                    "category": category,
                    "description": description,
                    "uploader_role": "hospital",
                    "uploader_name": current_user.get("username"),
                    "is_hospital_upload": True,
                    "action": "hospital_upload",
                }),
                tx_hash=upload_tx,
            )
        except Exception as e:
            print(f"Warning: Failed to create hospital upload audit log: {e}")
        
        return HospitalUploadResponse(
            cid=cid,
            file_id=file_id,
            filename=display_filename,
            patient_id=patient_id,
            patient_uuid=patient_uuid,
            hospital_id=hospital_id,
            category=category,
            description=description,
            folder=folder,
            encrypted_cek=cek_ciphertext,
            capsule=capsule_hex,
            hospital_grant_id=hospital_grant_id,
            upload_tx=upload_tx,
            etherscan_url=etherscan_url,
            message="File uploaded successfully for patient. Hospital has been granted access.",
        )
        
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Hospital upload failed: {str(e)}",
        )


@router.post("/hospital/ciphertext", response_model=HospitalUploadResponse)
async def hospital_upload_ciphertext(
    request: HospitalUploadCiphertextRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Hospital uploads pre-encrypted ciphertext for a patient.
    
    Use this when hospital encrypts client-side:
    1. Hospital fetches patient's public key
    2. Hospital generates CEK, encrypts file, encapsulates CEK with patient pubkey
    3. Hospital uploads ciphertext directly to Storacha
    4. Hospital sends CID and capsule metadata to this endpoint
    
    Pre-conditions:
    1. Caller must be authenticated as a hospital
    2. Patient must exist
    3. Hospital must have explicit grant from patient
    
    Args:
        request: Upload request with CID and capsule metadata
        current_user: Authenticated hospital user
        
    Returns:
        Confirmation with on-chain tx
        
    Raises:
        HTTPException 403: If hospital has no grant
    """
    hospital_id = current_user["id"]
    
    # Verify caller is a hospital
    if current_user.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hospitals can use this endpoint",
        )
    
    # Verify patient exists
    patient = await get_user_by_id(request.patient_id)
    if not patient:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Patient not found",
        )
    
    # CHECK GRANT
    has_grant = await check_hospital_has_grant(request.patient_id, hospital_id)
    if not has_grant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Hospital does not have permission to upload for this patient",
        )
    
    # Validate CID
    if not is_valid_cid(request.ciphertext_cid):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid CID format",
        )
    
    # Create file record
    filename = f"hospital_upload_{hospital_id}"
    if request.category:
        filename = f"[{request.category}] {filename}"
    
    file_record = FileRecord(
        cid=request.ciphertext_cid,
        owner_id=request.patient_id,
        filename=filename,
        encrypted_cek=request.encrypted_cek,
        capsule=request.capsule_meta,
        uploaded_by_hospital_id=hospital_id,  # Track which hospital uploaded
    )
    file_id = await create_file_record(file_record)
    
    # Record on-chain using ConsentRegistry
    upload_tx = None
    etherscan_url = None
    if is_chain_configured():
        try:
            # Pass raw identifiers - the function will compute hashes internally
            upload_tx_result = await record_upload_consent_registry(
                cid=request.ciphertext_cid,
                patient_id=str(request.patient_id),
                hospital_id=str(hospital_id),
            )
            upload_tx = upload_tx_result["tx_hash"]
            etherscan_url = get_etherscan_url(upload_tx)
        except Exception as e:
            print(f"Warning: Failed to record on-chain: {e}")
    
    # Record hospital ciphertext upload in audit log
    try:
        import json
        await create_audit_log(
            event_type="upload",
            actor_id=hospital_id,
            target_id=request.patient_id,
            patient_id=request.patient_id,
            file_id=file_id,
            cid=request.ciphertext_cid,
            details=json.dumps({
                "filename": filename,
                "category": request.category,
                "uploader_role": "hospital",
                "uploader_name": current_user.get("username"),
                "is_hospital_upload": True,
                "action": "hospital_ciphertext_upload",
            }),
            tx_hash=upload_tx,
        )
    except Exception as e:
        print(f"Warning: Failed to create ciphertext upload audit log: {e}")
    
    return HospitalUploadResponse(
        cid=request.ciphertext_cid,
        file_id=file_id,
        filename=filename,
        patient_id=request.patient_id,
        hospital_id=hospital_id,
        category=request.category,
        encrypted_cek=request.encrypted_cek,
        capsule=request.capsule_meta,
        upload_tx=upload_tx,
        etherscan_url=etherscan_url,
        message="Ciphertext recorded for patient",
    )


@router.post("/pin", response_model=PinResponse)
async def pin_to_ipfs(request: PinRequest):
    """
    Upload an encrypted file to Storacha (IPFS).
    
    Takes a previously encrypted file (by temp_file_id) and pins it
    to IPFS via Storacha API.
    
    Args:
        request: Pin request with temp file ID and metadata
        
    Returns:
        IPFS CID and database record info
        
    Example curl:
        curl -X POST http://localhost:8000/upload/pin \\
          -H "Content-Type: application/json" \\
          -d '{"temp_file_id": "xxx", "owner_id": 1, "original_filename": "test.txt", "encrypted_cek": "..."}'
    """
    temp_data = TEMP_ENCRYPTED_FILES.get(request.temp_file_id)
    if not temp_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Encrypted file not found. Please encrypt first.",
        )
    
    encrypted_file_path = temp_data["path"]
    if not os.path.exists(encrypted_file_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Encrypted file expired or deleted.",
        )
    
    try:
        # Upload to Storacha
        result = upload_to_storacha(encrypted_file_path)
        cid = result.get("cid")
        
        if not cid:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get CID from Storacha",
            )
        
        # Create file record
        file_record = FileRecord(
            cid=cid,
            owner_id=request.owner_id,
            filename=request.original_filename,
            encrypted_cek=request.encrypted_cek,
        )
        file_id = await create_file_record(file_record)
        
        # Cleanup temp file
        try:
            os.remove(encrypted_file_path)
            del TEMP_ENCRYPTED_FILES[request.temp_file_id]
        except Exception:
            pass
        
        return PinResponse(
            cid=cid,
            file_id=file_id,
            filename=request.original_filename,
            message="File pinned to IPFS successfully",
        )
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to pin file: {str(e)}",
        )


@router.get("/files/{user_id}", response_model=FileListResponse)
async def list_files(user_id: int):
    """
    List all files owned by a user.
    
    Args:
        user_id: ID of the file owner
        
    Returns:
        List of file records
        
    Example curl:
        curl http://localhost:8000/upload/files/1
    """
    files = await get_files_by_owner(user_id)
    return FileListResponse(
        files=files,
        count=len(files),
    )


class DownloadRequest(BaseModel):
    """Request to download and decrypt a file."""
    
    file_id: int
    owner_private_key: Optional[str] = None  # Hex-encoded (for owner decryption)
    grant_id: Optional[int] = None  # For grantee access via re-encryption


class DownloadResponse(BaseModel):
    """Response with decrypted file data."""
    
    filename: str
    content_base64: str  # Base64-encoded decrypted content
    content_type: str
    size: int
    message: str


@router.post("/download", response_model=DownloadResponse)
async def download_and_decrypt(request: DownloadRequest):
    """
    Download encrypted file from Storacha and decrypt it.
    
    For owners: provide owner_private_key to decrypt directly.
    For grantees: provide grant_id to use re-encryption.
    
    Args:
        request: Download request with file ID and decryption method
        
    Returns:
        Decrypted file content as base64
        
    Example curl (owner):
        curl -X POST http://localhost:8000/upload/download \\
          -H "Content-Type: application/json" \\
          -d '{"file_id": 1, "owner_private_key": "<hex>"}'
    """
    import base64
    import mimetypes
    from app.storage import download_blob
    from app.utils.umbral_utils import decrypt_with_cek
    
    # Get file record
    file_record = await get_file_by_id(request.file_id)
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    
    cid = file_record.get("cid")
    filename = file_record.get("filename", "unknown")
    encrypted_cek = file_record.get("encrypted_cek")
    capsule = file_record.get("capsule")  # May be stored in DB
    
    if not cid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File has no CID",
        )
    
    try:
        # Download encrypted blob from Storacha/IPFS
        encrypted_blob = download_blob(cid)
        
        # Extract nonce (first 12 bytes) and ciphertext
        nonce = encrypted_blob[:12]
        ciphertext = encrypted_blob[12:]
        
        # For now, we need to implement the full decryption flow
        # This requires either owner's private key or grant-based re-encryption
        
        if request.owner_private_key:
            # Owner decryption - need capsule and encrypted_cek from upload
            # The capsule should be stored in the file record or returned at upload
            
            # For basic demo, we'll decrypt using the stored encrypted_cek
            # In production, this would use Umbral capsule decryption
            
            from umbral import SecretKey, Capsule, decrypt_original
            from app.utils.umbral_utils import load_public_key
            
            # Decode owner's private key
            owner_sk = SecretKey.from_bytes(bytes.fromhex(request.owner_private_key))
            
            # If we have a capsule, use Umbral decryption
            if capsule:
                capsule_bytes = bytes.fromhex(capsule) if isinstance(capsule, str) else capsule
                capsule_obj = Capsule.from_bytes(capsule_bytes)
                encrypted_cek_bytes = bytes.fromhex(encrypted_cek)
                
                # Decrypt CEK using Umbral
                cek = decrypt_original(owner_sk, capsule_obj, encrypted_cek_bytes)
            else:
                # Fallback: encrypted_cek might just be hex CEK (dev mode)
                cek = bytes.fromhex(encrypted_cek)
            
            # Decrypt content with CEK
            decrypted = decrypt_with_cek(ciphertext, cek, nonce)
            
        elif request.grant_id:
            # Grantee decryption via re-encryption
            # This would call the grant/redeem flow
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail="Grant-based decryption not yet implemented in this endpoint. Use /grant/redeem.",
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Must provide owner_private_key or grant_id",
            )
        
        # Determine content type
        content_type, _ = mimetypes.guess_type(filename)
        if not content_type:
            content_type = "application/octet-stream"
        
        # Encode as base64 for JSON response
        content_b64 = base64.b64encode(decrypted).decode("utf-8")
        
        return DownloadResponse(
            filename=filename,
            content_base64=content_b64,
            content_type=content_type,
            size=len(decrypted),
            message="File decrypted successfully",
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Download/decrypt failed: {str(e)}",
        )


@router.get("/download/{file_id}")
async def download_encrypted_raw(file_id: int):
    """
    Download the raw encrypted blob from Storacha (for client-side decryption).
    
    Returns the encrypted file as-is, for cases where decryption happens in the browser.
    
    Args:
        file_id: ID of the file to download
        
    Returns:
        JSON with encrypted content and metadata needed for decryption
    """
    import base64
    from app.storage import download_blob
    
    file_record = await get_file_by_id(file_id)
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    
    cid = file_record.get("cid")
    if not cid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File has no CID",
        )
    
    try:
        encrypted_blob = download_blob(cid)
        
        return {
            "file_id": file_id,
            "filename": file_record.get("filename"),
            "cid": cid,
            "encrypted_blob_base64": base64.b64encode(encrypted_blob).decode("utf-8"),
            "encrypted_cek": file_record.get("encrypted_cek"),
            "capsule": file_record.get("capsule"),
            "size": len(encrypted_blob),
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Download failed: {str(e)}",
        )

