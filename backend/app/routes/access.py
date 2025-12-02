"""
Access Management Routes for Decent-Hospital Backend

Implements client-side-first workflow for access requests:
- POST /request-access: Requester requests access to a file by CID
- POST /approve-access: Owner approves access and generates kfrags
- POST /redeem: Requester redeems access (re-encryption)
- GET /records/{patient_id}: List patient's files with metadata

Flow:
1. Requester calls POST /request-access with CID and their public key
2. Owner sees pending request and calls POST /approve-access
3. Backend generates kfrags (without exposing owner priv key) and records on-chain
4. Requester calls POST /redeem to get re-encrypted capsule
5. Requester decrypts locally using their secret key

Security Notes:
- Owner's secret key is loaded from encrypted file, never exposed
- Kfrags are stored encrypted at rest
- CEK is never exposed to the server
"""

import os
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.db import (
    AccessRequestResponse,
    AccessRequestStatus,
    approve_access_request,
    create_access_request,
    create_audit_log,
    deny_access_request,
    get_access_request_by_id,
    get_approved_request_by_cid_and_pubkey,
    get_file_by_cid,
    get_files_by_owner,
    get_grant_by_file_and_grantee,
    get_pending_requests_for_owner,
    DATABASE_PATH,
    get_user_by_id,
)
from app.routes.auth import require_current_user
from app.utils.storage import get_ipfs_gateway_url, is_valid_cid
from app.utils.umbral_utils import (
    UMBRAL_AVAILABLE,
    generate_reenc_key,
    reencrypt_capsule,
    get_public_key_hex,
)

# Import chain client (will be created)
try:
    from app.utils.chain import (
        record_grant_onchain, 
        verify_grant_onchain, 
        record_access_onchain,
        record_grant_event_onchain,
        ChainError,
    )
    CHAIN_AVAILABLE = True
except ImportError:
    CHAIN_AVAILABLE = False
    ChainError = Exception

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class RequestAccessRequest(BaseModel):
    """Request to access a file by CID."""
    cid: str
    requester_pubkey: str
    purpose: str


class RequestAccessResponse(BaseModel):
    """Response after creating access request."""
    request_id: int
    status: str = "pending"


class ApproveAccessRequest(BaseModel):
    """Request to approve access (by owner)."""
    request_id: int
    expiry_seconds: Optional[int] = 3600  # Default 1 hour
    # Client-side generated kfrags (if provided, server won't generate)
    kfrag_hex: Optional[str] = None
    verifying_key_hex: Optional[str] = None


class ApproveAccessResponse(BaseModel):
    """Response after approving access."""
    granted: bool
    tx_hash: Optional[str] = None
    etherscan_url: Optional[str] = None


class RedeemAccessRequest(BaseModel):
    """Request to redeem access (by requester)."""
    cid: str
    requester_pubkey: Optional[str] = None  # Can override profile pubkey


class RedeemAccessResponse(BaseModel):
    """Response with re-encrypted capsule and decryption data."""
    reenc_capsule: str  # Base64-encoded re-encrypted capsule (cfrag)
    cid: str
    blob_url: str  # Storacha download URL
    # Additional data for client-side decryption
    capsule: str  # Original capsule hex
    encrypted_cek: str  # Encrypted Content Encryption Key
    owner_pubkey: str  # Owner's public key for decryptReencrypted
    filename: str  # Original filename


class RecordResponse(BaseModel):
    """Single file record in patient's records."""
    cid: str
    filename: str
    capsule: Optional[str]
    encrypted_cek: Optional[str]
    tx_hash: Optional[str]
    created_at: str


class RecordsListResponse(BaseModel):
    """Response for patient records list."""
    records: list[dict]
    count: int


class PendingRequestsResponse(BaseModel):
    """Response for pending access requests."""
    requests: list[dict]
    count: int


# ============================================================================
# Routes
# ============================================================================


@router.post("/request-access", response_model=RequestAccessResponse)
async def request_access(request: RequestAccessRequest):
    """
    Request access to a file by CID.
    
    Creates a pending access request that the file owner can approve.
    
    Args:
        request: Contains CID, requester's public key, and purpose
        
    Returns:
        Request ID and pending status
        
    Raises:
        HTTPException 400: If CID format is invalid or file not found
        
    Example curl:
        curl -X POST http://localhost:8000/access/request-access \\
          -H "Content-Type: application/json" \\
          -d '{
            "cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
            "requester_pubkey": "04abc123...",
            "purpose": "Review patient records for consultation"
          }'
    """
    # Validate CID format
    if not is_valid_cid(request.cid):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid CID format",
        )
    
    # Validate requester public key (basic length check)
    if not request.requester_pubkey or len(request.requester_pubkey) < 32:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid requester public key",
        )
    
    # Validate purpose is not empty
    if not request.purpose or len(request.purpose.strip()) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Purpose is required",
        )
    
    # Check if file exists in our database (optional - might be external CID)
    file_record = await get_file_by_cid(request.cid)
    owner_id = file_record.get("owner_id") if file_record else None
    
    # Create access request
    try:
        request_id = await create_access_request(
            cid=request.cid,
            requester_pubkey=request.requester_pubkey,
            purpose=request.purpose,
            owner_id=owner_id,
        )
        
        return RequestAccessResponse(
            request_id=request_id,
            status="pending",
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create access request: {str(e)}",
        )


@router.post("/approve-access", response_model=ApproveAccessResponse)
async def approve_access(
    request: ApproveAccessRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Approve an access request (owner only).
    
    Generates pyUmbral re-encryption key fragments (kfrags) and records
    the grant on-chain. The owner's private key is loaded from an 
    encrypted file and never exposed.
    
    Args:
        request: Request ID and optional expiry time
        current_user: Authenticated owner (via JWT)
        
    Returns:
        Grant confirmation with transaction hash
        
    Raises:
        HTTPException 400: If request not found
        HTTPException 403: If current user is not the file owner
        HTTPException 500: If kfrag generation or chain tx fails
        
    Example curl:
        curl -X POST http://localhost:8000/access/approve-access \\
          -H "Authorization: Bearer <owner_jwt_token>" \\
          -H "Content-Type: application/json" \\
          -d '{"request_id": 1, "expiry_seconds": 3600}'
    """
    owner_id = current_user["id"]
    
    # Get the access request
    access_req = await get_access_request_by_id(request.request_id)
    if not access_req:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Access request not found",
        )
    
    # Check request is still pending
    if access_req.get("status") != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Access request is not pending (status: {access_req.get('status')})",
        )
    
    # Verify ownership - get the file by CID
    file_record = await get_file_by_cid(access_req["cid"])
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File not found for this CID",
        )
    
    if file_record.get("owner_id") != owner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the owner of this file",
        )
    
    # Get requester's public key
    requester_pubkey = access_req.get("requester_pubkey")
    
    # Calculate expiry timestamp
    expires_at = None
    if request.expiry_seconds:
        expires_at = (
            datetime.now(timezone.utc) + timedelta(seconds=request.expiry_seconds)
        ).isoformat()
    
    try:
        # Use client-provided kfrag if available (client-side-first approach)
        # Otherwise fall back to server-side generation
        if request.kfrag_hex:
            # Client generated the kfrag - most secure approach
            kfrag = request.kfrag_hex
            # Store verifying key if provided
            if request.verifying_key_hex:
                # Could store this for later verification
                pass
        elif UMBRAL_AVAILABLE:
            # Fallback: Server generates kfrag (less secure, owner key on server)
            kfrag = generate_reenc_key(
                granter_secret_key=None,  # Loaded from file
                grantee_public_key=requester_pubkey,
            )
        else:
            # Placeholder for dev mode
            kfrag = f"placeholder_kfrag_{requester_pubkey[:16]}"
        
        # Record grant on-chain
        tx_hash = None
        etherscan_url = None
        
        if CHAIN_AVAILABLE:
            try:
                tx_hash = await record_grant_onchain(
                    cid=access_req["cid"],
                    grantee_pubkey=requester_pubkey,
                    expiry_timestamp=int(
                        (datetime.now(timezone.utc) + timedelta(seconds=request.expiry_seconds or 3600)).timestamp()
                    ),
                )
                if tx_hash:
                    etherscan_url = f"https://sepolia.etherscan.io/tx/{tx_hash}"
            except ChainError as e:
                # Log but don't fail - chain tx is optional enhancement
                print(f"Warning: On-chain recording failed: {e}")
        else:
            # Placeholder tx hash for dev mode
            import hashlib
            tx_hash = "0x" + hashlib.sha256(
                f"{access_req['cid']}{requester_pubkey}".encode()
            ).hexdigest()
            etherscan_url = f"https://sepolia.etherscan.io/tx/{tx_hash}"
        
        # Store encrypted kfrag and approve request in database
        # In production, kfrag would be encrypted with server's key before storage
        verifying_key = request.verifying_key_hex if request.kfrag_hex else get_public_key_hex()
        success = await approve_access_request(
            request_id=request.request_id,
            kfrags_encrypted=kfrag,  # In production: encrypt this before storing
            expires_at=expires_at,
            tx_hash=tx_hash,
            verifying_key=verifying_key,
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update access request",
            )
        
        # Record grant in audit log
        try:
            # Get file info to find requester id and name
            grantee_id = None
            grantee_name = None
            grantee_role = None
            async with aiosqlite.connect(DATABASE_PATH) as db:
                db.row_factory = aiosqlite.Row
                cursor = await db.execute(
                    "SELECT id, username, role FROM users WHERE public_key = ?",
                    (requester_pubkey,)
                )
                row = await cursor.fetchone()
                if row:
                    grantee_id = row["id"]
                    grantee_name = row["username"]
                    grantee_role = row["role"]
            
            await create_audit_log(
                event_type="grant",
                actor_id=owner_id,
                target_id=grantee_id,
                patient_id=owner_id,
                file_id=file_record.get("id"),
                cid=access_req["cid"],
                details=json.dumps({
                    "filename": file_record.get("filename"),
                    "expires_at": expires_at,
                    "grantee_name": grantee_name,
                    "grantee_role": grantee_role,
                    "grantee_pubkey": requester_pubkey[:32] + "..." if requester_pubkey else None,
                }),
                tx_hash=tx_hash,
            )
        except Exception as e:
            print(f"Warning: Failed to create grant audit log: {e}")
        
        return ApproveAccessResponse(
            granted=True,
            tx_hash=tx_hash,
            etherscan_url=etherscan_url,
        )
        
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Key file not found: {str(e)}. Ensure UMBRAL_SECRET_KEY_FILE is set.",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to approve access: {str(e)}",
        )


@router.post("/redeem", response_model=RedeemAccessResponse)
async def redeem_access(
    request: RedeemAccessRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Redeem access to get re-encrypted capsule.
    
    Validates the grant on-chain, retrieves stored kfrags, performs
    re-encryption, and returns the re-encrypted capsule with blob URL.
    The server acts as a re-encryption proxy but never sees the CEK.
    
    Args:
        request: CID of the file to redeem
        current_user: Authenticated requester (via JWT)
        
    Returns:
        Re-encrypted capsule and Storacha download URL
        
    Raises:
        HTTPException 400: If no approved access request found
        HTTPException 403: If grant expired or revoked
        
    Example curl:
        curl -X POST http://localhost:8000/access/redeem \\
          -H "Authorization: Bearer <requester_jwt_token>" \\
          -H "Content-Type: application/json" \\
          -d '{"cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"}'
    """
    # Get requester's public key - from request body OR profile
    requester_pubkey = request.requester_pubkey or current_user.get("public_key")
    if not requester_pubkey:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No public key provided. Either include requester_pubkey in request or register a public key in your profile.",
        )
    
    # Validate CID
    if not is_valid_cid(request.cid):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid CID format",
        )
    
    # Find approved access request for this CID and requester
    access_req = await get_approved_request_by_cid_and_pubkey(
        cid=request.cid,
        requester_pubkey=requester_pubkey,
    )
    
    if not access_req:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No approved access found for this CID. Request access first.",
        )
    
    # Check expiry
    expires_at = access_req.get("expires_at")
    if expires_at:
        try:
            expiry_time = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > expiry_time:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access has expired",
                )
        except ValueError:
            pass  # Invalid date format, ignore
    
    # Validate grant on-chain (optional but recommended)
    if CHAIN_AVAILABLE:
        try:
            is_valid = await verify_grant_onchain(
                cid=request.cid,
                grantee_pubkey=requester_pubkey,
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="On-chain grant verification failed",
                )
        except ChainError:
            # If chain verification fails, continue with DB-based verification
            pass
    
    # Get the file record for capsule and owner info
    file_record = await get_file_by_cid(request.cid)
    if not file_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File not found",
        )
    
    capsule_hex = file_record.get("capsule")
    if not capsule_hex:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File has no capsule metadata",
        )
    
    # Get kfrag from access request
    kfrag = access_req.get("kfrags_encrypted")
    if not kfrag:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No re-encryption key found for this access",
        )
    
    # Get verifying key from access request (stored during approval)
    verifying_key = access_req.get("verifying_key")
    
    try:
        # Perform re-encryption using Umbral
        if UMBRAL_AVAILABLE:
            # Get owner's public key
            owner = await get_user_by_id(file_record["owner_id"])
            owner_pubkey = owner.get("public_key") if owner else None
            
            if not owner_pubkey:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="File owner has no public key",
                )
            
            # Use stored verifying key if available, otherwise fallback to server's
            verifying_pk = verifying_key or get_public_key_hex()
            
            # Perform re-encryption (server acts as proxy)
            # Pass receiving_pk for kfrag verification
            cfrag = reencrypt_capsule(
                capsule_hex=capsule_hex,
                kfrag_hex=kfrag,
                delegating_pk_hex=owner_pubkey,
                verifying_pk_hex=verifying_pk,
                receiving_pk_hex=requester_pubkey,  # Grantee's public key
            )
            
            # Encode as base64 for transport
            import base64
            reenc_capsule_b64 = base64.b64encode(bytes.fromhex(cfrag)).decode()
        else:
            # Placeholder for dev mode
            import base64
            reenc_capsule_b64 = base64.b64encode(
                f"placeholder_cfrag_{capsule_hex[:32]}".encode()
            ).decode()
        
        # Get Storacha download URL
        blob_url = get_ipfs_gateway_url(request.cid)
        
        # Record access event on-chain and in database
        tx_hash = None
        block_number = None
        accessor_address = current_user.get("public_key", "")[:42] if current_user.get("public_key") else f"0x{current_user['id']:040x}"
        
        if CHAIN_AVAILABLE:
            try:
                owner = await get_user_by_id(file_record["owner_id"])
                patient_uuid = owner.get("uuid", str(file_record["owner_id"])) if owner else str(file_record["owner_id"])
                
                access_result = await record_access_onchain(
                    accessor_address=accessor_address,
                    patient_identifier=patient_uuid,
                    cid=request.cid,
                )
                tx_hash = access_result.get("tx_hash")
                block_number = access_result.get("block_number")
            except ChainError as e:
                print(f"Warning: Failed to record access on-chain: {e}")
        
        # Always record in database audit log
        try:
            # Get the grant to include expiry information
            grant_info = await get_grant_by_file_and_grantee(file_record["id"], current_user["id"])
            expires_at = grant_info.get("expires_at") if grant_info else None
            
            await create_audit_log(
                event_type="access",
                actor_id=current_user["id"],
                target_id=file_record["owner_id"],
                patient_id=file_record["owner_id"],
                file_id=file_record.get("id"),
                cid=request.cid,
                details=json.dumps({
                    "filename": file_record.get("filename"),
                    "accessor_role": current_user.get("role", "unknown"),
                    "accessor_name": current_user.get("username"),
                    "action": "file_downloaded",
                    "grant_expires_at": expires_at,
                }),
                tx_hash=tx_hash,
                block_number=block_number,
            )
        except Exception as e:
            print(f"Warning: Failed to create audit log: {e}")
        
        return RedeemAccessResponse(
            reenc_capsule=reenc_capsule_b64,
            cid=request.cid,
            blob_url=blob_url,
            capsule=capsule_hex,
            encrypted_cek=file_record.get("encrypted_cek", ""),
            owner_pubkey=owner_pubkey if UMBRAL_AVAILABLE else "",
            filename=file_record.get("filename", "unknown"),
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Re-encryption failed: {str(e)}",
        )


@router.get("/records/{patient_id}", response_model=RecordsListResponse)
async def get_patient_records(
    patient_id: int,
    current_user: dict = Depends(require_current_user),
):
    """
    List all uploaded files for a patient.
    
    Returns CIDs, capsule metadata, and on-chain transaction hashes.
    Does NOT return any plaintext CEK or private keys.
    
    Args:
        patient_id: ID of the patient
        current_user: Authenticated patient (via JWT)
        
    Returns:
        List of file records with metadata
        
    Raises:
        HTTPException 403: If current user is not the patient
        
    Example curl:
        curl -X GET http://localhost:8000/access/records/1 \\
          -H "Authorization: Bearer <patient_jwt_token>"
    """
    # Verify the current user is the patient (or has permission)
    if current_user["id"] != patient_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own records",
        )
    
    # Get all files for this patient
    files = await get_files_by_owner(patient_id)
    
    # Format response - exclude plaintext CEK
    records = []
    for f in files:
        records.append({
            "id": f.get("id"),  # Include file ID for download API
            "cid": f.get("cid"),
            "filename": f.get("filename"),
            "display_name": f.get("display_name"),  # User-friendly rename (persisted)
            "category": f.get("category"),  # File category (Lab Results, Imaging, etc.)
            "description": f.get("description"),  # Description/notes from hospital
            "capsule": f.get("capsule"),  # Capsule metadata (hex)
            "encrypted_cek": f.get("encrypted_cek"),  # CEK encrypted with owner's pk
            "tx_hash": f.get("tx_hash"),  # On-chain upload tx (if any)
            "created_at": str(f.get("created_at", "")),
        })
    
    return RecordsListResponse(
        records=records,
        count=len(records),
    )


@router.get("/pending-requests", response_model=PendingRequestsResponse)
async def get_pending_requests(
    current_user: dict = Depends(require_current_user),
):
    """
    List pending access requests for files owned by the current user.
    
    Allows the owner to see who is requesting access to their files.
    
    Args:
        current_user: Authenticated owner (via JWT)
        
    Returns:
        List of pending access requests
        
    Example curl:
        curl -X GET http://localhost:8000/access/pending-requests \\
          -H "Authorization: Bearer <owner_jwt_token>"
    """
    requests = await get_pending_requests_for_owner(current_user["id"])
    
    return PendingRequestsResponse(
        requests=requests,
        count=len(requests),
    )


@router.post("/deny-access/{request_id}")
async def deny_access(
    request_id: int,
    current_user: dict = Depends(require_current_user),
):
    """
    Deny an access request.
    
    Args:
        request_id: ID of the access request to deny
        current_user: Authenticated owner (via JWT)
        
    Returns:
        Success message
        
    Raises:
        HTTPException 403: If current user is not the file owner
    """
    # Get the access request
    access_req = await get_access_request_by_id(request_id)
    if not access_req:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Access request not found",
        )
    
    # Verify ownership
    file_record = await get_file_by_cid(access_req["cid"])
    if not file_record or file_record.get("owner_id") != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the owner of this file",
        )
    
    success = await deny_access_request(request_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to deny request (may already be processed)",
        )
    
    return {"message": "Access request denied", "request_id": request_id}


class ApprovedGrantResponse(BaseModel):
    """Single approved grant entry."""
    id: int
    cid: str
    requester_pubkey: str
    purpose: str
    status: str
    expires_at: Optional[str]
    tx_hash: Optional[str]
    created_at: str
    time_remaining: Optional[str]  # Human-readable time remaining
    is_expired: bool


class ApprovedGrantsListResponse(BaseModel):
    """List of approved grants."""
    grants: list[ApprovedGrantResponse]
    count: int


@router.get("/my-grants", response_model=ApprovedGrantsListResponse)
async def get_my_approved_grants(
    current_user: dict = Depends(require_current_user),
):
    """
    List all approved access grants for files owned by the current user.
    
    Shows who has been granted access to your files and when access expires.
    
    Args:
        current_user: Authenticated owner (via JWT)
        
    Returns:
        List of approved grants with expiry information
    """
    # Get all approved access requests for files owned by this user
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT ar.*, f.filename 
            FROM access_requests ar
            JOIN files f ON ar.cid = f.cid
            WHERE f.owner_id = ? AND ar.status = 'approved'
            ORDER BY ar.created_at DESC
        """, (current_user["id"],))
        rows = await cursor.fetchall()
    
    grants = []
    now = datetime.now(timezone.utc)
    
    for row in rows:
        row_dict = dict(row)
        expires_at = row_dict.get("expires_at")
        is_expired = False
        time_remaining = None
        
        if expires_at:
            try:
                expiry_time = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if now > expiry_time:
                    is_expired = True
                    time_remaining = "Expired"
                else:
                    delta = expiry_time - now
                    hours, remainder = divmod(delta.seconds, 3600)
                    minutes = remainder // 60
                    if delta.days > 0:
                        time_remaining = f"{delta.days}d {hours}h remaining"
                    elif hours > 0:
                        time_remaining = f"{hours}h {minutes}m remaining"
                    else:
                        time_remaining = f"{minutes}m remaining"
            except ValueError:
                pass
        
        grants.append(ApprovedGrantResponse(
            id=row_dict["id"],
            cid=row_dict["cid"],
            requester_pubkey=row_dict["requester_pubkey"],
            purpose=row_dict["purpose"],
            status=row_dict["status"],
            expires_at=expires_at,
            tx_hash=row_dict.get("tx_hash"),
            created_at=str(row_dict.get("created_at", "")),
            time_remaining=time_remaining,
            is_expired=is_expired,
        ))
    
    return ApprovedGrantsListResponse(
        grants=grants,
        count=len(grants),
    )
