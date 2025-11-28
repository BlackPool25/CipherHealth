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

import os
import tempfile
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.db import FileRecord, create_file_record, get_files_by_owner, get_user_by_id
from app.routes.auth import get_current_user_from_token
from app.utils.storage import upload_to_storacha, upload_bytes_to_storacha, is_valid_cid
from app.utils.umbral_utils import (
    encrypt_with_cek,
    generate_cek,
    encapsulate_cek,
    UMBRAL_AVAILABLE,
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
        
        # Create file record in database
        file_record = FileRecord(
            cid=cid,
            owner_id=patient_id,
            filename=filename,
            encrypted_cek=cek_ciphertext,
        )
        file_id = await create_file_record(file_record)
        
        return UploadResponse(
            cid=cid,
            file_id=file_id,
            filename=filename,
            encrypted_cek=cek_ciphertext,
            capsule=capsule_hex,
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
