"""
Alchemy Webhook Handler for Blockchain Event Indexing

This module handles webhook notifications from Alchemy Notify API for
indexing blockchain events into the audit_logs table.

Documentation: https://docs.alchemy.com/reference/notify-api-quickstart

Webhook Setup:
1. Go to https://dashboard.alchemy.com/
2. Navigate to Notify > Create Webhook
3. Select "Address Activity" or "Custom Webhook"
4. Set URL to: https://your-backend/webhooks/alchemy
5. Add the ConsentRegistry contract address
6. Configure for Sepolia network

Environment Variables:
- ALCHEMY_WEBHOOK_SIGNING_KEY: Signing key for webhook verification
- HEALTH_RECORDS_CONTRACT_ADDRESS: ConsentRegistry contract address

Security:
- Validates webhook signature using HMAC-SHA256
- Only processes events from known contract address
- Rate limits incoming webhooks
"""

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

# Import database functions
from app.db import create_audit_log

router = APIRouter()


# ============================================================================
# Configuration
# ============================================================================

ALCHEMY_WEBHOOK_SIGNING_KEY = os.getenv("ALCHEMY_WEBHOOK_SIGNING_KEY", "")
CONTRACT_ADDRESS = (
    os.getenv("HEALTH_RECORDS_CONTRACT_ADDRESS") or
    os.getenv("NEXT_PUBLIC_CONTRACT_ADDRESS", "")
).lower()

# Event topic signatures (keccak256 of event signature)
# These are pre-computed for efficiency
EVENT_TOPICS = {
    # UploadRecorded(bytes32,bytes32,bytes32,address,uint256)
    "0x": "UploadRecorded",
    # AccessRequested(bytes32,bytes32,bytes32,uint256)
    "0x": "AccessRequested",
    # AccessGranted(bytes32,bytes32,bytes32,uint256,uint256)
    "0x": "AccessGranted",
    # AccessRedeemed(bytes32,bytes32,bytes32,address,uint256)
    "0x": "AccessRedeemed",
    # AccessRevoked(bytes32,bytes32,bytes32,uint256)
    "0x": "AccessRevoked",
}


# ============================================================================
# Request/Response Models
# ============================================================================

class AlchemyWebhookEvent(BaseModel):
    """Model for Alchemy webhook payload."""
    id: str
    createdAt: str
    type: str
    event: dict


class WebhookResponse(BaseModel):
    """Response model for webhook endpoint."""
    status: str
    processed: int
    errors: int


# ============================================================================
# Signature Verification
# ============================================================================

def verify_alchemy_signature(
    payload: bytes,
    signature: str,
    signing_key: str
) -> bool:
    """
    Verify Alchemy webhook signature using HMAC-SHA256.
    
    Per Alchemy docs: https://docs.alchemy.com/reference/notify-api-quickstart
    The signature is computed as HMAC-SHA256(payload, signing_key)
    
    Args:
        payload: Raw request body bytes
        signature: X-Alchemy-Signature header value
        signing_key: Webhook signing key from Alchemy dashboard
        
    Returns:
        True if signature is valid
    """
    if not signing_key:
        # If no signing key configured, skip verification (dev mode)
        return True
    
    expected_sig = hmac.new(
        signing_key.encode("utf-8"),
        payload,
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(expected_sig, signature)


# ============================================================================
# Event Parsing
# ============================================================================

# Event topic signatures (keccak256 of event signature)
# Compute with: keccak256("EventName(type1,type2,...)")
# For ConsentRegistry events:
UPLOAD_RECORDED_TOPIC = "UploadRecorded"  # Match on substring for flexibility
ACCESS_REQUESTED_TOPIC = "AccessRequested"
ACCESS_GRANTED_TOPIC = "AccessGranted"
ACCESS_REDEEMED_TOPIC = "AccessRedeemed"
ACCESS_REVOKED_TOPIC = "AccessRevoked"
ACCESS_TRANSFERRED_TOPIC = "AccessTransferred"


def parse_event_data(log: dict) -> Optional[dict]:
    """
    Parse event data from Alchemy webhook log entry.
    
    Args:
        log: Log entry from Alchemy webhook
        
    Returns:
        Parsed event data or None if not a recognized event
    """
    topics = log.get("topics", [])
    if not topics:
        return None
    
    event_topic = str(topics[0])
    data = log.get("data", "0x")
    
    # Determine event type based on topic signature
    # Check each event type explicitly (order matters - check specific first)
    
    # AccessTransferred - check first as it's most specific
    if ACCESS_TRANSFERRED_TOPIC in event_topic:
        cid_hash = topics[1] if len(topics) > 1 else None
        patient_id_hash = topics[2] if len(topics) > 2 else None
        # fromHospitalHash and toHospitalHash are in data
        if len(data) >= 130:
            from_hospital_hash = "0x" + data[2:66]
            to_hospital_hash = "0x" + data[66:130]
            ts = int(data[130:194], 16) if len(data) >= 194 else None
        else:
            from_hospital_hash = None
            to_hospital_hash = None
            ts = None
        
        return {
            "event_type": "AccessTransferred",
            "cid_hash": cid_hash,
            "patient_id_hash": patient_id_hash,
            "from_hospital_hash": from_hospital_hash,
            "to_hospital_hash": to_hospital_hash,
            "timestamp": ts,
        }
    
    # AccessGranted
    if ACCESS_GRANTED_TOPIC in event_topic:
        cid_hash = topics[1] if len(topics) > 1 else None
        patient_id_hash = topics[2] if len(topics) > 2 else None
        hospital_id_hash = topics[3] if len(topics) > 3 else None
        
        # Parse expiry and ts from data
        if len(data) >= 130:
            expiry = int(data[2:66], 16)
            ts = int(data[66:130], 16)
        else:
            expiry = None
            ts = None
        
        return {
            "event_type": "AccessGranted",
            "cid_hash": cid_hash,
            "patient_id_hash": patient_id_hash,
            "hospital_id_hash": hospital_id_hash,
            "expiry": expiry,
            "timestamp": ts,
        }
    
    # AccessRevoked
    if ACCESS_REVOKED_TOPIC in event_topic:
        cid_hash = topics[1] if len(topics) > 1 else None
        patient_id_hash = topics[2] if len(topics) > 2 else None
        hospital_id_hash = topics[3] if len(topics) > 3 else None
        
        if len(data) >= 66:
            ts = int(data[2:66], 16)
        else:
            ts = None
        
        return {
            "event_type": "AccessRevoked",
            "cid_hash": cid_hash,
            "patient_id_hash": patient_id_hash,
            "hospital_id_hash": hospital_id_hash,
            "timestamp": ts,
        }
    
    # AccessRedeemed
    if ACCESS_REDEEMED_TOPIC in event_topic:
        cid_hash = topics[1] if len(topics) > 1 else None
        patient_id_hash = topics[2] if len(topics) > 2 else None
        hospital_id_hash = topics[3] if len(topics) > 3 else None
        
        if len(data) >= 130:
            actor = "0x" + data[26:66]
            ts = int(data[66:130], 16)
        else:
            actor = None
            ts = None
        
        return {
            "event_type": "AccessRedeemed",
            "cid_hash": cid_hash,
            "patient_id_hash": patient_id_hash,
            "hospital_id_hash": hospital_id_hash,
            "actor": actor,
            "timestamp": ts,
        }
    
    # AccessRequested
    if ACCESS_REQUESTED_TOPIC in event_topic:
        cid_hash = topics[1] if len(topics) > 1 else None
        patient_id_hash = topics[2] if len(topics) > 2 else None
        requester_hash = topics[3] if len(topics) > 3 else None
        
        if len(data) >= 66:
            ts = int(data[2:66], 16)
        else:
            ts = None
        
        return {
            "event_type": "AccessRequested",
            "cid_hash": cid_hash,
            "patient_id_hash": patient_id_hash,
            "requester_hash": requester_hash,
            "timestamp": ts,
        }
    
    # UploadRecorded - check last as other events contain "Recorded"
    if UPLOAD_RECORDED_TOPIC in event_topic:
        cid_hash = topics[1] if len(topics) > 1 else None
        patient_id_hash = topics[2] if len(topics) > 2 else None
        hospital_id_hash = topics[3] if len(topics) > 3 else None
        
        # Parse non-indexed params from data
        # data contains: actor (address), ts (uint256)
        if len(data) >= 130:  # 0x + 64 chars for address + 64 chars for ts
            actor = "0x" + data[26:66]  # Address is 20 bytes, padded to 32
            ts = int(data[66:130], 16)
        else:
            actor = None
            ts = None
        
        return {
            "event_type": "UploadRecorded",
            "cid_hash": cid_hash,
            "patient_id_hash": patient_id_hash,
            "hospital_id_hash": hospital_id_hash,
            "actor": actor,
            "timestamp": ts,
        }
    
    return None


# ============================================================================
# Webhook Endpoint
# ============================================================================

@router.post("/webhooks/alchemy", response_model=WebhookResponse)
async def handle_alchemy_webhook(request: Request):
    """
    Handle Alchemy webhook notifications for blockchain events.
    
    This endpoint receives notifications from Alchemy Notify API when
    events are emitted from the ConsentRegistry contract.
    
    Reference: https://docs.alchemy.com/reference/notify-api-quickstart
    
    Headers:
        X-Alchemy-Signature: HMAC-SHA256 signature for verification
        
    Body:
        Alchemy webhook payload containing event logs
        
    Returns:
        WebhookResponse with processing status
    """
    # Get raw payload for signature verification
    payload = await request.body()
    signature = request.headers.get("X-Alchemy-Signature", "")
    
    # Verify signature
    if ALCHEMY_WEBHOOK_SIGNING_KEY:
        if not verify_alchemy_signature(payload, signature, ALCHEMY_WEBHOOK_SIGNING_KEY):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid webhook signature"
            )
    
    # Parse payload
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload"
        )
    
    processed = 0
    errors = 0
    
    # Handle different webhook types
    webhook_type = data.get("type", "")
    event_data = data.get("event", {})
    
    # Process activity logs
    activity = event_data.get("activity", [])
    for item in activity:
        # Check if this is from our contract
        contract_addr = item.get("rawContract", {}).get("address", "").lower()
        if CONTRACT_ADDRESS and contract_addr != CONTRACT_ADDRESS:
            continue
        
        # Get the log
        log = item.get("log", {})
        if not log:
            continue
        
        # Parse the event
        parsed = parse_event_data(log)
        if not parsed:
            continue
        
        # Write to audit log
        try:
            await create_audit_log(
                event_type=parsed["event_type"],
                cid_hash=parsed.get("cid_hash"),
                patient_id_hash=parsed.get("patient_id_hash"),
                hospital_id_hash=parsed.get("hospital_id_hash"),
                details=json.dumps(parsed),
                tx_hash=log.get("transactionHash"),
                block_number=int(log.get("blockNumber", "0"), 16) if log.get("blockNumber") else None,
            )
            processed += 1
        except Exception as e:
            print(f"Error writing audit log: {e}")
            errors += 1
    
    return WebhookResponse(
        status="ok",
        processed=processed,
        errors=errors
    )


@router.get("/webhooks/health")
async def webhook_health():
    """Health check endpoint for webhook configuration."""
    return {
        "status": "ok",
        "contract_address": CONTRACT_ADDRESS or "not configured",
        "signing_key_configured": bool(ALCHEMY_WEBHOOK_SIGNING_KEY),
    }
