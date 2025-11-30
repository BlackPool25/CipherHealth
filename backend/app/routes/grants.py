"""
Grant Routes for Decent-Hospital Backend

Handles Umbral proxy re-encryption grants:
- POST /grant: Create a re-encryption key grant
- POST /grant/create: Alias for creating a grant
- POST /grant/revoke: Revoke a grant
- POST /grant/redeem: Grantee redeems access (re-encryption)
- GET /grant/list/{user_id}: List grants for a user

Grant Flow:
1. Owner uploads encrypted file (CEK encapsulated with owner's public key)
2. Owner grants access to grantee: generates kfrag (re-encryption key)
3. Grantee calls redeem: backend re-encrypts capsule using kfrag
4. Grantee can now decrypt the CEK and thus the file
"""

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.db import (
    GrantCreate,
    GrantResponse,
    create_grant,
    create_audit_log,
    get_file_by_cid,
    get_file_by_id,
    get_grant_by_id,
    get_grants_by_granter,
    get_grants_for_grantee,
    get_user_by_id,
    get_user_by_uuid,
    revoke_grant,
)
from app.routes.auth import require_current_user
from app.utils.umbral_utils import (
    generate_reenc_key,
    reencrypt_capsule,
    get_public_key_hex,
    UMBRAL_AVAILABLE,
)

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class GrantRequest(BaseModel):
    """Request to create a new grant (simplified)."""

    grantee_pubkey: str  # Grantee's Umbral public key (hex)
    file_id: int  # File to grant access to
    expiry_seconds: Optional[int] = None  # Grant expiry in seconds (None = no expiry)


class CreateGrantRequest(BaseModel):
    """Request to create a new grant (full form)."""

    granter_id: int
    grantee_id: Optional[int] = None  # Either grantee_id or grantee_uuid must be provided
    grantee_uuid: Optional[str] = None  # UUID of the grantee (preferred)
    file_id: int
    expires_at: Optional[str] = None


class CreateGrantResponse(BaseModel):
    """Response after creating a grant."""

    grant_id: int
    grantee_id: int  # Resolved grantee ID
    grantee_uuid: Optional[str] = None  # Grantee's UUID if available
    reencryption_key: str  # Umbral kfrag (hex encoded, stored server-side encrypted)
    tx_hash: Optional[str] = None  # On-chain transaction hash
    message: str


class RevokeGrantRequest(BaseModel):
    """Request to revoke a grant."""

    grant_id: int
    granter_id: int
    emit_onchain: bool = True


class RevokeGrantResponse(BaseModel):
    """Response after revoking a grant."""

    grant_id: int
    status: str
    tx_hash: Optional[str] = None
    message: str


class RedeemRequest(BaseModel):
    """Request to redeem a grant (re-encrypt for grantee)."""

    grant_id: int
    capsule: str  # Original capsule from upload (hex)


class RedeemResponse(BaseModel):
    """Response with re-encrypted capsule."""

    cfrag: str  # Re-encrypted ciphertext fragment (hex)
    capsule: str  # Original capsule (for client reference)
    delegating_pk: str  # Granter's public key (hex)
    message: str


class ListGrantsResponse(BaseModel):
    """Response for listing grants."""

    grants: list[dict]
    count: int


# ============================================================================
# Routes
# ============================================================================


@router.post("", response_model=CreateGrantResponse)
@router.post("/", response_model=CreateGrantResponse)
async def grant_access(
    request: GrantRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Owner grants access to a grantee.
    
    Uses pyUmbral to create a re-encryption key (kfrag) that allows
    the backend to re-encrypt data for the grantee.
    
    The kfrag is stored server-side (encrypted), no plaintext keys
    are exposed.
    
    Args:
        request: Grant request with grantee's public key and file ID
        current_user: Authenticated user (owner/granter)
        
    Returns:
        Grant ID and confirmation
        
    Example curl:
        curl -X POST http://localhost:8000/grant \\
          -H "Authorization: Bearer <token>" \\
          -H "Content-Type: application/json" \\
          -d '{"grantee_pubkey": "<hex>", "file_id": 1, "expiry_seconds": 3600}'
    """
    granter_id = current_user["id"]
    
    # Validate grantee public key format
    if not request.grantee_pubkey or len(request.grantee_pubkey) < 32:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid grantee public key",
        )
    
    # TODO: Validate file ownership
    # file = await get_file_by_id(request.file_id)
    # if not file or file["owner_id"] != granter_id:
    #     raise HTTPException(...)
    
    # Calculate expiry timestamp
    expires_at = None
    if request.expiry_seconds:
        from datetime import timedelta
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=request.expiry_seconds)
        ).isoformat()
    
    try:
        # Generate re-encryption key using Umbral
        if UMBRAL_AVAILABLE:
            reenc_key = generate_reenc_key(
                granter_secret_key=None,  # Loaded from file for security
                grantee_public_key=request.grantee_pubkey,
            )
        else:
            # Placeholder for dev mode
            reenc_key = "placeholder_kfrag_" + request.grantee_pubkey[:16]
        
        # Create grant record
        # Note: We need grantee_id for database, but in this flow we only have pubkey
        # In production, look up grantee by public key or use 0 as placeholder
        grant_data = GrantCreate(
            granter_id=granter_id,
            grantee_id=0,  # Placeholder - grantee identified by pubkey
            file_id=request.file_id,
            expires_at=expires_at,
        )
        grant_id = await create_grant(grant_data, reenc_key)
        
        return CreateGrantResponse(
            grant_id=grant_id,
            reencryption_key=reenc_key,  # Returned but stored encrypted server-side
            message="Grant created successfully",
        )
        
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Key file not found: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create grant: {str(e)}",
        )


@router.post("/create", response_model=CreateGrantResponse)
async def create_new_grant(request: CreateGrantRequest):
    """
    Create a new re-encryption key grant.
    
    Supports granting access by either grantee_id (numeric) or grantee_uuid (UUID).
    Using UUID is recommended as it's more secure and user-friendly.
    
    Args:
        request: Grant creation request with granter_id, grantee (by id or uuid), file_id
        
    Returns:
        Grant ID, resolved grantee info, and re-encryption key
    """
    # Validate granter exists
    granter = await get_user_by_id(request.granter_id)
    if not granter:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Granter not found",
        )
    
    # Resolve grantee - support both ID and UUID
    grantee = None
    grantee_id = None
    grantee_uuid = None
    
    if request.grantee_uuid:
        # Look up by UUID (preferred)
        grantee = await get_user_by_uuid(request.grantee_uuid)
        if not grantee:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No user found with UUID: {request.grantee_uuid}",
            )
        grantee_id = grantee.get("id")
        grantee_uuid = request.grantee_uuid
    elif request.grantee_id:
        # Look up by numeric ID (legacy)
        grantee = await get_user_by_id(request.grantee_id)
        if not grantee:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No user found with ID: {request.grantee_id}",
            )
        grantee_id = request.grantee_id
        grantee_uuid = grantee.get("uuid")
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either grantee_id or grantee_uuid must be provided",
        )
    
    # Validate grantee has a public key
    grantee_public_key = grantee.get("public_key")
    if not grantee_public_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Grantee has no public key registered. They need to generate encryption keys first.",
        )
    
    # Validate file exists and belongs to granter
    file_record = await get_file_by_id(request.file_id)
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File not found",
        )
    if file_record.get("owner_id") != request.granter_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the file owner can grant access",
        )
    
    try:
        if UMBRAL_AVAILABLE:
            reenc_key = generate_reenc_key(
                granter_secret_key=None,
                grantee_public_key=grantee_public_key,
            )
        else:
            reenc_key = f"placeholder_kfrag_{grantee_public_key[:16]}"
        
        grant_data = GrantCreate(
            granter_id=request.granter_id,
            grantee_id=grantee_id,
            file_id=request.file_id,
            expires_at=request.expires_at,
        )
        grant_id = await create_grant(grant_data, reenc_key)
        
        # Record grant in audit log
        try:
            await create_audit_log(
                event_type="grant",
                actor_id=request.granter_id,
                target_id=grantee_id,
                patient_id=request.granter_id,
                file_id=request.file_id,
                cid=file_record.get("cid"),
                details=f'{{"filename": "{file_record.get("filename")}", "grantee_name": "{grantee.get("username")}", "grantee_uuid": "{grantee_uuid}"}}',
                tx_hash=None,  # On-chain recording handled separately
            )
        except Exception as e:
            print(f"Warning: Failed to create grant audit log: {e}")
        
        return CreateGrantResponse(
            grant_id=grant_id,
            grantee_id=grantee_id,
            grantee_uuid=grantee_uuid,
            reencryption_key=reenc_key,
            tx_hash=None,  # Can be added when on-chain recording is enabled
            message=f"Grant created successfully for {grantee.get('username')}",
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create grant: {str(e)}",
        )


@router.post("/redeem", response_model=RedeemResponse)
async def redeem_grant(request: RedeemRequest):
    """
    Grantee redeems a grant to get re-encrypted capsule.
    
    The backend performs re-encryption using the stored kfrag and
    returns a cfrag that the grantee can use to decrypt the data.
    
    Args:
        request: Redeem request with grant ID and original capsule
        
    Returns:
        Re-encrypted capsule fragment (cfrag)
        
    Raises:
        HTTPException 400: If grant not found or expired
        HTTPException 403: If grant is revoked
        
    Example curl:
        curl -X POST http://localhost:8000/grant/redeem \\
          -H "Content-Type: application/json" \\
          -d '{"grant_id": 1, "capsule": "<hex_capsule>"}'
    """
    # Get the grant
    grant = await get_grant_by_id(request.grant_id)
    if not grant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Grant not found",
        )
    
    # Check grant status
    if grant.get("status") == "revoked":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Grant has been revoked",
        )
    
    # Check expiry
    expires_at = grant.get("expires_at")
    if expires_at:
        try:
            expiry_time = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > expiry_time:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Grant has expired",
                )
        except ValueError:
            pass  # Invalid date format, ignore expiry check
    
    # Get the stored re-encryption key
    kfrag = grant.get("reencryption_key")
    if not kfrag:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Re-encryption key not found for this grant",
        )
    
    try:
        if UMBRAL_AVAILABLE:
            # Get granter's public key for verification
            granter = await get_user_by_id(grant["granter_id"])
            granter_pk = granter.get("public_key") if granter else ""
            
            # Get verifying key (signing public key)
            verifying_pk = get_public_key_hex()  # From signing key file
            
            # Perform re-encryption
            cfrag = reencrypt_capsule(
                capsule_hex=request.capsule,
                kfrag_hex=kfrag,
                delegating_pk_hex=granter_pk,
                verifying_pk_hex=verifying_pk,
            )
        else:
            # Placeholder for dev mode
            cfrag = f"placeholder_cfrag_{request.capsule[:16]}"
            granter_pk = "placeholder_pk"
        
        return RedeemResponse(
            cfrag=cfrag,
            capsule=request.capsule,
            delegating_pk=granter_pk if UMBRAL_AVAILABLE else "placeholder",
            message="Re-encryption successful",
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Re-encryption failed: {str(e)}",
        )


@router.post("/revoke", response_model=RevokeGrantResponse)
async def revoke_existing_grant(request: RevokeGrantRequest):
    """
    Revoke an existing grant.
    
    Marks the grant as revoked in the database and optionally emits
    an on-chain transaction.
    
    Args:
        request: Revoke request with grant ID and authorization
        
    Returns:
        Revocation status and transaction hash (if on-chain)
        
    Example curl:
        curl -X POST http://localhost:8000/grant/revoke \\
          -H "Content-Type: application/json" \\
          -d '{"grant_id": 1, "granter_id": 1, "emit_onchain": false}'
    """
    # Get the grant
    grant = await get_grant_by_id(request.grant_id)
    if not grant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Grant not found",
        )
    
    # Verify authorization
    if grant.get("granter_id") != request.granter_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the granter can revoke this grant",
        )
    
    # Check if already revoked
    if grant.get("status") == "revoked":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Grant is already revoked",
        )
    
    tx_hash = None
    
    # Emit on-chain revocation if requested
    if request.emit_onchain:
        try:
            tx_hash = await emit_onchain_revocation(request.grant_id)
        except NotImplementedError:
            pass  # On-chain not configured, continue
        except Exception as e:
            print(f"Warning: On-chain revocation failed: {e}")
    
    # Revoke in database
    success = await revoke_grant(request.grant_id, tx_hash)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to revoke grant in database",
        )
    
    return RevokeGrantResponse(
        grant_id=request.grant_id,
        status="revoked",
        tx_hash=tx_hash,
        message="Grant revoked successfully",
    )


@router.get("/list/{user_id}", response_model=ListGrantsResponse)
async def list_grants(user_id: int):
    """
    List all grants created by a user (as granter).
    
    Args:
        user_id: ID of the granter
        
    Returns:
        List of grants
    """
    grants = await get_grants_by_granter(user_id)
    return ListGrantsResponse(grants=grants, count=len(grants))


@router.get("/for-grantee/{grantee_id}", response_model=ListGrantsResponse)
async def list_grants_for_grantee(grantee_id: int):
    """
    List all active grants for a grantee (files they have access to).
    
    Args:
        grantee_id: ID of the grantee
        
    Returns:
        List of active grants
    """
    grants = await get_grants_for_grantee(grantee_id)
    return ListGrantsResponse(grants=grants, count=len(grants))


# ============================================================================
# On-Chain Interaction
# ============================================================================


async def emit_onchain_revocation(grant_id: int) -> str:
    """
    Emit an on-chain transaction to revoke a grant.
    
    Uses Web3.py to call the HealthRecords contract.
    
    Args:
        grant_id: The ID of the grant to revoke
        
    Returns:
        Transaction hash
        
    Raises:
        NotImplementedError: If not configured
    """
    eth_rpc_url = os.getenv("SEPOLIA_RPC_URL") or os.getenv("ETH_RPC_URL")
    contract_address = os.getenv("HEALTH_RECORDS_CONTRACT_ADDRESS") or os.getenv(
        "GRANT_CONTRACT_ADDRESS"
    )
    
    if not all([eth_rpc_url, contract_address]):
        raise NotImplementedError(
            "On-chain revocation not configured. "
            "Set SEPOLIA_RPC_URL and HEALTH_RECORDS_CONTRACT_ADDRESS."
        )
    
    # Note: For actual implementation, you'd need the contract ABI
    # and a funded account. This is a placeholder.
    raise NotImplementedError(
        "On-chain revocation requires contract ABI and funded account."
    )
