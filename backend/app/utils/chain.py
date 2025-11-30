"""
Ethereum Chain Client for Decent-Hospital Backend

Provides functions for interacting with the HealthRecords smart contract
on Sepolia testnet.

Environment Variables Required:
- SEPOLIA_RPC_URL: Ethereum RPC endpoint (Infura, Alchemy, or public)
- HEALTH_RECORDS_CONTRACT_ADDRESS: Deployed contract address
- SIGNER_PRIVATE_KEY: Private key for signing transactions (NEVER commit this!)

The signer should be a funded Sepolia wallet. Get testnet ETH from:
- https://sepoliafaucet.com/
- https://sepolia-faucet.pk910.de/

Security Notes:
- NEVER expose or log private keys
- Use environment variables only
- Consider using a hardware wallet or KMS in production

References:
- Sepolia docs: https://sepolia.dev/
- web3.py docs: https://web3py.readthedocs.io/
- Hardhat deployment: https://hardhat.org/tutorial/deploying-to-a-live-network
"""

import os
from typing import Optional
from datetime import datetime, timezone

# web3.py imports
try:
    from web3 import Web3
    from web3.middleware import ExtraDataToPOAMiddleware
    from eth_account import Account
    WEB3_AVAILABLE = True
except ImportError:
    WEB3_AVAILABLE = False
    Web3 = None
    Account = None


class ChainError(Exception):
    """Exception raised for blockchain interaction errors."""
    pass


class ChainConfigError(ChainError):
    """Exception raised for missing configuration."""
    pass


# ============================================================================
# Configuration
# ============================================================================

def get_config():
    """Get chain configuration from environment variables."""
    rpc_url = os.getenv("SEPOLIA_RPC_URL") or os.getenv("ETH_RPC_URL")
    contract_address = (
        os.getenv("HEALTH_RECORDS_CONTRACT_ADDRESS") or
        os.getenv("GRANT_CONTRACT_ADDRESS")
    )
    signer_key = os.getenv("SIGNER_PRIVATE_KEY")
    
    return {
        "rpc_url": rpc_url,
        "contract_address": contract_address,
        "signer_key": signer_key,
    }


def is_chain_configured() -> bool:
    """Check if chain interaction is properly configured."""
    config = get_config()
    return all([
        WEB3_AVAILABLE,
        config["rpc_url"],
        config["contract_address"],
        config["signer_key"],
    ])


def ensure_hex_prefix(tx_hash: str) -> str:
    """Ensure transaction hash has 0x prefix for Etherscan compatibility."""
    if tx_hash and not tx_hash.startswith('0x'):
        return '0x' + tx_hash
    return tx_hash


# ============================================================================
# Contract ABI
# ============================================================================

# Minimal ABI for the HealthRecords contract with grant functions
# This should match the deployed contract
HEALTH_RECORDS_ABI = [
    {
        "inputs": [],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "patient", "type": "address"},
            {"indexed": False, "name": "cid", "type": "string"}
        ],
        "name": "RecordUpdated",
        "type": "event"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "cid", "type": "string"},
            {"indexed": True, "name": "granter", "type": "address"},
            {"indexed": False, "name": "granteePubkey", "type": "string"},
            {"indexed": False, "name": "expiryTimestamp", "type": "uint256"}
        ],
        "name": "GrantRecorded",
        "type": "event"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "name": "cid", "type": "string"},
            {"indexed": True, "name": "granter", "type": "address"},
            {"indexed": False, "name": "granteePubkey", "type": "string"}
        ],
        "name": "GrantRevoked",
        "type": "event"
    },
    {
        "inputs": [{"name": "cid", "type": "string"}],
        "name": "setRecord",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"name": "patient", "type": "address"}],
        "name": "getRecord",
        "outputs": [{"name": "", "type": "string"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {"name": "cid", "type": "string"},
            {"name": "granteePubkey", "type": "string"},
            {"name": "expiryTimestamp", "type": "uint256"}
        ],
        "name": "recordGrant",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"name": "cid", "type": "string"},
            {"name": "granteePubkey", "type": "string"}
        ],
        "name": "revokeGrant",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"name": "cid", "type": "string"},
            {"name": "granteePubkey", "type": "string"}
        ],
        "name": "viewGrant",
        "outputs": [
            {"name": "isActive", "type": "bool"},
            {"name": "expiryTimestamp", "type": "uint256"},
            {"name": "granter", "type": "address"}
        ],
        "stateMutability": "view",
        "type": "function"
    }
]


# ============================================================================
# Web3 Client
# ============================================================================

def get_web3() -> "Web3":
    """Get a configured Web3 instance."""
    if not WEB3_AVAILABLE:
        raise ChainConfigError(
            "web3.py is not installed. Install with: pip install web3"
        )
    
    config = get_config()
    if not config["rpc_url"]:
        raise ChainConfigError(
            "SEPOLIA_RPC_URL environment variable is not set. "
            "Set it to an Ethereum RPC endpoint (e.g., Infura or Alchemy)."
        )
    
    w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
    
    # Add POA middleware for testnets like Sepolia
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    
    if not w3.is_connected():
        raise ChainError(f"Failed to connect to {config['rpc_url']}")
    
    return w3


def get_contract(w3: "Web3"):
    """Get the HealthRecords contract instance."""
    config = get_config()
    if not config["contract_address"]:
        raise ChainConfigError(
            "HEALTH_RECORDS_CONTRACT_ADDRESS environment variable is not set. "
            "Deploy the contract first using: npx hardhat run scripts/deploy.ts --network sepolia"
        )
    
    return w3.eth.contract(
        address=Web3.to_checksum_address(config["contract_address"]),
        abi=HEALTH_RECORDS_ABI,
    )


def get_signer(w3: "Web3"):
    """Get the signer account."""
    config = get_config()
    if not config["signer_key"]:
        raise ChainConfigError(
            "SIGNER_PRIVATE_KEY environment variable is not set. "
            "This should be the private key of a funded Sepolia wallet. "
            "Get testnet ETH from https://sepoliafaucet.com/"
        )
    
    return Account.from_key(config["signer_key"])


# ============================================================================
# Chain Interaction Functions
# ============================================================================

async def set_record_onchain(cid: str) -> str:
    """
    Record a file CID on-chain using setRecord.
    
    Args:
        cid: IPFS Content Identifier of the file
        
    Returns:
        Transaction hash
        
    Raises:
        ChainConfigError: If not configured
        ChainError: If transaction fails
    """
    if not is_chain_configured():
        raise ChainConfigError(
            "Chain not configured. Set SEPOLIA_RPC_URL, "
            "HEALTH_RECORDS_CONTRACT_ADDRESS, and SIGNER_PRIVATE_KEY."
        )
    
    try:
        w3 = get_web3()
        contract = get_contract(w3)
        signer = get_signer(w3)
        
        # Build transaction
        nonce = w3.eth.get_transaction_count(signer.address)
        
        tx = contract.functions.setRecord(cid).build_transaction({
            'from': signer.address,
            'nonce': nonce,
            'gas': 100000,
            'gasPrice': w3.eth.gas_price,
        })
        
        # Sign and send
        signed_tx = w3.eth.account.sign_transaction(tx, signer.key)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        # Wait for receipt
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
        
        if receipt['status'] != 1:
            raise ChainError("Transaction reverted")
        
        return ensure_hex_prefix(tx_hash.hex())
        
    except ChainConfigError:
        raise
    except Exception as e:
        raise ChainError(f"Failed to set record on-chain: {str(e)}")


async def record_grant_onchain(
    cid: str,
    grantee_pubkey: str,
    expiry_timestamp: int,
) -> str:
    """
    Record a grant on-chain by calling the HealthRecords contract.
    
    Args:
        cid: IPFS Content Identifier of the file
        grantee_pubkey: Grantee's Umbral public key (hex)
        expiry_timestamp: Unix timestamp when grant expires
        
    Returns:
        Transaction hash
        
    Raises:
        ChainConfigError: If not configured
        ChainError: If transaction fails
    """
    if not is_chain_configured():
        raise ChainConfigError(
            "Chain not configured. Set SEPOLIA_RPC_URL, "
            "HEALTH_RECORDS_CONTRACT_ADDRESS, and SIGNER_PRIVATE_KEY."
        )
    
    try:
        w3 = get_web3()
        contract = get_contract(w3)
        signer = get_signer(w3)
        
        # Build transaction
        nonce = w3.eth.get_transaction_count(signer.address)
        
        tx = contract.functions.recordGrant(
            cid,
            grantee_pubkey,
            expiry_timestamp,
        ).build_transaction({
            'from': signer.address,
            'nonce': nonce,
            'gas': 200000,
            'gasPrice': w3.eth.gas_price,
        })
        
        # Sign and send
        signed_tx = w3.eth.account.sign_transaction(tx, signer.key)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        # Wait for receipt
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt['status'] != 1:
            raise ChainError("Transaction reverted")
        
        return ensure_hex_prefix(tx_hash.hex())
        
    except ChainConfigError:
        raise
    except Exception as e:
        raise ChainError(f"Failed to record grant on-chain: {str(e)}")


async def verify_grant_onchain(
    cid: str,
    grantee_pubkey: str,
) -> bool:
    """
    Verify a grant exists on-chain and is still valid.
    
    Args:
        cid: IPFS Content Identifier of the file
        grantee_pubkey: Grantee's Umbral public key (hex)
        
    Returns:
        True if grant is valid and not expired
        
    Raises:
        ChainConfigError: If not configured
        ChainError: If query fails
    """
    if not is_chain_configured():
        raise ChainConfigError("Chain not configured for verification")
    
    try:
        w3 = get_web3()
        contract = get_contract(w3)
        
        # Call viewGrant
        result = contract.functions.viewGrant(cid, grantee_pubkey).call()
        is_active, expiry_timestamp, granter = result
        
        if not is_active:
            return False
        
        # Check expiry
        if expiry_timestamp > 0:
            current_timestamp = int(datetime.now(timezone.utc).timestamp())
            if current_timestamp > expiry_timestamp:
                return False
        
        return True
        
    except ChainConfigError:
        raise
    except Exception as e:
        raise ChainError(f"Failed to verify grant on-chain: {str(e)}")


async def revoke_grant_onchain(
    cid: str,
    grantee_pubkey: str,
) -> str:
    """
    Revoke a grant on-chain.
    
    Args:
        cid: IPFS Content Identifier of the file
        grantee_pubkey: Grantee's Umbral public key (hex)
        
    Returns:
        Transaction hash
        
    Raises:
        ChainConfigError: If not configured
        ChainError: If transaction fails
    """
    if not is_chain_configured():
        raise ChainConfigError("Chain not configured for revocation")
    
    try:
        w3 = get_web3()
        contract = get_contract(w3)
        signer = get_signer(w3)
        
        nonce = w3.eth.get_transaction_count(signer.address)
        
        tx = contract.functions.revokeGrant(
            cid,
            grantee_pubkey,
        ).build_transaction({
            'from': signer.address,
            'nonce': nonce,
            'gas': 100000,
            'gasPrice': w3.eth.gas_price,
        })
        
        signed_tx = w3.eth.account.sign_transaction(tx, signer.key)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt['status'] != 1:
            raise ChainError("Revocation transaction reverted")
        
        return ensure_hex_prefix(tx_hash.hex())
        
    except ChainConfigError:
        raise
    except Exception as e:
        raise ChainError(f"Failed to revoke grant on-chain: {str(e)}")


async def get_grant_events(
    from_block: int = 0,
    to_block: Optional[int] = None,
) -> list[dict]:
    """
    Get GrantRecorded events from the contract.
    
    Args:
        from_block: Starting block number
        to_block: Ending block number (None = latest)
        
    Returns:
        List of grant event dictionaries
    """
    if not is_chain_configured():
        return []
    
    try:
        w3 = get_web3()
        contract = get_contract(w3)
        
        if to_block is None:
            to_block = w3.eth.block_number
        
        # Get GrantRecorded events
        events = contract.events.GrantRecorded.get_logs(
            fromBlock=from_block,
            toBlock=to_block,
        )
        
        return [
            {
                "event": "GrantRecorded",
                "cid": e.args.cid,
                "granter": e.args.granter,
                "grantee_pubkey": e.args.granteePubkey,
                "expiry_timestamp": e.args.expiryTimestamp,
                "block_number": e.blockNumber,
                "tx_hash": ensure_hex_prefix(e.transactionHash.hex()),
            }
            for e in events
        ]
        
    except Exception as e:
        print(f"Warning: Failed to get grant events: {e}")
        return []


def get_chain_status() -> dict:
    """
    Get the current chain configuration status.
    
    Returns:
        Dict with configuration status
    """
    config = get_config()
    
    status = {
        "web3_available": WEB3_AVAILABLE,
        "rpc_url_set": bool(config["rpc_url"]),
        "contract_address_set": bool(config["contract_address"]),
        "signer_key_set": bool(config["signer_key"]),
        "fully_configured": is_chain_configured(),
    }
    
    if is_chain_configured():
        try:
            w3 = get_web3()
            signer = get_signer(w3)
            status["connected"] = True
            status["network_id"] = w3.eth.chain_id
            status["signer_address"] = signer.address
            status["signer_balance_wei"] = w3.eth.get_balance(signer.address)
        except Exception as e:
            status["connected"] = False
            status["error"] = str(e)
    
    return status


# ============================================================================
# Hospital Access Grant Functions (Gas-Optimized using bytes32 and addresses)
# ============================================================================

# Extended ABI for gas-optimized grant functions
GRANT_ACCESS_ABI = [
    {
        "inputs": [
            {"name": "cidHash", "type": "bytes32"},
            {"name": "grantee", "type": "address"},
            {"name": "expiry", "type": "uint256"}
        ],
        "name": "grantAccessByHash",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"name": "cidHash", "type": "bytes32"}],
        "name": "revokeAccessByHash",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"name": "cidHash", "type": "bytes32"}],
        "name": "recordUpload",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"name": "cidHash", "type": "bytes32"}],
        "name": "getLatestGrant",
        "outputs": [
            {"name": "grantee", "type": "address"},
            {"name": "expiry", "type": "uint256"},
            {"name": "active", "type": "bool"}
        ],
        "stateMutability": "view",
        "type": "function"
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
    },
]


def get_contract_with_grant_abi(w3: "Web3"):
    """Get the HealthRecords contract with extended ABI for grant functions."""
    config = get_config()
    if not config["contract_address"]:
        raise ChainConfigError(
            "HEALTH_RECORDS_CONTRACT_ADDRESS environment variable is not set."
        )
    
    # Combine ABIs
    combined_abi = HEALTH_RECORDS_ABI + GRANT_ACCESS_ABI
    
    return w3.eth.contract(
        address=Web3.to_checksum_address(config["contract_address"]),
        abi=combined_abi,
    )


def compute_cid_hash(cid: str) -> bytes:
    """Compute keccak256 hash of CID for gas-optimized contract calls."""
    if not WEB3_AVAILABLE:
        raise ChainConfigError("web3.py not available")
    return Web3.keccak(text=cid)


def is_valid_eth_address(address: str) -> bool:
    """Check if a string is a valid Ethereum address (20 bytes / 40 hex chars)."""
    if not address:
        return False
    # Remove 0x prefix if present
    clean = address[2:] if address.startswith("0x") else address
    # Must be exactly 40 hex characters (20 bytes)
    if len(clean) != 40:
        return False
    try:
        int(clean, 16)
        return True
    except ValueError:
        return False


def compute_grant_identifier(patient_identifier: str, hospital_identifier: str) -> str:
    """
    Compute deterministic grant identifier from patient and hospital identifiers.
    
    Args:
        patient_identifier: Patient's UUID (or ETH address in future)
        hospital_identifier: Hospital's UUID (or ETH address in future)
        
    Returns:
        Grant identifier string
    """
    return f"hospital_access:{patient_identifier}:{hospital_identifier}"


def compute_grant_cid_hash(patient_identifier: str, hospital_identifier: str) -> str:
    """
    Compute deterministic cidHash for on-chain grant.
    
    Args:
        patient_identifier: Patient's UUID (or ETH address in future)
        hospital_identifier: Hospital's UUID (or ETH address in future)
        
    Returns:
        Hex string of the cidHash
    """
    if not WEB3_AVAILABLE:
        raise ChainConfigError("web3.py not available")
    grant_identifier = compute_grant_identifier(patient_identifier, hospital_identifier)
    return Web3.keccak(text=grant_identifier).hex()


async def grant_hospital_access_onchain(
    patient_identifier: str,
    hospital_identifier: str,
    hospital_eth_address: str,
    expiry_timestamp: int = 0,
) -> dict:
    """
    Record hospital access grant on-chain using grantAccessByHash.
    
    This function grants a hospital permission to upload for a patient.
    Uses a deterministic cidHash based on identifiers for tracking.
    
    Args:
        patient_identifier: Patient's UUID (or ETH address in future)
        hospital_identifier: Hospital's UUID (or ETH address in future)  
        hospital_eth_address: Hospital's Ethereum address for the grantee field
        expiry_timestamp: Unix timestamp when grant expires (0 = no expiry)
        
    Returns:
        Dict with:
            - tx_hash: Transaction hash
            - cid_hash: The cidHash used (CRITICAL - store this for revocation!)
            - grant_identifier: The identifier string used
        
    Raises:
        ChainConfigError: If not configured
        ChainError: If transaction fails
    """
    if not is_chain_configured():
        raise ChainConfigError(
            "Chain not configured. Set SEPOLIA_RPC_URL, "
            "HEALTH_RECORDS_CONTRACT_ADDRESS, and SIGNER_PRIVATE_KEY. "
            "See: https://sepolia.dev/ for testnet setup."
        )
    
    try:
        w3 = get_web3()
        contract = get_contract_with_grant_abi(w3)
        signer = get_signer(w3)
        
        # Create a deterministic cidHash for the patient-hospital relationship
        # Using UUIDs for now, easy to swap to ETH addresses later
        grant_identifier = compute_grant_identifier(patient_identifier, hospital_identifier)
        cid_hash = Web3.keccak(text=grant_identifier)
        cid_hash_hex = cid_hash.hex()
        
        # Build transaction
        nonce = w3.eth.get_transaction_count(signer.address)
        
        tx = contract.functions.grantAccessByHash(
            cid_hash,
            Web3.to_checksum_address(hospital_eth_address),
            expiry_timestamp,
        ).build_transaction({
            'from': signer.address,
            'nonce': nonce,
            'gas': 150000,
            'gasPrice': w3.eth.gas_price,
        })
        
        # Sign and send
        signed_tx = w3.eth.account.sign_transaction(tx, signer.key)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        # Wait for receipt
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt['status'] != 1:
            raise ChainError("Grant transaction reverted")
        
        return {
            "tx_hash": ensure_hex_prefix(tx_hash.hex()),
            "cid_hash": cid_hash_hex,
            "grant_identifier": grant_identifier,
        }
        
    except ChainConfigError:
        raise
    except Exception as e:
        raise ChainError(f"Failed to grant hospital access on-chain: {str(e)}")


async def revoke_hospital_access_onchain(
    stored_cid_hash: str,
) -> str:
    """
    Revoke hospital access grant on-chain using revokeAccessByHash.
    
    CRITICAL: This uses the exact cid_hash that was stored during grant.
    Do NOT recompute it - use the value stored in hospital_access.grant_cid_hash.
    
    Args:
        stored_cid_hash: The cid_hash from grant time (stored in hospital_access table)
        
    Returns:
        Transaction hash
        
    Raises:
        ChainConfigError: If not configured
        ChainError: If transaction fails
    """
    if not is_chain_configured():
        raise ChainConfigError(
            "Chain not configured. Set SEPOLIA_RPC_URL, "
            "HEALTH_RECORDS_CONTRACT_ADDRESS, and SIGNER_PRIVATE_KEY."
        )
    
    try:
        w3 = get_web3()
        contract = get_contract_with_grant_abi(w3)
        signer = get_signer(w3)
        
        # Convert hex string to bytes if needed
        if isinstance(stored_cid_hash, str):
            if stored_cid_hash.startswith("0x"):
                cid_hash = bytes.fromhex(stored_cid_hash[2:])
            else:
                cid_hash = bytes.fromhex(stored_cid_hash)
        else:
            cid_hash = stored_cid_hash
        
        nonce = w3.eth.get_transaction_count(signer.address)
        
        tx = contract.functions.revokeAccessByHash(cid_hash).build_transaction({
            'from': signer.address,
            'nonce': nonce,
            'gas': 100000,
            'gasPrice': w3.eth.gas_price,
        })
        
        signed_tx = w3.eth.account.sign_transaction(tx, signer.key)
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        
        if receipt['status'] != 1:
            raise ChainError("Revocation transaction reverted")
        
        return ensure_hex_prefix(tx_hash.hex())
        
    except ChainConfigError:
        raise
    except Exception as e:
        raise ChainError(f"Failed to revoke hospital access on-chain: {str(e)}")


async def verify_hospital_access_onchain(
    stored_cid_hash: str,
    expected_hospital_address: str | None = None,
) -> dict:
    """
    Verify hospital access grant on-chain using stored cidHash.
    
    Args:
        stored_cid_hash: The cid_hash from hospital_access table
        expected_hospital_address: Optional hospital address to verify against
        
    Returns:
        Dict with grant status: {grantee, expiry, active, is_valid}
        
    Raises:
        ChainConfigError: If not configured
        ChainError: If query fails
    """
    if not is_chain_configured():
        raise ChainConfigError("Chain not configured for verification")
    
    try:
        w3 = get_web3()
        contract = get_contract_with_grant_abi(w3)
        
        # Convert hex string to bytes
        if isinstance(stored_cid_hash, str):
            if stored_cid_hash.startswith("0x"):
                cid_hash = bytes.fromhex(stored_cid_hash[2:])
            else:
                cid_hash = bytes.fromhex(stored_cid_hash)
        else:
            cid_hash = stored_cid_hash
        
        result = contract.functions.getLatestGrant(cid_hash).call()
        grantee, expiry, active = result
        
        # Check if expired
        is_valid = active
        if active and expiry > 0:
            current_timestamp = int(datetime.now(timezone.utc).timestamp())
            if current_timestamp > expiry:
                is_valid = False
        
        hospital_matches = True
        if expected_hospital_address:
            hospital_matches = grantee.lower() == expected_hospital_address.lower() if grantee != "0x0000000000000000000000000000000000000000" else False
        
        return {
            "grantee": grantee,
            "expiry": expiry,
            "active": active,
            "is_valid": is_valid,
            "hospital_matches": hospital_matches,
        }
        
    except ChainConfigError:
        raise
    except Exception as e:
        raise ChainError(f"Failed to verify hospital access on-chain: {str(e)}")
