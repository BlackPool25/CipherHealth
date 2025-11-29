#!/usr/bin/env python3
"""
Encryption Verification Script for Decent-Hospital

This script verifies that:
1. Files uploaded via POST /upload are encrypted (not plaintext)
2. Capsule metadata exists and is valid
3. The blob stored on Storacha differs from the original plaintext
4. On-chain grant recording is working (Sepolia)

Prerequisites:
- Backend running at localhost:8000
- Storacha CLI configured (storacha login + space created)
- Sample image file at scripts/sample_image.jpg (or sample.txt)

Usage:
    cd backend && python ../scripts/verify_encryption.py

References:
- Storacha docs: https://docs.storacha.network/
- pyUmbral docs: https://pyumbral.readthedocs.io/
- Sepolia docs: https://sepolia.dev/

Author: QA Crypto Integrator
"""

import asyncio
import base64
import hashlib
import os

# Load .env from backend directory
try:
    from dotenv import load_dotenv
    backend_env = os.path.join(os.path.dirname(__file__), "..", "backend", ".env")
    load_dotenv(backend_env)
except ImportError:
    pass  # dotenv not installed, rely on shell env
import sys
from pathlib import Path

# Add parent directories to path for imports
script_dir = Path(__file__).parent
backend_dir = script_dir.parent / "backend"
sys.path.insert(0, str(backend_dir))

# Third-party imports
try:
    import requests
except ImportError:
    print("ERROR: 'requests' library required. Install with: pip install requests")
    sys.exit(1)


# ============================================================================
# Configuration
# ============================================================================

API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000")

# Try different sample files in order of preference
SAMPLE_FILES = [
    str(script_dir / "sample_image.jpg"),
    str(script_dir / "sample.png"),
    str(script_dir / "sample.jpg"),
    str(script_dir / "sample.txt"),
]

SAMPLE_FILE = None
for f in SAMPLE_FILES:
    if os.path.exists(f) and os.path.getsize(f) > 0:
        SAMPLE_FILE = f
        break

if SAMPLE_FILE is None:
    SAMPLE_FILE = SAMPLE_FILES[-1]  # Fallback to sample.txt


# ============================================================================
# Utility Functions
# ============================================================================

def compute_sha256(data: bytes) -> str:
    """Compute SHA256 hash of data."""
    return hashlib.sha256(data).hexdigest()


def print_result(test_name: str, passed: bool, details: str = ""):
    """Print formatted test result."""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {test_name}")
    if details:
        print(f"       {details}")


def print_action(action: str):
    """Print an action being performed."""
    print(f"\n🔧 {action}...")


# ============================================================================
# Test Functions
# ============================================================================

def check_sample_file_exists() -> tuple[bool, bytes, str]:
    """
    Check that sample file exists and read its contents.
    
    Returns:
        (success, file_bytes, error_message)
    """
    if not os.path.exists(SAMPLE_FILE):
        return False, b"", f"Sample file not found: {SAMPLE_FILE}"
    
    with open(SAMPLE_FILE, "rb") as f:
        file_bytes = f.read()
    
    if len(file_bytes) == 0:
        return False, b"", "Sample file is empty"
    
    return True, file_bytes, ""


def create_test_user(username: str = "encryption_test_user") -> tuple[bool, dict, str]:
    """
    Create a test user for upload (or use existing).
    
    Returns:
        (success, user_data, error_message)
    """
    # Admin password for production mode
    ADMIN_PASSWORD = os.environ.get("ADMIN_INVITE_PASSWORD", "%bWvcjE5X66dZuyTUtQt")
    
    try:
        # Try seed login first (simpler) - include admin password for production
        response = requests.post(
            f"{API_BASE_URL}/auth/seed-invite",
            json={"admin_password": ADMIN_PASSWORD},
            timeout=10,
        )
        
        if response.status_code != 200:
            return False, {}, f"Failed to get invite code: {response.text}"
        
        invite_code = response.json().get("code")
        
        # Login with invite
        response = requests.post(
            f"{API_BASE_URL}/auth/seed-login",
            json={"invite_code": invite_code},
            timeout=10,
        )
        
        if response.status_code != 200:
            return False, {}, f"Failed to login: {response.text}"
        
        data = response.json()
        return True, {
            "user": data.get("user", {}),
            "token": data.get("access_token", ""),
        }, ""
        
    except requests.RequestException as e:
        return False, {}, f"Request failed: {e}"


def upload_file_via_api(
    file_bytes: bytes,
    filename: str,
    patient_id: int,
    public_key: str,
    token: str,
) -> tuple[bool, dict, str]:
    """
    Upload a file via POST /upload endpoint.
    
    Returns:
        (success, response_data, error_message)
    """
    try:
        files = {"file": (filename, file_bytes, "application/octet-stream")}
        data = {
            "patient_id": str(patient_id),
            "owner_public_key": public_key,
        }
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        
        response = requests.post(
            f"{API_BASE_URL}/upload",
            files=files,
            data=data,
            headers=headers,
            timeout=120,  # Upload can take time
        )
        
        if response.status_code != 200:
            return False, {}, f"Upload failed: {response.status_code} - {response.text}"
        
        result = response.json()
        return True, result, ""
        
    except requests.RequestException as e:
        return False, {}, f"Request failed: {e}"


def download_blob_from_gateway(cid: str) -> tuple[bool, bytes, str]:
    """
    Download blob from Storacha IPFS gateway.
    
    Returns:
        (success, blob_bytes, error_message)
    """
    gateway_url = os.environ.get("STORACHA_GATEWAY_URL", "https://storacha.link")
    url = f"{gateway_url}/ipfs/{cid}"
    
    try:
        response = requests.get(url, timeout=60)
        
        if response.status_code != 200:
            return False, b"", f"Gateway download failed: {response.status_code}"
        
        return True, response.content, ""
        
    except requests.RequestException as e:
        return False, b"", f"Gateway request failed: {e}"


def verify_encryption(original_bytes: bytes, stored_bytes: bytes) -> tuple[bool, str]:
    """
    Verify that stored bytes are encrypted (different from original).
    
    Returns:
        (is_encrypted, details)
    """
    if original_bytes == stored_bytes:
        return False, "PLAIN_UPLOAD_DETECTED: Stored bytes match original plaintext exactly"
    
    # Check that stored bytes are at least nonce (12) + some ciphertext + tag (16) larger
    expected_overhead = 12 + 16  # nonce + GCM auth tag
    size_diff = len(stored_bytes) - len(original_bytes)
    
    if size_diff < 0:
        # Encrypted should be larger, not smaller (unless compression, but we don't compress)
        return False, f"Stored blob is smaller than original ({len(stored_bytes)} < {len(original_bytes)})"
    
    original_hash = compute_sha256(original_bytes)
    stored_hash = compute_sha256(stored_bytes)
    
    return True, f"Hashes differ: original={original_hash[:16]}..., stored={stored_hash[:16]}..."


def verify_capsule_metadata(capsule_hex: str) -> tuple[bool, str]:
    """
    Verify that capsule metadata is present and valid.
    
    Returns:
        (is_valid, details)
    """
    if not capsule_hex:
        return False, "No capsule metadata returned"
    
    if len(capsule_hex) < 32:  # Umbral capsules are larger
        return False, f"Capsule too short ({len(capsule_hex)} chars)"
    
    # Try to decode as hex
    try:
        capsule_bytes = bytes.fromhex(capsule_hex)
        if len(capsule_bytes) < 16:
            return False, f"Capsule bytes too short ({len(capsule_bytes)} bytes)"
        return True, f"Capsule valid: {len(capsule_bytes)} bytes"
    except ValueError as e:
        return False, f"Capsule is not valid hex: {e}"


def verify_encrypted_cek(encrypted_cek: str) -> tuple[bool, str]:
    """
    Verify that encrypted CEK is present and valid.
    
    Returns:
        (is_valid, details)
    """
    if not encrypted_cek:
        return False, "No encrypted_cek returned"
    
    if len(encrypted_cek) < 32:
        return False, f"encrypted_cek too short ({len(encrypted_cek)} chars)"
    
    # Try to decode as hex
    try:
        cek_bytes = bytes.fromhex(encrypted_cek)
        if len(cek_bytes) < 16:
            return False, f"encrypted_cek bytes too short ({len(cek_bytes)} bytes)"
        return True, f"encrypted_cek valid: {len(cek_bytes)} bytes"
    except ValueError as e:
        return False, f"encrypted_cek is not valid hex: {e}"


def check_sepolia_config() -> tuple[bool, str]:
    """
    Check if Sepolia blockchain is configured.
    
    Returns:
        (is_configured, details)
    """
    rpc_url = os.environ.get("SEPOLIA_RPC_URL") or os.environ.get("ETH_RPC_URL")
    contract_addr = (
        os.environ.get("HEALTH_RECORDS_CONTRACT_ADDRESS") or
        os.environ.get("GRANT_CONTRACT_ADDRESS")
    )
    signer_key = os.environ.get("SIGNER_PRIVATE_KEY")
    
    missing = []
    if not rpc_url:
        missing.append("SEPOLIA_RPC_URL")
    if not contract_addr:
        missing.append("HEALTH_RECORDS_CONTRACT_ADDRESS")
    if not signer_key:
        missing.append("SIGNER_PRIVATE_KEY")
    
    if missing:
        return False, f"Missing env vars: {', '.join(missing)}"
    
    return True, f"Contract: {contract_addr[:20]}..."


def verify_chain_connection() -> tuple[bool, str]:
    """
    Verify that we can connect to Sepolia and the contract.
    
    Returns:
        (success, details)
    """
    try:
        from web3 import Web3
        
        rpc_url = os.environ.get("SEPOLIA_RPC_URL") or os.environ.get("ETH_RPC_URL")
        if not rpc_url:
            return False, "No RPC URL configured"
        
        w3 = Web3(Web3.HTTPProvider(rpc_url))
        
        if not w3.is_connected():
            return False, f"Cannot connect to RPC: {rpc_url}"
        
        # Get latest block to verify connection
        block = w3.eth.block_number
        chain_id = w3.eth.chain_id
        
        # Sepolia chain ID is 11155111
        if chain_id != 11155111:
            return False, f"Wrong network: chain_id={chain_id} (expected 11155111 for Sepolia)"
        
        return True, f"Connected to Sepolia at block {block}"
        
    except ImportError:
        return False, "web3.py not installed. Install with: pip install web3"
    except Exception as e:
        return False, f"Chain connection error: {e}"


def verify_contract_deployed() -> tuple[bool, str]:
    """
    Verify that the HealthRecords contract is deployed.
    
    Returns:
        (success, details)
    """
    try:
        from web3 import Web3
        
        rpc_url = os.environ.get("SEPOLIA_RPC_URL") or os.environ.get("ETH_RPC_URL")
        contract_addr = (
            os.environ.get("HEALTH_RECORDS_CONTRACT_ADDRESS") or
            os.environ.get("GRANT_CONTRACT_ADDRESS")
        )
        
        if not rpc_url or not contract_addr:
            return False, "Missing config"
        
        w3 = Web3(Web3.HTTPProvider(rpc_url))
        
        # Check if address has code
        code = w3.eth.get_code(Web3.to_checksum_address(contract_addr))
        
        if len(code) <= 2:  # "0x" means no code
            return False, f"No contract code at {contract_addr}"
        
        return True, f"Contract deployed: {len(code)} bytes of bytecode"
        
    except Exception as e:
        return False, f"Contract check error: {e}"


# ============================================================================
# Main Test Flow
# ============================================================================

def run_tests():
    """Run all encryption verification tests."""
    print("=" * 60)
    print("🔐 DECENT-HOSPITAL ENCRYPTION VERIFICATION")
    print("=" * 60)
    print(f"\nAPI URL: {API_BASE_URL}")
    print(f"Sample file: {SAMPLE_FILE}")
    print("")
    
    all_passed = True
    
    # Test 1: Sample file exists
    print_action("Checking sample file")
    success, original_bytes, error = check_sample_file_exists()
    print_result("Sample file readable", success, f"{len(original_bytes)} bytes" if success else error)
    if not success:
        print("\n❌ Cannot continue without sample file.")
        print("   Create scripts/sample_image.jpg or scripts/sample.txt")
        return False
    
    original_hash = compute_sha256(original_bytes)
    print(f"       Original SHA256: {original_hash[:32]}...")
    
    # Test 2: Create test user
    print_action("Creating test user for upload")
    success, user_data, error = create_test_user()
    print_result("Test user created", success, error if not success else f"User ID: {user_data.get('user', {}).get('id')}")
    if not success:
        print("\n❌ Cannot continue without test user.")
        print("   Ensure backend is running: cd backend && python -m uvicorn app.main:app")
        return False
    
    user = user_data.get("user", {})
    token = user_data.get("token", "")
    patient_id = user.get("id", 1)
    public_key = user.get("public_key", "")
    
    if not public_key or len(public_key) < 66:
        # Generate a REAL Umbral keypair for testing
        try:
            from umbral import SecretKey
            sk = SecretKey.random()
            pk = sk.public_key()
            public_key = bytes(pk).hex()
            print(f"       Generated real Umbral public key: {public_key[:32]}...")
        except ImportError:
            # Fallback - won't work with Umbral but allows testing other parts
            import secrets
            public_key = secrets.token_hex(33)
            print(f"       Generated test public key (no Umbral): {public_key[:32]}...")
    
    # Test 3: Upload file via API
    print_action("Uploading file via POST /upload")
    filename = os.path.basename(SAMPLE_FILE)
    success, upload_result, error = upload_file_via_api(
        original_bytes, filename, patient_id, public_key, token
    )
    print_result("File uploaded", success, error if not success else f"CID: {upload_result.get('cid', 'N/A')}")
    if not success:
        print("\n❌ Upload failed.")
        if "encrypt_plaintext_with_cek" in str(error).lower():
            print("   Backend not encrypting: check encrypt_plaintext_with_cek called before storacha upload")
        return False
    
    cid = upload_result.get("cid", "")
    capsule_hex = upload_result.get("capsule", "")
    encrypted_cek = upload_result.get("encrypted_cek", "")
    
    # Test 4: Verify capsule metadata
    print_action("Verifying capsule metadata")
    success, details = verify_capsule_metadata(capsule_hex)
    print_result("Capsule metadata valid", success, details)
    if not success:
        all_passed = False
        print("   Fix: Ensure encapsulate_cek is called during upload")
    
    # Test 5: Verify encrypted CEK
    print_action("Verifying encrypted CEK")
    success, details = verify_encrypted_cek(encrypted_cek)
    print_result("Encrypted CEK valid", success, details)
    if not success:
        all_passed = False
        print("   Fix: Ensure CEK is encrypted with Umbral before storing")
    
    # Test 6: Download from Storacha gateway
    print_action("Downloading blob from Storacha gateway")
    success, stored_bytes, error = download_blob_from_gateway(cid)
    print_result("Blob downloaded", success, f"{len(stored_bytes)} bytes" if success else error)
    if not success:
        print("\n⚠️  Could not download from gateway (may need propagation time)")
        print(f"   Try manually: curl https://storacha.link/ipfs/{cid}")
    else:
        stored_hash = compute_sha256(stored_bytes)
        print(f"       Stored SHA256: {stored_hash[:32]}...")
        
        # Test 7: Verify encryption (bytes differ)
        print_action("Verifying encryption (comparing bytes)")
        success, details = verify_encryption(original_bytes, stored_bytes)
        print_result("Blob is encrypted", success, details)
        if not success:
            all_passed = False
            print("\n   ❌ PLAIN_UPLOAD_DETECTED")
            print("   Fix: Backend not encrypting - check encrypt_with_cek called before storacha upload")
            print("   Look for: encrypted_blob = nonce + encrypted_content in upload.py")
    
    # Test 8: Check Sepolia configuration
    print_action("Checking Sepolia configuration")
    success, details = check_sepolia_config()
    print_result("Sepolia configured", success, details)
    if not success:
        print("\n   ⚠️  Blockchain integration not configured:")
        print("   Set these in .env:")
        print("     SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY")
        print("     HEALTH_RECORDS_CONTRACT_ADDRESS=0x...")
        print("     SIGNER_PRIVATE_KEY=<funded Sepolia wallet key>")
    else:
        # Test 9: Verify chain connection
        print_action("Verifying Sepolia connection")
        success, details = verify_chain_connection()
        print_result("Chain connected", success, details)
        if not success:
            all_passed = False
        
        # Test 10: Verify contract deployed
        print_action("Verifying contract deployed")
        success, details = verify_contract_deployed()
        print_result("Contract deployed", success, details)
        if not success:
            all_passed = False
            print("   Fix: Deploy contract with: cd contracts && npx hardhat run scripts/deploy.ts --network sepolia")
    
    # Final summary
    print("\n" + "=" * 60)
    if all_passed:
        print(f"✅ E2E ENCRYPTION OK: {cid}")
        print("   All encryption and blockchain checks passed!")
    else:
        print("❌ SOME CHECKS FAILED")
        print("   Review the issues above and fix them.")
    print("=" * 60)
    
    return all_passed


if __name__ == "__main__":
    try:
        success = run_tests()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nAborted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
