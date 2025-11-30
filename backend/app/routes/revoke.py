"""
Revocation Routes for Decent-Hospital Backend

Provides endpoints for revoking access and rotating Content Encryption Keys (CEK).
Supports two modes:
  - Option 1 (RECOMMENDED): Client-side rotation - patient decrypts locally and re-uploads
  - Option 2 (Server-assisted): Server temporarily decrypts with owner passphrase (RISKY)

SECURITY WARNINGS:
  ⚠️  NEVER store plaintext data on the server
  ⚠️  Option 2 should ONLY be used for demos with explicit operator consent
  ⚠️  In production, ALWAYS use Option 1 (client-side rotation)
  ⚠️  Server-assisted mode temporarily exposes plaintext - USE WITH EXTREME CAUTION

Endpoints:
- POST /revoke: Initiate revocation (marks grants revoked, emits on-chain event)
- POST /revoke/rotate-prepare: Prepare for client-side rotation (returns ciphertext for local decrypt)
- POST /revoke/rotate-complete: Complete rotation after client re-encrypts and re-uploads
- POST /revoke/server-assisted: Server-assisted rotation (DEMO ONLY, requires passphrase)

References:
- pyUmbral docs: https://pyumbral.readthedocs.io/
- Storacha docs: https://docs.storacha.network/
- Sepolia docs: https://sepolia.dev/
"""

import os
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.db import (
    get_file_by_cid,
    get_file_by_id,
    get_files_by_owner,
    get_grants_by_granter,
    get_grants_for_file,
    create_file_record,
    create_audit_log,
    FileRecord,
    revoke_grant,
)
from app.routes.auth import require_current_user
from app.utils.chain import (
    is_chain_configured,
    ChainError,
    ChainConfigError,
    ensure_hex_prefix,
)
from app.utils.storage import upload_bytes_to_storacha


router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class RevokeRequest(BaseModel):
    """Request to revoke access to a file by CID."""
    cid: str  # IPFS Content Identifier of the file to revoke


class RevokeResponse(BaseModel):
    """Response after initiating revocation."""
    revoked: bool
    revoked_grants_count: int
    revoke_tx: Optional[str] = None  # On-chain transaction hash for AccessRevoked event
    message: str
    next_step: str  # Instructions for client-side rotation


class RotatePrepareRequest(BaseModel):
    """Request to prepare for client-side CEK rotation."""
    cid: str  # CID of the file to rotate


class RotatePrepareResponse(BaseModel):
    """Response with data needed for client-side decryption and re-encryption."""
    file_id: int
    cid: str
    filename: str
    encrypted_cek: str  # Encrypted CEK for client to decrypt locally
    capsule: str  # Umbral capsule for decapsulation
    message: str


class RotateCompleteRequest(BaseModel):
    """Request to complete rotation after client re-encrypts."""
    old_cid: str  # Original CID being replaced
    new_encrypted_blob_base64: str  # New ciphertext (base64 encoded)
    new_encrypted_cek: str  # New CEK encrypted with owner's public key
    new_capsule: str  # New Umbral capsule
    filename: str  # Original filename


class RotateCompleteResponse(BaseModel):
    """Response after completing CEK rotation."""
    revoked: bool
    new_cid: str
    new_file_id: int
    revoke_tx: Optional[str] = None  # AccessRevoked tx hash
    new_upload_tx: Optional[str] = None  # UploadRecorded tx hash
    message: str


class ServerAssistedRevokeRequest(BaseModel):
    """
    Request for server-assisted revocation.
    
    ⚠️  SECURITY WARNING: This mode temporarily exposes plaintext on the server.
    Use ONLY for demos with explicit operator consent. In production, use
    client-side rotation (Option 1) instead.
    """
    cid: str  # CID of the file to revoke and rotate
    operator_passphrase: str  # Passphrase to confirm operator consent
    
    # ⚠️  WARNING: The following field should NEVER be stored permanently
    # It is used only for this demo to decrypt the CEK temporarily
    owner_private_key_encrypted: Optional[str] = None  # Encrypted private key (if stored)


class ServerAssistedRevokeResponse(BaseModel):
    """Response after server-assisted revocation."""
    revoked: bool
    revoke_tx: Optional[str] = None
    new_cid: Optional[str] = None
    new_upload_tx: Optional[str] = None
    warning: str  # Security warning about this mode
    message: str


# ============================================================================
# Chain Interaction Helpers
# ============================================================================


async def emit_access_revoked_onchain(cid: str) -> Optional[str]:
    """
    Emit AccessRevoked event on-chain using the signalKeyRotation function.
    
    This function signals CEK rotation/revocation on-chain for audit purposes.
    Unlike revokeAccessByHash, it does not require an active grant to exist.
    
    Args:
        cid: IPFS CID of the file being revoked
        
    Returns:
        Transaction hash or None if chain not configured
        
    References:
        - HealthRecords.sol signalKeyRotation()
        - Sepolia testnet: https://sepolia.etherscan.io/
    """
    if not is_chain_configured():
        return None
    
    try:
        from web3 import Web3
        from app.utils.chain import get_web3, get_signer
        
        w3 = get_web3()
        signer = get_signer(w3)
        
        # Compute cidHash = keccak256(cid)
        cid_hash = Web3.keccak(text=cid)
        
        # Get contract address from env
        contract_address = os.getenv("HEALTH_RECORDS_CONTRACT_ADDRESS") or os.getenv("GRANT_CONTRACT_ADDRESS")
        print(f"DEBUG: Using contract address: {contract_address}")
        print(f"DEBUG: Signer address: {signer.address}")
        
        # ABI for signalKeyRotation function
        SIGNAL_KEY_ROTATION_ABI = [
            {
                "inputs": [{"name": "cidHash", "type": "bytes32"}],
                "name": "signalKeyRotation",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "cidHash", "type": "bytes32"},
                    {"indexed": True, "name": "owner", "type": "address"}
                ],
                "name": "AccessRevoked",
                "type": "event"
            }
        ]
        
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(contract_address),
            abi=SIGNAL_KEY_ROTATION_ABI,
        )
        
        nonce = w3.eth.get_transaction_count(signer.address)
        
        tx = contract.functions.signalKeyRotation(cid_hash).build_transaction({
            'from': signer.address,
            'nonce': nonce,
            'gas': 100000,
            'gasPrice': w3.eth.gas_price,
        })
        
        signed_tx = w3.eth.account.sign_transaction(tx, signer.key)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt['status'] != 1:
            raise ChainError("signalKeyRotation transaction reverted")
        
        return ensure_hex_prefix(tx_hash.hex())
        
    except (ChainConfigError, ChainError):
        raise
    except Exception as e:
        import traceback
        print(f"Chain error details: {traceback.format_exc()}")
        raise ChainError(f"Failed to emit AccessRevoked event: {str(e)}")


async def emit_upload_recorded_onchain(cid: str) -> Optional[str]:
    """
    Emit UploadRecorded event on-chain for the new rotated file.
    
    Args:
        cid: New IPFS CID after rotation
        
    Returns:
        Transaction hash or None if chain not configured
    """
    if not is_chain_configured():
        return None
    
    try:
        from web3 import Web3
        from app.utils.chain import get_web3, get_signer
        
        w3 = get_web3()
        signer = get_signer(w3)
        
        cid_hash = Web3.keccak(text=cid)
        
        config = {
            "contract_address": os.getenv("HEALTH_RECORDS_CONTRACT_ADDRESS") or os.getenv("GRANT_CONTRACT_ADDRESS"),
        }
        
        UPLOAD_ABI = [
            {
                "inputs": [{"name": "cidHash", "type": "bytes32"}],
                "name": "recordUpload",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "cidHash", "type": "bytes32"},
                    {"indexed": True, "name": "owner", "type": "address"},
                    {"indexed": False, "name": "ts", "type": "uint256"}
                ],
                "name": "UploadRecorded",
                "type": "event"
            }
        ]
        
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(config["contract_address"]),
            abi=UPLOAD_ABI,
        )
        
        nonce = w3.eth.get_transaction_count(signer.address)
        
        tx = contract.functions.recordUpload(cid_hash).build_transaction({
            'from': signer.address,
            'nonce': nonce,
            'gas': 100000,
            'gasPrice': w3.eth.gas_price,
        })
        
        signed_tx = w3.eth.account.sign_transaction(tx, signer.key)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt['status'] != 1:
            raise ChainError("UploadRecorded transaction reverted")
        
        return ensure_hex_prefix(tx_hash.hex())
        
    except (ChainConfigError, ChainError):
        raise
    except Exception as e:
        raise ChainError(f"Failed to emit UploadRecorded event: {str(e)}")


# ============================================================================
# Routes
# ============================================================================


@router.post("", response_model=RevokeResponse)
@router.post("/", response_model=RevokeResponse)
async def revoke_access(
    request: RevokeRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Revoke access to a file (Step 1 of revocation flow).
    
    This endpoint:
    1. Marks all grants for this CID as revoked in the database
    2. Emits AccessRevoked(cidHash) event on-chain
    3. Returns instructions for client-side CEK rotation
    
    The file content remains encrypted with the old CEK until rotation is complete.
    Grantees can no longer redeem their grants after revocation.
    
    To complete revocation and ensure forward secrecy, the owner should:
    - Call /revoke/rotate-prepare to get the encrypted file
    - Decrypt locally in the browser
    - Re-encrypt with a new CEK
    - Call /revoke/rotate-complete to upload the new ciphertext
    
    Args:
        request: Revoke request with CID
        current_user: Authenticated user (must be file owner)
        
    Returns:
        Revocation status and next steps
        
    Example curl:
        curl -X POST http://localhost:8000/revoke \\
          -H "Authorization: Bearer <token>" \\
          -H "Content-Type: application/json" \\
          -d '{"cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"}'
    """
    # Get the file record
    file_record = await get_file_by_cid(request.cid)
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    
    # Verify ownership
    if file_record.get("owner_id") != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the file owner can revoke access",
        )
    
    # Get all grants for this file
    grants = await get_grants_for_file(file_record["id"])
    revoked_count = 0
    
    # Revoke all active grants
    for grant in grants:
        if grant.get("status") == "active":
            success = await revoke_grant(grant["id"], None)
            if success:
                revoked_count += 1
    
    # Emit on-chain revocation event
    revoke_tx = None
    try:
        revoke_tx = await emit_access_revoked_onchain(request.cid)
    except ChainConfigError:
        pass  # Chain not configured, continue without on-chain tx
    except ChainError as e:
        # Log but don't fail - grants are already revoked in DB
        print(f"Warning: On-chain revocation failed: {e}")
    
    # Record revoke event in audit log for each revoked grant
    for grant in grants:
        if grant.get("status") == "active":
            try:
                await create_audit_log(
                    event_type="revoke",
                    actor_id=current_user["id"],
                    target_id=grant.get("grantee_id"),
                    patient_id=current_user["id"],
                    file_id=file_record["id"],
                    cid=request.cid,
                    details=json.dumps({
                        "filename": file_record.get("filename"),
                        "grantee_id": grant.get("grantee_id"),
                        "grant_id": grant.get("id"),
                    }),
                    tx_hash=revoke_tx,
                )
            except Exception as e:
                print(f"Warning: Failed to create revoke audit log: {e}")
    
    return RevokeResponse(
        revoked=True,
        revoked_grants_count=revoked_count,
        revoke_tx=revoke_tx,
        message=f"Revoked {revoked_count} grant(s). Complete rotation to ensure forward secrecy.",
        next_step="Use 'Rotate & Re-upload' in the UI or call /revoke/rotate-prepare to begin CEK rotation.",
    )


@router.post("/rotate-prepare", response_model=RotatePrepareResponse)
async def prepare_rotation(
    request: RotatePrepareRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Prepare for client-side CEK rotation (Option 1 - RECOMMENDED).
    
    Returns the encrypted file metadata so the client can:
    1. Download the encrypted blob from Storacha
    2. Decrypt locally using owner's private key
    3. Re-encrypt with a new CEK
    4. Call /revoke/rotate-complete to upload new ciphertext
    
    Args:
        request: Rotation prepare request with CID
        current_user: Authenticated user (file owner)
        
    Returns:
        File metadata for local decryption
    """
    file_record = await get_file_by_cid(request.cid)
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    
    if file_record.get("owner_id") != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the file owner can rotate the CEK",
        )
    
    return RotatePrepareResponse(
        file_id=file_record["id"],
        cid=file_record["cid"],
        filename=file_record["filename"],
        encrypted_cek=file_record.get("encrypted_cek", ""),
        capsule=file_record.get("capsule", ""),
        message="Download and decrypt the file locally, then re-encrypt with a new CEK and call /revoke/rotate-complete",
    )


@router.post("/rotate-complete", response_model=RotateCompleteResponse)
async def complete_rotation(
    request: RotateCompleteRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Complete CEK rotation after client-side re-encryption.
    
    This is called after the client has:
    1. Downloaded and decrypted the file locally
    2. Generated a new CEK
    3. Re-encrypted the plaintext with the new CEK
    4. Encapsulated the new CEK with owner's public key
    
    This endpoint:
    1. Uploads the new ciphertext to Storacha
    2. Creates a new file record with the new CID
    3. Emits UploadRecorded(newCidHash) on-chain
    
    Args:
        request: Rotation complete request with new encrypted data
        current_user: Authenticated user (file owner)
        
    Returns:
        New CID and transaction hashes
    """
    import base64
    
    # Verify the old file exists and belongs to user
    old_file = await get_file_by_cid(request.old_cid)
    if not old_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Original file not found",
        )
    
    if old_file.get("owner_id") != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the file owner can complete rotation",
        )
    
    # Decode and upload new ciphertext
    try:
        new_ciphertext = base64.b64decode(request.new_encrypted_blob_base64)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64-encoded ciphertext",
        )
    
    # Upload to Storacha (note: upload_bytes_to_storacha is synchronous)
    try:
        result = upload_bytes_to_storacha(new_ciphertext, request.filename)
        new_cid = result.get("cid") if isinstance(result, dict) else result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to upload to Storacha: {str(e)}",
        )
    
    # Create new file record
    new_file = FileRecord(
        cid=new_cid,
        owner_id=current_user["id"],
        filename=request.filename,
        encrypted_cek=request.new_encrypted_cek,
        capsule=request.new_capsule,
    )
    new_file_id = await create_file_record(new_file)
    
    # Emit revoke tx (if not already done)
    revoke_tx = None
    try:
        revoke_tx = await emit_access_revoked_onchain(request.old_cid)
    except (ChainConfigError, ChainError):
        pass
    
    # Emit new upload tx
    new_upload_tx = None
    try:
        new_upload_tx = await emit_upload_recorded_onchain(new_cid)
    except (ChainConfigError, ChainError):
        pass
    
    return RotateCompleteResponse(
        revoked=True,
        new_cid=new_cid,
        new_file_id=new_file_id,
        revoke_tx=revoke_tx,
        new_upload_tx=new_upload_tx,
        message="CEK rotation complete. New file uploaded with fresh encryption.",
    )


@router.post("/server-assisted", response_model=ServerAssistedRevokeResponse)
async def server_assisted_revoke(
    request: ServerAssistedRevokeRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Server-assisted CEK rotation (Option 2 - DEMO ONLY).
    
    ⚠️  SECURITY WARNING ⚠️
    ══════════════════════════════════════════════════════════════════════════
    THIS MODE TEMPORARILY EXPOSES PLAINTEXT ON THE SERVER.
    
    This should ONLY be used for demos where the operator explicitly consents.
    In production, ALWAYS use client-side rotation (Option 1).
    
    Risks of this mode:
    - Server briefly holds plaintext data in memory
    - Operator passphrase provides minimal protection
    - Audit trail shows server touched plaintext
    - Violates zero-knowledge principle
    
    The required passphrase "I_UNDERSTAND_THE_RISKS" must be provided to proceed.
    ══════════════════════════════════════════════════════════════════════════
    
    Args:
        request: Server-assisted request with CID and passphrase
        current_user: Authenticated user (file owner)
        
    Returns:
        Revocation status with strong security warnings
    """
    # ⚠️  SECURITY CHECK: Require explicit operator consent
    REQUIRED_PASSPHRASE = os.getenv("REVOKE_SERVER_PASSPHRASE", "I_UNDERSTAND_THE_RISKS")
    
    if request.operator_passphrase != REQUIRED_PASSPHRASE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Server-assisted revocation requires operator passphrase. "
                "This mode is dangerous and should only be used for demos. "
                "Use client-side rotation (Option 1) instead."
            ),
        )
    
    # Verify file ownership
    file_record = await get_file_by_cid(request.cid)
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    
    if file_record.get("owner_id") != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the file owner can revoke access",
        )
    
    # ⚠️  THIS IS WHERE PLAINTEXT WOULD BE EXPOSED
    # For the demo, we just return an error explaining what would happen
    # A real implementation would need the owner's private key to decrypt
    
    # In a full implementation, this would:
    # 1. Download encrypted blob from Storacha
    # 2. Decrypt CEK using owner's private key (⚠️ PLAINTEXT EXPOSED)
    # 3. Decrypt file content (⚠️ PLAINTEXT IN MEMORY)
    # 4. Generate new CEK
    # 5. Re-encrypt with new CEK
    # 6. Upload new ciphertext
    # 7. Emit on-chain events
    
    # For safety, we require the owner's encrypted private key to be passed
    # This is still risky but slightly better than storing it server-side
    
    if not request.owner_private_key_encrypted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Server-assisted mode requires owner_private_key_encrypted. "
                "For security, use client-side rotation instead. "
                "This feature is intentionally limited for demo safety."
            ),
        )
    
    # ⚠️  DEMO ONLY: In a real implementation, we would decrypt here
    # For now, we just revoke grants and emit the event without rotating
    
    # Revoke all grants
    grants = await get_grants_for_file(file_record["id"])
    for grant in grants:
        if grant.get("status") == "active":
            await revoke_grant(grant["id"], None)
    
    # Emit on-chain revocation
    revoke_tx = None
    try:
        revoke_tx = await emit_access_revoked_onchain(request.cid)
    except (ChainConfigError, ChainError):
        pass
    
    return ServerAssistedRevokeResponse(
        revoked=True,
        revoke_tx=revoke_tx,
        new_cid=None,  # Not implemented for safety
        new_upload_tx=None,
        warning=(
            "⚠️ SERVER-ASSISTED MODE: For demo purposes, grants were revoked but CEK "
            "was NOT rotated. Full server-assisted rotation is disabled for safety. "
            "Use client-side rotation for complete forward secrecy."
        ),
        message="Grants revoked. Use client-side rotation to complete CEK rotation.",
    )
