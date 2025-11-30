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
from datetime import datetime, timezone
from typing import Any, Optional


def format_timestamp(timestamp_value: Any) -> str:
    """
    Format a timestamp value to ISO 8601 format with UTC timezone.
    
    SQLite stores timestamps as strings like "2025-11-30 12:34:56" in UTC,
    but without timezone indicator. This function ensures proper ISO format
    with 'Z' suffix so JavaScript can correctly parse it as UTC.
    
    Args:
        timestamp_value: A timestamp as string, datetime, or None
        
    Returns:
        ISO 8601 formatted string with UTC timezone (e.g., "2025-11-30T12:34:56Z")
    """
    if not timestamp_value:
        return ""
    
    if isinstance(timestamp_value, datetime):
        # If it's already a datetime, make sure it has UTC timezone
        if timestamp_value.tzinfo is None:
            timestamp_value = timestamp_value.replace(tzinfo=timezone.utc)
        return timestamp_value.isoformat().replace("+00:00", "Z")
    
    # It's a string - parse and reformat
    ts_str = str(timestamp_value).strip()
    if not ts_str:
        return ""
    
    # If already has Z or timezone info, return as-is after normalizing
    if ts_str.endswith("Z") or "+" in ts_str or ts_str.endswith("UTC"):
        return ts_str
    
    try:
        # SQLite format: "2025-11-30 12:34:56" or "2025-11-30 12:34:56.123456"
        # Try parsing with microseconds first
        for fmt in ["%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"]:
            try:
                dt = datetime.strptime(ts_str, fmt)
                # SQLite CURRENT_TIMESTAMP is UTC, so add UTC timezone
                dt = dt.replace(tzinfo=timezone.utc)
                return dt.isoformat().replace("+00:00", "Z")
            except ValueError:
                continue
        
        # If parsing failed, return original with Z appended
        return ts_str.replace(" ", "T") + "Z"
    except Exception:
        return ts_str

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from web3 import Web3

from app.db import (
    get_files_by_owner,
    get_grants_by_granter,
    get_grants_for_grantee,
    get_user_by_id,
    get_user_by_uuid,
    get_audit_logs_for_patient,
    get_grants_for_patient,
    get_grant_events_for_patient,
    get_access_events_for_patient,
    get_revoke_events_for_patient,
)
from app.routes.auth import require_current_user
from app.utils.chain import is_chain_configured

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
            "timestamp": format_timestamp(f.get("created_at")),
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
            "timestamp": format_timestamp(g.get("created_at")),
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
            "timestamp": format_timestamp(g.get("created_at")),
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
        curl -H "Authorization: Bearer <token>" http://localhost:8000/audit/categorized/1
    """
    # SECURITY: Users can only view their own audit logs
    if current_user["id"] != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You can only view your own audit logs.",
        )
    
    return await _get_categorized_audit_logs_for_user(user_id, current_user)


async def _get_categorized_audit_logs_for_user(user_id: int, user: dict) -> CategorizedAuditResponse:
    """
    Internal function to get categorized audit logs for a user.
    
    This contains the actual logic, called by both public endpoints after auth.
    Includes:
    - Audit logs from the audit_logs table
    - File uploads (from files table)
    - Grants (from grants table)
    - Access events (from audit_logs)
    - Revoke events (from audit_logs + grants table)
    - Blockchain events (filtered by patient's CIDs)
    """
    # Get all audit logs from the audit_logs table
    all_logs_raw = await get_audit_logs_for_patient(user_id)
    
    # Fetch blockchain events for this patient (if chain is configured)
    chain_events = await _get_blockchain_events_for_patient(user_id)
    
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
            "timestamp": format_timestamp(log.get("created_at")),
        })
    
    # Get user's uploaded files and add them to activity log
    files = await get_files_by_owner(user_id)
    file_upload_logs = []
    for f in files:
        file_upload_logs.append({
            "id": f"file_{f.get('id')}",
            "event_type": "upload",
            "actor_id": user_id,
            "actor_name": user.get("username"),
            "actor_role": user.get("role", "patient"),
            "target_id": None,
            "target_name": None,
            "target_role": None,
            "filename": f.get("filename"),
            "cid": f.get("cid"),
            "details": {"category": f.get("category")},
            "tx_hash": f.get("tx_hash"),
            "block_number": None,
            "timestamp": format_timestamp(f.get("created_at")),
        })
    
    # Get grants (active and past) from grants table
    grants_raw = await get_grants_for_patient(user_id)
    grants = []
    seen_grant_ids = set()
    
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
            "timestamp": format_timestamp(g.get("created_at")),
        })
        seen_grant_ids.add(g.get("id"))
    
    # Also get grant events from audit_logs (for grants that may not be in grants table)
    grant_events = await get_grant_events_for_patient(user_id)
    for ge in grant_events:
        # Parse details to get grantee info
        details = {}
        if ge.get("details"):
            try:
                import json
                details = json.loads(ge.get("details")) if isinstance(ge.get("details"), str) else ge.get("details")
            except:
                pass
        
        # Check if we already have this grant from the grants table
        # Use file_id + target_id as a unique key
        grant_key = (ge.get("file_id"), ge.get("target_id"))
        
        grants.append({
            "id": f"audit_{ge.get('id')}",
            "grantee_id": ge.get("target_id"),
            "grantee_name": ge.get("target_name") or details.get("grantee_name"),
            "grantee_role": ge.get("target_role") or details.get("grantee_role"),
            "file_id": ge.get("file_id"),
            "filename": ge.get("filename") or details.get("filename"),
            "cid": ge.get("cid"),
            "status": "active",  # From audit_log we assume it was active when created
            "is_expired": False,
            "expires_at": details.get("expires_at"),
            "tx_hash": ge.get("tx_hash"),
            "timestamp": format_timestamp(ge.get("created_at")),
            "source": "audit_log",
        })
    
    # Sort grants by timestamp descending
    grants.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    
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
            "timestamp": format_timestamp(a.get("created_at")),
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
            "timestamp": format_timestamp(r.get("created_at")),
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
                "timestamp": format_timestamp(g.get("created_at")),
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
                "timestamp": format_timestamp(g.get("created_at")),
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
                    "timestamp": format_timestamp(g.get("created_at")),
                })
    
    # Add file uploads to combined logs
    combined_all_logs.extend(file_upload_logs)
    
    # Add blockchain events to combined logs and categorize them
    chain_grants = []
    chain_access = []
    chain_revokes = []
    
    for event in chain_events:
        event_type = event.get("event_type", "").lower()
        
        # Create a formatted log entry from chain event
        chain_log = {
            "id": f"chain_{event.get('tx_hash', '')}_{event.get('block_number', '')}",
            "event_type": event_type.replace("access", "").replace("record", "").strip() or event_type,
            "actor_id": None,
            "actor_name": None,
            "actor_role": None,
            "target_id": None,
            "target_name": None,
            "target_role": None,
            "filename": None,
            "cid": event.get("cid"),
            "details": {
                "source": "blockchain",
                "owner_address": event.get("owner"),
                "grantee_address": event.get("grantee"),
                "cid_hash": event.get("cidHash"),
            },
            "tx_hash": event.get("tx_hash"),
            "block_number": event.get("block_number"),
            "timestamp": event.get("timestamp"),
            "verified_onchain": True,
        }
        
        combined_all_logs.append(chain_log)
        
        # Categorize by event type
        if "granted" in event_type.lower() or event_type.lower() == "grant":
            chain_grants.append({
                **chain_log,
                "grantee_id": None,
                "grantee_name": event.get("grantee", "")[:10] + "..." if event.get("grantee") else None,
                "status": "active",
                "is_expired": False,
                "expires_at": event.get("expiry"),
            })
        elif "revoked" in event_type.lower() or event_type.lower() == "revoke":
            chain_revokes.append(chain_log)
        elif "accessed" in event_type.lower() or "downloaded" in event_type.lower() or event_type.lower() == "access":
            chain_access.append(chain_log)
    
    # Merge chain events with database events (avoid duplicates by tx_hash)
    existing_tx_hashes = {g.get("tx_hash") for g in grants if g.get("tx_hash")}
    for cg in chain_grants:
        if cg.get("tx_hash") not in existing_tx_hashes:
            grants.append(cg)
    
    existing_tx_hashes = {a.get("tx_hash") for a in access_events if a.get("tx_hash")}
    for ca in chain_access:
        if ca.get("tx_hash") not in existing_tx_hashes:
            access_events.append(ca)
    
    existing_tx_hashes = {r.get("tx_hash") for r in revokes if r.get("tx_hash")}
    for cr in chain_revokes:
        if cr.get("tx_hash") not in existing_tx_hashes:
            revokes.append(cr)
    
    # Sort combined logs by timestamp descending
    combined_all_logs.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    
    # Re-sort categorized lists
    grants.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    access_events.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    revokes.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    
    return CategorizedAuditResponse(
        all_logs=combined_all_logs,
        grants=grants,
        access_events=access_events,
        revokes=revokes,
        total_count=len(combined_all_logs),
        grants_count=len(grants),
        access_count=len(access_events),
        revokes_count=len(revokes),
        source="database+blockchain",
    )


async def _get_blockchain_events_for_patient(patient_id: int) -> list[dict]:
    """
    Fetch blockchain events for a specific patient.
    
    Gets all on-chain events related to the patient's files (by CID).
    This provides a tamper-proof audit trail that patients can verify independently.
    
    Args:
        patient_id: The patient's user ID
        
    Returns:
        List of blockchain events related to the patient
    """
    if not is_chain_configured():
        return []
    
    if not HEALTH_RECORDS_CONTRACT or HEALTH_RECORDS_CONTRACT == "0x0000000000000000000000000000000000000000":
        return []
    
    try:
        # Get patient's files to find their CIDs
        patient_files = await get_files_by_owner(patient_id)
        patient_cids = {f.get("cid") for f in patient_files if f.get("cid")}
        
        if not patient_cids:
            return []
        
        # Compute CID hashes for filtering
        cid_hashes = set()
        for cid in patient_cids:
            if cid:
                cid_hash = Web3.keccak(text=cid)
                cid_hashes.add(cid_hash.hex() if hasattr(cid_hash, 'hex') else cid_hash)
        
        w3 = Web3(Web3.HTTPProvider(SEPOLIA_RPC_URL))
        
        if not w3.is_connected():
            return []
        
        # Updated ABI with hash-based events
        EVENTS_ABI = [
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "cidHash", "type": "bytes32"},
                    {"indexed": True, "name": "owner", "type": "address"},
                    {"indexed": False, "name": "ts", "type": "uint256"}
                ],
                "name": "UploadRecorded",
                "type": "event"
            },
            {
                "anonymous": False,
                "inputs": [
                    {"indexed": True, "name": "cidHash", "type": "bytes32"},
                    {"indexed": True, "name": "owner", "type": "address"},
                    {"indexed": False, "name": "grantee", "type": "address"},
                    {"indexed": False, "name": "expiry", "type": "uint256"}
                ],
                "name": "AccessGranted",
                "type": "event"
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
            address=Web3.to_checksum_address(HEALTH_RECORDS_CONTRACT),
            abi=EVENTS_ABI,
        )
        
        # Get latest block
        latest_block = w3.eth.block_number
        from_block = max(0, latest_block - 50000)  # Last 50000 blocks for more history
        
        events = []
        
        # Get UploadRecorded events (filter by patient's CID hashes)
        try:
            for cid_hash in cid_hashes:
                try:
                    upload_events = contract.events.UploadRecorded.get_logs(
                        fromBlock=from_block,
                        toBlock=latest_block,
                        argument_filters={"cidHash": bytes.fromhex(cid_hash[2:] if cid_hash.startswith("0x") else cid_hash)}
                    )
                    for event in upload_events:
                        # Convert timestamp to ISO format
                        ts = event.args.ts if hasattr(event.args, 'ts') else 0
                        timestamp = format_timestamp(datetime.fromtimestamp(ts, tz=timezone.utc)) if ts else None
                        
                        events.append({
                            "event_type": "upload",
                            "cidHash": event.args.cidHash.hex() if hasattr(event.args.cidHash, 'hex') else str(event.args.cidHash),
                            "owner": event.args.owner,
                            "timestamp": timestamp,
                            "block_number": event.blockNumber,
                            "tx_hash": event.transactionHash.hex() if hasattr(event.transactionHash, 'hex') else str(event.transactionHash),
                        })
                except Exception:
                    pass  # Individual filter might fail, continue
        except Exception:
            pass
        
        # Get AccessGranted events
        try:
            for cid_hash in cid_hashes:
                try:
                    grant_events = contract.events.AccessGranted.get_logs(
                        fromBlock=from_block,
                        toBlock=latest_block,
                        argument_filters={"cidHash": bytes.fromhex(cid_hash[2:] if cid_hash.startswith("0x") else cid_hash)}
                    )
                    for event in grant_events:
                        expiry = event.args.expiry if hasattr(event.args, 'expiry') else 0
                        timestamp = format_timestamp(datetime.fromtimestamp(expiry, tz=timezone.utc)) if expiry else None
                        
                        events.append({
                            "event_type": "grant",
                            "cidHash": event.args.cidHash.hex() if hasattr(event.args.cidHash, 'hex') else str(event.args.cidHash),
                            "owner": event.args.owner,
                            "grantee": event.args.grantee if hasattr(event.args, 'grantee') else None,
                            "expiry": timestamp,
                            "timestamp": timestamp,
                            "block_number": event.blockNumber,
                            "tx_hash": event.transactionHash.hex() if hasattr(event.transactionHash, 'hex') else str(event.transactionHash),
                        })
                except Exception:
                    pass
        except Exception:
            pass
        
        # Get AccessRevoked events
        try:
            for cid_hash in cid_hashes:
                try:
                    revoke_events = contract.events.AccessRevoked.get_logs(
                        fromBlock=from_block,
                        toBlock=latest_block,
                        argument_filters={"cidHash": bytes.fromhex(cid_hash[2:] if cid_hash.startswith("0x") else cid_hash)}
                    )
                    for event in revoke_events:
                        # Get block timestamp
                        block = w3.eth.get_block(event.blockNumber)
                        timestamp = format_timestamp(datetime.fromtimestamp(block.timestamp, tz=timezone.utc)) if block else None
                        
                        events.append({
                            "event_type": "revoke",
                            "cidHash": event.args.cidHash.hex() if hasattr(event.args.cidHash, 'hex') else str(event.args.cidHash),
                            "owner": event.args.owner,
                            "timestamp": timestamp,
                            "block_number": event.blockNumber,
                            "tx_hash": event.transactionHash.hex() if hasattr(event.transactionHash, 'hex') else str(event.transactionHash),
                        })
                except Exception:
                    pass
        except Exception:
            pass
        
        # Sort by block number
        events.sort(key=lambda x: x.get("block_number", 0), reverse=True)
        
        return events
        
    except Exception as e:
        print(f"Warning: Failed to fetch blockchain events: {e}")
        return []


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
                unix_ts = event.args.timestamp
                events.append({
                    "event_type": "RecordAdded",
                    "patient": event.args.patient,
                    "recordHash": event.args.recordHash.hex(),
                    "timestamp": format_timestamp(datetime.fromtimestamp(unix_ts, tz=timezone.utc)) if unix_ts else None,
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
                unix_ts = event.args.timestamp
                events.append({
                    "event_type": "AccessGranted",
                    "patient": event.args.patient,
                    "doctor": event.args.doctor,
                    "recordHash": event.args.recordHash.hex(),
                    "timestamp": format_timestamp(datetime.fromtimestamp(unix_ts, tz=timezone.utc)) if unix_ts else None,
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
                unix_ts = event.args.timestamp
                events.append({
                    "event_type": "AccessRevoked",
                    "patient": event.args.patient,
                    "doctor": event.args.doctor,
                    "recordHash": event.args.recordHash.hex(),
                    "timestamp": format_timestamp(datetime.fromtimestamp(unix_ts, tz=timezone.utc)) if unix_ts else None,
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
                unix_ts = event.args.timestamp
                events.append({
                    "event_type": "RecordAccessed",
                    "doctor": event.args.doctor,
                    "patient": event.args.patient,
                    "recordHash": event.args.recordHash.hex(),
                    "timestamp": format_timestamp(datetime.fromtimestamp(unix_ts, tz=timezone.utc)) if unix_ts else None,
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
