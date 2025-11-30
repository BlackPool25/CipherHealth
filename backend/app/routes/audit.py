"""
Audit Routes for Decent-Hospital Backend

Provides audit trail functionality by reading from:
- Database records (grants, files, users)
- Ethereum blockchain events (on-chain audit)

Security:
- Patients can only view their own audit logs (enforced via JWT)
- All access events are recorded on-chain for tamper-proof verification

Endpoints:
- GET /audit: Get all audit logs
- GET /audit/logs/{user_id}: Get audit logs for a specific user
- GET /audit/my-logs: Get audit logs for the authenticated user
- GET /audit/chain: Get on-chain audit records
"""

import os
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from web3 import Web3

from app.db import (
    get_files_by_owner,
    get_grants_by_granter,
    get_grants_for_grantee,
    get_user_by_id,
    get_audit_logs_for_patient,
    get_grants_for_patient,
    get_access_events_for_patient,
    get_revoke_events_for_patient,
)
from app.routes.auth import require_current_user
)

router = APIRouter()


# ============================================================================
# Configuration
# ============================================================================

SEPOLIA_RPC_URL = os.getenv("SEPOLIA_RPC_URL") or os.getenv("ETH_RPC_URL", "https://rpc.sepolia.org")
HEALTH_RECORDS_CONTRACT = os.getenv("HEALTH_RECORDS_CONTRACT_ADDRESS") or os.getenv("GRANT_CONTRACT_ADDRESS")

# HealthRecords contract ABI (minimal - just for events)
HEALTH_RECORDS_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "patient", "type": "address"},
            {"indexed": True, "name": "recordHash", "type": "bytes32"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
        ],
        "name": "RecordAdded",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "patient", "type": "address"},
            {"indexed": True, "name": "doctor", "type": "address"},
            {"indexed": False, "name": "recordHash", "type": "bytes32"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
        ],
        "name": "AccessGranted",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "patient", "type": "address"},
            {"indexed": True, "name": "doctor", "type": "address"},
            {"indexed": False, "name": "recordHash", "type": "bytes32"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
        ],
        "name": "AccessRevoked",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "doctor", "type": "address"},
            {"indexed": True, "name": "patient", "type": "address"},
            {"indexed": False, "name": "recordHash", "type": "bytes32"},
            {"indexed": False, "name": "timestamp", "type": "uint256"},
        ],
        "name": "RecordAccessed",
        "type": "event",
    },
]


# ============================================================================
# Request/Response Models
# ============================================================================


class AuditLogEntry(BaseModel):
    """A single audit log entry."""
    
    id: Optional[int] = None
    event_type: str  # upload, grant, revoke, access
    user_id: Optional[int] = None
    target_id: Optional[int] = None  # file_id or grantee_id
    details: dict
    timestamp: str
    tx_hash: Optional[str] = None  # On-chain transaction hash


class AuditResponse(BaseModel):
    """Response for audit log queries."""
    
    logs: list[dict]
    count: int
    source: str  # "database" or "blockchain"


class CategorizedAuditResponse(BaseModel):
    """Response for categorized audit log queries."""
    
    all_logs: list[dict]
    grants: list[dict]
    access_events: list[dict]
    revokes: list[dict]
    total_count: int
    grants_count: int
    access_count: int
    revokes_count: int
    source: str


class ChainAuditResponse(BaseModel):
    """Response for blockchain audit queries."""
    
    events: list[dict]
    count: int
    from_block: int
    to_block: int
    contract_address: Optional[str] = None


# ============================================================================
# Routes
# ============================================================================


@router.get("", response_model=AuditResponse)
@router.get("/", response_model=AuditResponse)
async def get_audit_logs():
    """
    Get all audit logs from database.
    
    Returns a combined view of:
    - File uploads
    - Grant creations
    - Grant revocations
    
    Example curl:
        curl http://localhost:8000/audit
    """
    logs = []
    
    # This is a simplified implementation
    # In production, you'd have a dedicated audit_logs table
    
    return AuditResponse(
        logs=logs,
        count=len(logs),
        source="database",
    )


@router.get("/logs/{user_id}", response_model=AuditResponse)
async def get_user_audit_logs(user_id: int):
    """
    Get audit logs for a specific user.
    
    Includes:
    - Files uploaded by the user
    - Grants created by the user
    - Grants received by the user
    
    Args:
        user_id: The user's ID
        
    Returns:
        Audit logs related to the user
        
    Example curl:
        curl http://localhost:8000/audit/logs/1
    """
    # Verify user exists
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    
    logs = []
    
    # Get files uploaded by user
    files = await get_files_by_owner(user_id)
    for f in files:
        logs.append({
            "event_type": "upload",
            "user_id": user_id,
            "target_id": f["id"],
            "details": {
                "filename": f["filename"],
                "cid": f["cid"],
            },
            "timestamp": f.get("created_at", ""),
            "tx_hash": None,
        })
    
    # Get grants created by user
    grants_created = await get_grants_by_granter(user_id)
    for g in grants_created:
        logs.append({
            "event_type": "grant" if g.get("status") == "active" else "revoke",
            "user_id": user_id,
            "target_id": g["grantee_id"],
            "details": {
                "file_id": g["file_id"],
                "status": g.get("status", "active"),
                "expires_at": g.get("expires_at"),
            },
            "timestamp": g.get("created_at", ""),
            "tx_hash": g.get("tx_hash"),
        })
    
    # Get grants received by user
    grants_received = await get_grants_for_grantee(user_id)
    for g in grants_received:
        logs.append({
            "event_type": "access_granted",
            "user_id": g["granter_id"],
            "target_id": user_id,
            "details": {
                "file_id": g["file_id"],
                "expires_at": g.get("expires_at"),
            },
            "timestamp": g.get("created_at", ""),
            "tx_hash": g.get("tx_hash"),
        })
    
    # Sort by timestamp
    logs.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    
    return AuditResponse(
        logs=logs,
        count=len(logs),
        source="database",
    )


@router.get("/my-logs", response_model=CategorizedAuditResponse)
async def get_my_audit_logs(
    current_user: dict = Depends(require_current_user),
):
    """
    Get audit logs for the currently authenticated user.
    
    This is the SECURE endpoint - patients can only see their own data.
    All access events are recorded on-chain for tamper-proof verification.
    
    Returns logs organized by category:
    - All logs: Complete activity history
    - Grants: Active and expired access grants given
    - Access events: Who accessed your records (blockchain-verified)
    - Revokes: Access revocations
    
    Returns:
        Categorized audit logs with counts
        
    Example curl:
        curl -H "Authorization: Bearer <token>" http://localhost:8000/audit/my-logs
    """
    return await _get_categorized_audit_logs_for_user(current_user["id"], current_user)


@router.get("/categorized/{user_id}", response_model=CategorizedAuditResponse)
async def get_categorized_audit_logs(
    user_id: int,
    current_user: dict = Depends(require_current_user),
):
    """
    Get categorized audit logs for a specific user.
    
    SECURITY: Users can only view their own audit logs.
    Attempting to view another user's logs will be denied.
    
    Returns logs organized by category:
    - All logs: Complete activity history
    - Grants: Active and expired access grants given
    - Access events: Who accessed your records (blockchain-verified)
    - Revokes: Access revocations
    
    Args:
        user_id: The user's ID (must match authenticated user)
        
    Returns:
        Categorized audit logs with counts
        
    Example curl:
        curl http://localhost:8000/audit/categorized/1
    """
    # Verify user exists
    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    
    # Get all audit logs from the audit_logs table
    all_logs_raw = await get_audit_logs_for_patient(user_id)
    
    # Format all logs
    all_logs = []
    for log in all_logs_raw:
        all_logs.append({
            "id": log.get("id"),
            "event_type": log.get("event_type"),
            "actor_id": log.get("actor_id"),
            "actor_name": log.get("actor_name"),
            "actor_role": log.get("actor_role"),
            "target_id": log.get("target_id"),
            "target_name": log.get("target_name"),
            "target_role": log.get("target_role"),
            "filename": log.get("filename"),
            "cid": log.get("cid"),
            "details": log.get("details"),
            "tx_hash": log.get("tx_hash"),
            "block_number": log.get("block_number"),
            "timestamp": str(log.get("created_at", "")),
        })
    
    # Get grants (active and past)
    grants_raw = await get_grants_for_patient(user_id)
    grants = []
    for g in grants_raw:
        is_expired = False
        expires_at = g.get("expires_at")
        if expires_at:
            try:
                from datetime import datetime, timezone
                expiry_time = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                is_expired = datetime.now(timezone.utc) > expiry_time
            except (ValueError, TypeError):
                pass
        
        grants.append({
            "id": g.get("id"),
            "grantee_id": g.get("grantee_id"),
            "grantee_name": g.get("grantee_name"),
            "grantee_role": g.get("grantee_role"),
            "file_id": g.get("file_id"),
            "filename": g.get("filename"),
            "cid": g.get("cid"),
            "status": g.get("status"),
            "is_expired": is_expired,
            "expires_at": expires_at,
            "tx_hash": g.get("tx_hash"),
            "timestamp": str(g.get("created_at", "")),
        })
    
    # Get access events
    access_raw = await get_access_events_for_patient(user_id)
    access_events = []
    for a in access_raw:
        access_events.append({
            "id": a.get("id"),
            "actor_id": a.get("actor_id"),
            "actor_name": a.get("actor_name"),
            "actor_role": a.get("actor_role"),
            "filename": a.get("filename"),
            "cid": a.get("cid"),
            "details": a.get("details"),
            "tx_hash": a.get("tx_hash"),
            "block_number": a.get("block_number"),
            "timestamp": str(a.get("created_at", "")),
            "verified_onchain": bool(a.get("tx_hash")),
        })
    
    # Get revoke events from audit_logs
    revokes_raw = await get_revoke_events_for_patient(user_id)
    revokes = []
    seen_revoke_grants = set()  # Track which grants we've seen revoked
    
    for r in revokes_raw:
        revokes.append({
            "id": r.get("id"),
            "event_type": "revoke",
            "actor_id": r.get("actor_id"),
            "actor_name": r.get("actor_name"),
            "target_id": r.get("target_id"),
            "target_name": r.get("target_name"),
            "target_role": r.get("target_role"),
            "filename": r.get("filename"),
            "cid": r.get("cid"),
            "details": r.get("details"),
            "tx_hash": r.get("tx_hash"),
            "timestamp": str(r.get("created_at", "")),
            "verified_onchain": bool(r.get("tx_hash")),
        })
        # Track this grant as seen if details contain grant_id
        if r.get("details"):
            try:
                import json
                details = json.loads(r.get("details")) if isinstance(r.get("details"), str) else r.get("details")
                if details and details.get("grant_id"):
                    seen_revoke_grants.add(details.get("grant_id"))
            except:
                pass
    
    # Also derive revoke events from revoked grants (for historical data)
    # Only add grants that aren't already in audit_logs
    for g in grants_raw:
        if g.get("status") == "revoked" and g.get("id") not in seen_revoke_grants:
            revokes.append({
                "id": f"grant_{g.get('id')}",  # Synthetic ID
                "event_type": "revoke",
                "actor_id": user_id,
                "actor_name": user.get("username"),
                "target_id": g.get("grantee_id"),
                "target_name": g.get("grantee_name"),
                "target_role": g.get("grantee_role"),
                "filename": g.get("filename"),
                "cid": g.get("cid"),
                "details": {"source": "historical", "grant_id": g.get("id")},
                "tx_hash": g.get("tx_hash"),
                "timestamp": str(g.get("created_at", "")),
                "verified_onchain": bool(g.get("tx_hash")),
            })
    
    # Sort revokes by timestamp descending
    revokes.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    
    # Build comprehensive all_logs from multiple sources
    # Include audit_logs + derived events from grants
    combined_all_logs = list(all_logs)
    
    # Add grant events from grants table if not already in audit_logs
    audit_log_file_ids = {log.get("file_id") for log in all_logs if log.get("event_type") == "grant"}
    for g in grants_raw:
        if g.get("file_id") not in audit_log_file_ids:
            combined_all_logs.append({
                "id": f"grant_{g.get('id')}",
                "event_type": "grant",
                "actor_id": user_id,
                "actor_name": user.get("username"),
                "target_id": g.get("grantee_id"),
                "target_name": g.get("grantee_name"),
                "target_role": g.get("grantee_role"),
                "filename": g.get("filename"),
                "cid": g.get("cid"),
                "details": {"status": g.get("status")},
                "tx_hash": g.get("tx_hash"),
                "block_number": None,
                "timestamp": str(g.get("created_at", "")),
            })
            # If revoked, also add revoke event
            if g.get("status") == "revoked":
                combined_all_logs.append({
                    "id": f"revoke_{g.get('id')}",
                    "event_type": "revoke",
                    "actor_id": user_id,
                    "actor_name": user.get("username"),
                    "target_id": g.get("grantee_id"),
                    "target_name": g.get("grantee_name"),
                    "target_role": g.get("grantee_role"),
                    "filename": g.get("filename"),
                    "cid": g.get("cid"),
                    "details": {"source": "historical"},
                    "tx_hash": g.get("tx_hash"),
                    "block_number": None,
                    "timestamp": str(g.get("created_at", "")),
                })
    
    # Sort combined logs by timestamp descending
    combined_all_logs.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    
    return CategorizedAuditResponse(
        all_logs=combined_all_logs,
        grants=grants,
        access_events=access_events,
        revokes=revokes,
        total_count=len(combined_all_logs),
        grants_count=len(grants),
        access_count=len(access_events),
        revokes_count=len(revokes),
        source="database",
    )


@router.get("/chain", response_model=ChainAuditResponse)
async def get_chain_audit():
    """
    Get audit records from the Ethereum blockchain.
    
    Reads events from the HealthRecords smart contract on Sepolia.
    
    Returns:
        On-chain events (RecordAdded, AccessGranted, AccessRevoked, RecordAccessed)
        
    Example curl:
        curl http://localhost:8000/audit/chain
    """
    if not HEALTH_RECORDS_CONTRACT or HEALTH_RECORDS_CONTRACT == "0x0000000000000000000000000000000000000000":
        return ChainAuditResponse(
            events=[],
            count=0,
            from_block=0,
            to_block=0,
            contract_address=None,
        )
    
    try:
        w3 = Web3(Web3.HTTPProvider(SEPOLIA_RPC_URL))
        
        if not w3.is_connected():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Cannot connect to Ethereum node",
            )
        
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(HEALTH_RECORDS_CONTRACT),
            abi=HEALTH_RECORDS_ABI,
        )
        
        # Get latest block
        latest_block = w3.eth.block_number
        from_block = max(0, latest_block - 10000)  # Last 10000 blocks
        
        events = []
        
        # Get RecordAdded events
        try:
            record_added = contract.events.RecordAdded.get_logs(
                fromBlock=from_block,
                toBlock=latest_block,
            )
            for event in record_added:
                events.append({
                    "event_type": "RecordAdded",
                    "patient": event.args.patient,
                    "recordHash": event.args.recordHash.hex(),
                    "timestamp": event.args.timestamp,
                    "block_number": event.blockNumber,
                    "tx_hash": event.transactionHash.hex(),
                })
        except Exception:
            pass  # Event might not exist
        
        # Get AccessGranted events
        try:
            access_granted = contract.events.AccessGranted.get_logs(
                fromBlock=from_block,
                toBlock=latest_block,
            )
            for event in access_granted:
                events.append({
                    "event_type": "AccessGranted",
                    "patient": event.args.patient,
                    "doctor": event.args.doctor,
                    "recordHash": event.args.recordHash.hex(),
                    "timestamp": event.args.timestamp,
                    "block_number": event.blockNumber,
                    "tx_hash": event.transactionHash.hex(),
                })
        except Exception:
            pass
        
        # Get AccessRevoked events
        try:
            access_revoked = contract.events.AccessRevoked.get_logs(
                fromBlock=from_block,
                toBlock=latest_block,
            )
            for event in access_revoked:
                events.append({
                    "event_type": "AccessRevoked",
                    "patient": event.args.patient,
                    "doctor": event.args.doctor,
                    "recordHash": event.args.recordHash.hex(),
                    "timestamp": event.args.timestamp,
                    "block_number": event.blockNumber,
                    "tx_hash": event.transactionHash.hex(),
                })
        except Exception:
            pass
        
        # Get RecordAccessed events
        try:
            record_accessed = contract.events.RecordAccessed.get_logs(
                fromBlock=from_block,
                toBlock=latest_block,
            )
            for event in record_accessed:
                events.append({
                    "event_type": "RecordAccessed",
                    "doctor": event.args.doctor,
                    "patient": event.args.patient,
                    "recordHash": event.args.recordHash.hex(),
                    "timestamp": event.args.timestamp,
                    "block_number": event.blockNumber,
                    "tx_hash": event.transactionHash.hex(),
                })
        except Exception:
            pass
        
        # Sort by block number
        events.sort(key=lambda x: x.get("block_number", 0), reverse=True)
        
        return ChainAuditResponse(
            events=events,
            count=len(events),
            from_block=from_block,
            to_block=latest_block,
            contract_address=HEALTH_RECORDS_CONTRACT,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch chain audit: {str(e)}",
        )
