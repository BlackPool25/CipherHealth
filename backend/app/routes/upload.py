"""
Upload Routes for Decent-Hospital Backend

Handles file encryption and IPFS pinning:
- POST /upload/encrypt: Encrypt a file with a new CEK
- POST /upload/pin: Upload encrypted file to web3.storage
"""

import os
import tempfile
import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.db import FileRecord, create_file_record, get_user_by_id
from app.utils.storage import upload_to_web3_storage
from app.utils.umbral_utils import encrypt_with_cek, generate_cek

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class EncryptResponse(BaseModel):
    """Response after encrypting a file."""

    temp_file_id: str  # ID to reference the encrypted file for pinning
    encrypted_file_path: str  # Path to encrypted file (server-side)
    cek_ciphertext: str  # CEK encrypted with owner's public key (hex)
    original_filename: str
    encrypted_size: int
    message: str


class PinRequest(BaseModel):
    """Request to pin an encrypted file."""

    temp_file_id: str
    owner_id: int
    original_filename: str
    encrypted_cek: str  # CEK encrypted with owner's public key


class PinResponse(BaseModel):
    """Response after pinning to IPFS."""

    cid: str  # IPFS Content Identifier
    file_id: int  # Database record ID
    filename: str
    message: str


# Temporary storage for encrypted files awaiting pinning
# TODO: In production, use Redis or proper temp storage with TTL
TEMP_ENCRYPTED_FILES: dict[str, str] = {}


# ============================================================================
# Routes
# ============================================================================


@router.post("/encrypt", response_model=EncryptResponse)
async def encrypt_file(
    file: UploadFile = File(...),
    owner_id: int = Form(...),
    owner_public_key: Optional[str] = Form(None),
):
    """
    Encrypt a file using symmetric encryption (AES-GCM).

    Generates a new Content Encryption Key (CEK) for each file.
    The CEK is then encrypted with the owner's Umbral public key.

    Args:
        file: The file to encrypt (multipart upload).
        owner_id: ID of the file owner.
        owner_public_key: Owner's Umbral public key (hex). If not provided,
                          fetches from database.

    Returns:
        Encrypted file info and encrypted CEK.

    Raises:
        HTTPException 400: If owner not found or missing public key.
        HTTPException 500: If encryption fails.
    """
    # Validate owner exists
    owner = await get_user_by_id(owner_id)
    if not owner:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Owner not found",
        )

    # Get public key from request or database
    public_key = owner_public_key or owner.get("public_key")
    if not public_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Owner public key not found. Please provide owner_public_key.",
        )

    try:
        # Read file content
        file_content = await file.read()

        # Generate CEK and encrypt file content
        # TODO: Implement actual encryption in umbral_utils
        cek = generate_cek()
        encrypted_content, nonce = encrypt_with_cek(file_content, cek)

        # Encrypt CEK with owner's public key
        # TODO: Implement CEK encryption with Umbral
        # For now, placeholder - just hex encode
        cek_ciphertext = cek.hex()  # PLACEHOLDER: Should use Umbral encapsulation

        # Save encrypted file to temp storage
        temp_file_id = str(uuid.uuid4())
        temp_dir = tempfile.gettempdir()
        encrypted_file_path = os.path.join(temp_dir, f"{temp_file_id}.enc")

        with open(encrypted_file_path, "wb") as f:
            # Write nonce + encrypted content
            f.write(nonce + encrypted_content)

        # Store reference for later pinning
        TEMP_ENCRYPTED_FILES[temp_file_id] = encrypted_file_path

        return EncryptResponse(
            temp_file_id=temp_file_id,
            encrypted_file_path=encrypted_file_path,
            cek_ciphertext=cek_ciphertext,
            original_filename=file.filename or "unknown",
            encrypted_size=len(nonce + encrypted_content),
            message="File encrypted successfully",
        )

    except NotImplementedError as e:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Encryption failed: {str(e)}",
        )


@router.post("/pin", response_model=PinResponse)
async def pin_to_ipfs(request: PinRequest):
    """
    Upload an encrypted file to web3.storage (IPFS).

    Takes a previously encrypted file (by temp_file_id) and pins it
    to IPFS via web3.storage API.

    Args:
        request: Pin request with temp file ID and metadata.

    Returns:
        IPFS CID and database record info.

    Raises:
        HTTPException 400: If temp file not found.
        HTTPException 500: If upload fails.
    """
    # Get the encrypted file path
    encrypted_file_path = TEMP_ENCRYPTED_FILES.get(request.temp_file_id)
    if not encrypted_file_path or not os.path.exists(encrypted_file_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Encrypted file not found. Please encrypt first.",
        )

    try:
        # Upload to web3.storage
        result = upload_to_web3_storage(encrypted_file_path)
        cid = result.get("cid")

        if not cid:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get CID from web3.storage",
            )

        # Create file record in database
        file_record = FileRecord(
            cid=cid,
            owner_id=request.owner_id,
            filename=request.original_filename,
            encrypted_cek=request.encrypted_cek,
        )
        file_id = await create_file_record(file_record)

        # Clean up temp file
        try:
            os.remove(encrypted_file_path)
            del TEMP_ENCRYPTED_FILES[request.temp_file_id]
        except Exception:
            pass  # Non-critical cleanup

        return PinResponse(
            cid=cid,
            file_id=file_id,
            filename=request.original_filename,
            message="File pinned to IPFS successfully",
        )

    except NotImplementedError as e:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(e),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to pin file: {str(e)}",
        )


@router.post("/encrypt-and-pin", response_model=PinResponse)
async def encrypt_and_pin(
    file: UploadFile = File(...),
    owner_id: int = Form(...),
    owner_public_key: Optional[str] = Form(None),
):
    """
    Convenience endpoint: encrypt and pin in one request.

    Combines /encrypt and /pin into a single operation.

    Args:
        file: The file to encrypt and pin.
        owner_id: ID of the file owner.
        owner_public_key: Owner's Umbral public key (hex).

    Returns:
        IPFS CID and file info.
    """
    # First encrypt
    encrypt_response = await encrypt_file(file, owner_id, owner_public_key)

    # Then pin
    pin_request = PinRequest(
        temp_file_id=encrypt_response.temp_file_id,
        owner_id=owner_id,
        original_filename=encrypt_response.original_filename,
        encrypted_cek=encrypt_response.cek_ciphertext,
    )
    return await pin_to_ipfs(pin_request)
