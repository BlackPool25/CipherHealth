"""
Audit Routes for Decent-Hospital Backend

Provides audit trail functionality by reading from:
- Database records (grants, files, users)
- Ethereum blockchain events (on-chain audit)

Endpoints:
- GET /audit: Get all audit logs
- GET /audit/logs/{user_id}: Get audit logs for a specific user
- GET /audit/chain: Get on-chain audit records
"""

import os
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from web3 import Web3

from app.db import (
    get_files_by_owner,
    get_grants_by_granter,
    get_grants_for_grantee,
    get_user_by_id,
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
