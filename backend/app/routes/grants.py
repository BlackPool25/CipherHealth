"""
Grant Routes for Decent-Hospital Backend

Handles Umbral re-encryption grants:
- POST /grant/create: Create a re-encryption key grant
- POST /grant/revoke: Revoke a grant (DB + on-chain)
"""

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.db import (
    GrantCreate,
    GrantResponse,
    create_grant,
    get_file_by_cid,
    get_grant_by_id,
    get_grants_by_granter,
    get_grants_for_grantee,
    get_user_by_id,
    revoke_grant,
)
from app.utils.umbral_utils import generate_reenc_key

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class CreateGrantRequest(BaseModel):
    """Request to create a new grant."""

    granter_id: int  # Owner of the file
    grantee_id: int  # User receiving access
    file_id: int  # File to grant access to
    expires_at: Optional[str] = None  # ISO format datetime, None = no expiry


class CreateGrantResponse(BaseModel):
    """Response after creating a grant."""

    grant_id: int
    reencryption_key: str  # Umbral kfrag (hex encoded)
    message: str


class RevokeGrantRequest(BaseModel):
    """Request to revoke a grant."""

    grant_id: int
    granter_id: int  # For authorization check
    emit_onchain: bool = True  # Whether to emit on-chain revocation


class RevokeGrantResponse(BaseModel):
    """Response after revoking a grant."""

    grant_id: int
    status: str
    tx_hash: Optional[str] = None  # On-chain transaction hash
    message: str


class ListGrantsResponse(BaseModel):
    """Response for listing grants."""

    grants: list[dict]
    count: int


# ============================================================================
# Routes
# ============================================================================


@router.post("/create", response_model=CreateGrantResponse)
async def create_new_grant(request: CreateGrantRequest):
    """
    Create a new re-encryption key grant.

    Generates an Umbral re-encryption key (kfrag) that allows a proxy
    to re-encrypt data for the grantee without revealing the plaintext.

    Args:
        request: Grant creation request with granter, grantee, and file info.

    Returns:
        Grant ID and re-encryption key.

    Raises:
        HTTPException 400: If granter, grantee, or file not found.
        HTTPException 403: If granter doesn't own the file.
        HTTPException 500: If grant creation fails.
    """
    # Validate granter exists
    granter = await get_user_by_id(request.granter_id)
    if not granter:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Granter not found",
        )

    # Validate grantee exists
    grantee = await get_user_by_id(request.grantee_id)
    if not grantee:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Grantee not found",
        )

    # Get grantee's public key
    grantee_public_key = grantee.get("public_key")
    if not grantee_public_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Grantee has no public key registered",
        )

    # TODO: Validate file exists and granter owns it
    # For now, we trust the file_id

    try:
        # Generate re-encryption key using Umbral
        # This creates a kfrag that allows re-encryption from granter to grantee
        reenc_key = generate_reenc_key(
            granter_secret_key=None,  # TODO: Load from secure storage
            grantee_public_key=grantee_public_key,
        )

        # Create grant in database
        grant_data = GrantCreate(
            granter_id=request.granter_id,
            grantee_id=request.grantee_id,
            file_id=request.file_id,
            expires_at=request.expires_at,
        )
        grant_id = await create_grant(grant_data, reenc_key)

        return CreateGrantResponse(
            grant_id=grant_id,
            reencryption_key=reenc_key,
            message="Grant created successfully",
        )

    except NotImplementedError as e:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create grant: {str(e)}",
        )


@router.post("/revoke", response_model=RevokeGrantResponse)
async def revoke_existing_grant(request: RevokeGrantRequest):
    """
    Revoke an existing grant.

    Marks the grant as revoked in the database and optionally emits
    an on-chain transaction to the grant contract.

    Args:
        request: Revoke request with grant ID and authorization.

    Returns:
        Revocation status and transaction hash (if on-chain).

    Raises:
        HTTPException 400: If grant not found.
        HTTPException 403: If requester is not the granter.
        HTTPException 500: If revocation fails.
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
        except Exception as e:
            # Log error but continue with DB revocation
            print(f"Warning: On-chain revocation failed: {e}")
            # TODO: Implement proper logging

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


@router.get("/list/grantee/{grantee_id}", response_model=ListGrantsResponse)
async def list_grants_for_grantee(grantee_id: int):
    """
    List all active grants for a grantee (files they have access to).

    Args:
        grantee_id: ID of the grantee.

    Returns:
        List of active grants.
    """
    grants = await get_grants_for_grantee(grantee_id)
    return ListGrantsResponse(grants=grants, count=len(grants))


@router.get("/list/granter/{granter_id}", response_model=ListGrantsResponse)
async def list_grants_by_granter(granter_id: int):
    """
    List all grants created by a granter.

    Args:
        granter_id: ID of the granter.

    Returns:
        List of all grants (active and revoked).
    """
    grants = await get_grants_by_granter(granter_id)
    return ListGrantsResponse(grants=grants, count=len(grants))


# ============================================================================
# On-Chain Interaction (Placeholder)
# ============================================================================


async def emit_onchain_revocation(grant_id: int) -> str:
    """
    Emit an on-chain transaction to revoke a grant.

    TODO: Implement actual on-chain interaction:
    1. Load ETH private key from ETH_PRIVATE_KEY env
    2. Connect to RPC using ETH_RPC_URL
    3. Call revokeGrant(grant_id) on GRANT_CONTRACT_ADDRESS
    4. Wait for transaction confirmation
    5. Return transaction hash

    Args:
        grant_id: The ID of the grant to revoke.

    Returns:
        Transaction hash.

    Raises:
        NotImplementedError: Until implemented.
    """
    # Load configuration from environment
    eth_rpc_url = os.getenv("ETH_RPC_URL")
    eth_private_key = os.getenv("ETH_PRIVATE_KEY")
    contract_address = os.getenv("GRANT_CONTRACT_ADDRESS")

    if not all([eth_rpc_url, eth_private_key, contract_address]):
        raise NotImplementedError(
            "On-chain revocation not configured. "
            "Set ETH_RPC_URL, ETH_PRIVATE_KEY, and GRANT_CONTRACT_ADDRESS."
        )

    # TODO: Implement actual Web3 transaction
    # from web3 import Web3
    # from eth_account import Account
    #
    # w3 = Web3(Web3.HTTPProvider(eth_rpc_url))
    # account = Account.from_key(eth_private_key)
    #
    # # Load contract ABI (TODO: store ABI in config)
    # contract = w3.eth.contract(address=contract_address, abi=GRANT_CONTRACT_ABI)
    #
    # # Build transaction
    # tx = contract.functions.revokeGrant(grant_id).build_transaction({
    #     'from': account.address,
    #     'nonce': w3.eth.get_transaction_count(account.address),
    #     'gas': 100000,
    #     'gasPrice': w3.eth.gas_price,
    # })
    #
    # # Sign and send
    # signed_tx = account.sign_transaction(tx)
    # tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
    #
    # # Wait for confirmation
    # receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    # return receipt.transactionHash.hex()

    raise NotImplementedError(
        "On-chain revocation not yet implemented. "
        "See emit_onchain_revocation() for implementation steps."
    )
