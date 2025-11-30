"""
Storacha Client for Python Backend

This module provides upload and download functionality for Storacha (web3.storage successor).

IMPORTANT: Storacha uses UCAN-based authentication, NOT simple API keys.
There is no official Python SDK or REST API with bearer tokens.

This implementation uses:
- Storacha CLI (subprocess) for uploads - official supported method
- IPFS Gateway (HTTP) for downloads - official documented method

Prerequisites:
1. Install the Storacha CLI: npm install -g @storacha/cli
2. Set up authentication:
   - Run: storacha login <your-email>
   - Create a space: storacha space create <name>
   - For CI/backend: generate key and proof (see setup instructions below)

Environment Variables Required:
- STORACHA_PRINCIPAL: The signing key (starts with "Mg...")
- STORACHA_PROOF: The base64-encoded UCAN delegation proof
- STORACHA_GATEWAY_URL: Gateway URL (default: https://storacha.link)

Documentation Sources:
- https://docs.storacha.network/how-to/ci/
- https://docs.storacha.network/how-to/retrieve/
- https://docs.storacha.network/concepts/architecture-options/
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from typing import Optional
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Retry configuration
MAX_RETRIES = 3
INITIAL_BACKOFF = 1  # seconds
MAX_BACKOFF = 10  # seconds
REQUEST_TIMEOUT = 60  # seconds

# Default gateway URL for downloads
DEFAULT_GATEWAY_URL = "https://storacha.link"

# Fallback gateways when primary fails (in order of preference)
FALLBACK_GATEWAYS = [
    "https://ipfs.io",           # Protocol Labs gateway
    "https://dweb.link",         # Protocol Labs dweb gateway
    "https://cloudflare-ipfs.com",  # Cloudflare gateway
]


class StorachaError(Exception):
    """Base exception for Storacha client errors."""
    pass


class StorachaConfigError(StorachaError):
    """Configuration error - missing environment variables."""
    pass


class StorachaUploadError(StorachaError):
    """Upload failed after retries."""
    pass


class StorachaDownloadError(StorachaError):
    """Download failed after retries."""
    pass


class StorachaVerificationError(StorachaError):
    """Content verification failed."""
    pass


def _check_configuration() -> tuple[Optional[str], str, str]:
    """
    Check that required environment variables are set.
    
    Returns:
        Tuple of (principal, proof, gateway_url)
        Note: principal is optional - the proof contains delegation info
    
    Raises:
        StorachaConfigError if proof is missing.
    """
    principal = os.environ.get("STORACHA_PRINCIPAL")  # Optional now
    proof = os.environ.get("STORACHA_PROOF")
    gateway_url = os.environ.get("STORACHA_GATEWAY_URL", DEFAULT_GATEWAY_URL)
    
    # Principal is optional - the proof contains the delegation
    if principal:
        logger.debug("STORACHA_PRINCIPAL is set (will be ignored, using proof-based auth)")
    
    if not proof:
        print("Set STORACHA_PROOF in .env", file=sys.stderr)
        raise StorachaConfigError(
            "STORACHA_PROOF not set. "
            "Generate with: storacha delegation create <DID> -c space/blob/add "
            "-c space/index/add -c upload/add -c filecoin/offer --base64"
        )
    
    return principal, proof, gateway_url


def _check_cli_installed() -> bool:
    """Check if storacha CLI is installed."""
    try:
        result = subprocess.run(
            ["storacha", "--version"],
            capture_output=True,
            text=True,
            timeout=10
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def _exponential_backoff(attempt: int) -> float:
    """Calculate exponential backoff delay."""
    delay = min(INITIAL_BACKOFF * (2 ** attempt), MAX_BACKOFF)
    return delay


def _compute_sha256(data: bytes) -> str:
    """Compute SHA256 hash of data for integrity verification."""
    return hashlib.sha256(data).hexdigest()


def upload_blob(bytes_data: bytes, filename: str) -> dict:
    """
    Upload encrypted blob to Storacha and return CID.
    
    Uses the Storacha CLI for upload (official supported method for backend).
    Implements retry logic with exponential backoff.
    
    The CLI uses the already-logged-in principal from ~/.config/w3access/.
    Run `storacha login` and `storacha space create` to set up before first use.
    
    Reference: https://docs.storacha.network/how-to/ci/
    
    Args:
        bytes_data: The bytes to upload
        filename: Original filename (preserved in IPFS directory)
    
    Returns:
        dict with keys:
            - cid: The IPFS Content Identifier (CIDv1)
            - size: Size in bytes
    
    Raises:
        StorachaConfigError: If CLI not logged in
        StorachaUploadError: If upload fails after retries
        StorachaVerificationError: If post-upload verification fails
    """
    # Check CLI is installed
    if not _check_cli_installed():
        raise StorachaError(
            "Storacha CLI not installed. Install with: npm install -g @storacha/cli"
        )
    
    # Check that CLI is logged in (has a current space)
    try:
        # Create clean environment without STORACHA_PRINCIPAL to avoid conflicts
        # with the locally logged-in principal
        clean_env = {k: v for k, v in os.environ.items() if not k.startswith("STORACHA_PRINCIPAL")}
        
        whoami_result = subprocess.run(
            ["storacha", "whoami"],
            capture_output=True,
            text=True,
            timeout=10,
            env=clean_env
        )
        if whoami_result.returncode != 0 or "did:key" not in whoami_result.stdout:
            raise StorachaConfigError(
                f"Storacha CLI not logged in. Run: storacha login <email>. Error: {whoami_result.stderr}"
            )
        logger.debug(f"Using agent: {whoami_result.stdout.strip()}")
        
        # Check current space
        space_result = subprocess.run(
            ["storacha", "space", "ls"],
            capture_output=True,
            text=True,
            timeout=10,
            env=clean_env
        )
        if space_result.returncode != 0 or not space_result.stdout.strip():
            raise StorachaConfigError(
                "No Storacha space available. Run: storacha space create <name>"
            )
        logger.debug(f"Available spaces:\n{space_result.stdout.strip()}")
    except subprocess.TimeoutExpired:
        raise StorachaError("Storacha CLI timed out checking configuration")
    
    size = len(bytes_data)
    original_hash = _compute_sha256(bytes_data)
    
    logger.info(f"Uploading {filename} ({size} bytes) to Storacha...")
    
    # Create clean environment without STORACHA_PRINCIPAL to avoid conflicts
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith("STORACHA_PRINCIPAL")}
    
    last_error = None
    
    for attempt in range(MAX_RETRIES):
        try:
            # Create temporary file for upload
            with tempfile.NamedTemporaryFile(
                mode='wb',
                suffix=f"_{filename}",
                delete=False
            ) as tmp_file:
                tmp_file.write(bytes_data)
                tmp_path = tmp_file.name
            
            try:
                # Upload using CLI with JSON output
                # Use --no-wrap to get direct file CID (not wrapped in directory)
                logger.debug(f"Uploading file: {tmp_path}")
                result = subprocess.run(
                    ["storacha", "up", tmp_path, "--json", "--no-wrap"],
                    capture_output=True,
                    text=True,
                    timeout=REQUEST_TIMEOUT,
                    env=clean_env
                )
                
                if result.returncode != 0:
                    raise StorachaUploadError(
                        f"CLI upload failed: {result.stderr}"
                    )
                
                # Parse JSON output to get CID
                cid = _parse_upload_output(result.stdout)
                
                logger.info(f"Upload successful. CID: {cid}")
                
                # Verify upload by downloading and checking hash
                logger.info("Verifying upload integrity...")
                try:
                    # Wait a bit for propagation
                    time.sleep(2)
                    downloaded = download_blob(cid)
                    downloaded_hash = _compute_sha256(downloaded)
                    
                    if downloaded_hash != original_hash:
                        raise StorachaVerificationError(
                            f"Hash mismatch after upload. "
                            f"Original: {original_hash}, Downloaded: {downloaded_hash}"
                        )
                    
                    logger.info("Verification successful.")
                except StorachaDownloadError as e:
                    # Verification download failed - might need to wait for propagation
                    logger.warning(
                        f"Could not verify upload immediately: {e}. "
                        "Content may still be propagating."
                    )
                
                return {"cid": cid, "size": size}
                
            finally:
                # Clean up temp file
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                        
        except subprocess.TimeoutExpired:
            last_error = StorachaUploadError(
                f"Upload timed out after {REQUEST_TIMEOUT}s"
            )
        except StorachaVerificationError:
            raise  # Don't retry verification failures
        except Exception as e:
            last_error = StorachaUploadError(f"Upload failed: {e}")
        
        if attempt < MAX_RETRIES - 1:
            delay = _exponential_backoff(attempt)
            logger.warning(
                f"Upload attempt {attempt + 1} failed. "
                f"Retrying in {delay}s... Error: {last_error}"
            )
            time.sleep(delay)
    
    raise last_error or StorachaUploadError("Upload failed after all retries")


def _parse_upload_output(stdout: str) -> str:
    """
    Parse the CID from storacha CLI upload output.
    
    The CLI outputs JSON like: {"root": {"/": "<cid>"}}
    Or may output a URL like: https://bafyxxx.ipfs.storacha.link
    """
    stdout = stdout.strip()
    
    # Try JSON parse first
    try:
        output = json.loads(stdout)
        # The CLI outputs {"root": {"/": "<cid>"}}
        if isinstance(output, dict) and "root" in output:
            root = output["root"]
            if isinstance(root, dict) and "/" in root:
                return root["/"]
            else:
                return str(root)
        elif isinstance(output, str):
            return output
    except json.JSONDecodeError:
        pass
    
    # Try to extract CID from output lines
    for line in stdout.split('\n'):
        line = line.strip()
        # URL format: https://bafyxxx.ipfs.storacha.link
        if "ipfs.storacha.link" in line or "ipfs.w3s.link" in line:
            # Extract CID from subdomain
            import re
            match = re.search(r'https://([^.]+)\.ipfs\.', line)
            if match:
                return match.group(1)
        # Path format: https://storacha.link/ipfs/<cid>
        if "ipfs/" in line:
            cid = line.split("ipfs/")[-1].split()[0].split("?")[0]
            if cid.startswith("bafy"):
                return cid
        # Raw CID
        if line.startswith("bafy"):
            return line.split()[0]
    
    raise StorachaUploadError(f"Could not parse CID from output: {stdout}")


def download_blob(cid: str) -> bytes:
    """
    Download blob from Storacha/IPFS by CID.
    
    Uses the IPFS HTTP Gateway for retrieval (official documented method).
    Implements retry logic with exponential backoff.
    
    Args:
        cid: The IPFS Content Identifier
    
    Returns:
        The downloaded bytes
    
    Raises:
        StorachaDownloadError: If download fails after retries
    """
    # Import here to avoid issues if requests not installed
    try:
        import requests
    except ImportError:
        raise StorachaError(
            "requests library required. Install with: pip install requests"
        )
    
    # Get primary gateway URL from environment
    primary_gateway = os.environ.get("STORACHA_GATEWAY_URL", DEFAULT_GATEWAY_URL)
    
    # Build list of gateways to try (primary + fallbacks)
    gateways = [primary_gateway] + FALLBACK_GATEWAYS
    
    last_error = None
    
    for gateway_url in gateways:
        # Extract hostname for URL construction
        if gateway_url.startswith("https://"):
            host = gateway_url[8:]
        elif gateway_url.startswith("http://"):
            host = gateway_url[7:]
        else:
            host = gateway_url
        
        # Remove trailing slash
        host = host.rstrip("/")
        
        # Try path-style URL (more reliable for programmatic access)
        url = f"https://{host}/ipfs/{cid}"
        
        logger.info(f"Downloading CID {cid} from {url}...")
        
        for attempt in range(MAX_RETRIES):
            try:
                response = requests.get(
                    url,
                    timeout=REQUEST_TIMEOUT,
                    headers={
                        "Accept": "*/*",
                        "User-Agent": "StorachaClient/1.0"
                    },
                    allow_redirects=False,  # Don't follow redirects to broken subdomain URLs
                )
                
                # If we get a redirect, try the next gateway instead
                if response.status_code in (301, 302, 307, 308):
                    logger.warning(f"Gateway {host} redirected, trying next gateway...")
                    break  # Try next gateway
                
                if response.status_code == 200:
                    data = response.content
                    logger.info(f"Download successful from {host}. Size: {len(data)} bytes")
                    return data
                elif response.status_code == 404:
                    raise StorachaDownloadError(
                        f"CID not found: {cid}. "
                        "Content may not exist or still propagating."
                    )
                elif response.status_code == 429:
                    # Rate limited - use longer backoff
                    raise StorachaDownloadError(
                        f"Rate limited by gateway. Status: {response.status_code}"
                    )
                else:
                    raise StorachaDownloadError(
                        f"Gateway returned status {response.status_code}: "
                        f"{response.text[:200]}"
                    )
                    
            except requests.Timeout:
                last_error = StorachaDownloadError(
                    f"Download timed out after {REQUEST_TIMEOUT}s"
                )
            except requests.RequestException as e:
                last_error = StorachaDownloadError(f"Download failed: {e}")
            except StorachaDownloadError as e:
                last_error = e
            
            if attempt < MAX_RETRIES - 1:
                delay = _exponential_backoff(attempt)
                logger.warning(
                    f"Download attempt {attempt + 1} from {host} failed. "
                    f"Retrying in {delay}s... Error: {last_error}"
                )
                time.sleep(delay)
        
        # If we exhausted retries on this gateway, try next one
        logger.warning(f"Gateway {host} failed after retries, trying next gateway...")
    
    raise last_error or StorachaDownloadError("Download failed after all gateways and retries")


def remove_blob(cid: str) -> bool:
    """
    Remove/unpin a blob from Storacha space.
    
    This uses the `storacha rm` command to remove a CID from your space.
    Note: This only removes your reference to the content. If other users
    have pinned the same content, it will still be available on IPFS.
    
    IMPORTANT: Call this when:
    - A file is being replaced (re-encrypted with new CEK)
    - A grant is fully revoked and old encrypted data should be removed
    - Cleaning up old/orphaned content
    
    Args:
        cid: The IPFS Content Identifier to remove
        
    Returns:
        True if removal succeeded
        
    Raises:
        StorachaError: If removal fails
    """
    if not _check_cli_installed():
        raise StorachaError(
            "Storacha CLI not installed. Install with: npm install -g @storacha/cli"
        )
    
    logger.info(f"Removing CID {cid} from Storacha space...")
    
    # Create clean environment
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith("STORACHA_PRINCIPAL")}
    
    try:
        result = subprocess.run(
            ["storacha", "rm", cid],
            capture_output=True,
            text=True,
            timeout=REQUEST_TIMEOUT,
            env=clean_env
        )
        
        if result.returncode == 0:
            logger.info(f"Successfully removed CID {cid}")
            return True
        else:
            # Check if it's a "not found" error (already removed or never existed)
            stderr_lower = result.stderr.lower()
            if "not found" in stderr_lower or "does not exist" in stderr_lower:
                logger.warning(f"CID {cid} was not found in space (may already be removed)")
                return True  # Consider this a success
            
            logger.error(f"Failed to remove CID {cid}: {result.stderr}")
            raise StorachaError(f"Failed to remove CID: {result.stderr}")
            
    except subprocess.TimeoutExpired:
        raise StorachaError(f"Remove operation timed out after {REQUEST_TIMEOUT}s")
    except Exception as e:
        raise StorachaError(f"Failed to remove CID: {e}")


def list_uploads() -> list[dict]:
    """
    List all uploads in the current Storacha space.
    
    Useful for auditing and cleanup operations.
    
    Returns:
        List of upload records with CID and metadata
        
    Raises:
        StorachaError: If listing fails
    """
    if not _check_cli_installed():
        raise StorachaError(
            "Storacha CLI not installed. Install with: npm install -g @storacha/cli"
        )
    
    logger.info("Listing uploads in Storacha space...")
    
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith("STORACHA_PRINCIPAL")}
    
    try:
        result = subprocess.run(
            ["storacha", "ls", "--json"],
            capture_output=True,
            text=True,
            timeout=REQUEST_TIMEOUT,
            env=clean_env
        )
        
        if result.returncode != 0:
            raise StorachaError(f"Failed to list uploads: {result.stderr}")
        
        # Parse JSON output
        uploads = []
        for line in result.stdout.strip().split('\n'):
            if line:
                try:
                    upload = json.loads(line)
                    uploads.append(upload)
                except json.JSONDecodeError:
                    # If not JSON, might be a raw CID
                    if line.startswith("bafy"):
                        uploads.append({"cid": line})
        
        logger.info(f"Found {len(uploads)} uploads")
        return uploads
        
    except subprocess.TimeoutExpired:
        raise StorachaError(f"List operation timed out after {REQUEST_TIMEOUT}s")
    except Exception as e:
        raise StorachaError(f"Failed to list uploads: {e}")


def verify_blob(cid: str, expected_data: bytes) -> bool:
    """
    Verify that a CID contains the expected data.
    
    Args:
        cid: The IPFS Content Identifier
        expected_data: The expected bytes
    
    Returns:
        True if verification passes
    
    Raises:
        StorachaVerificationError: If verification fails
    """
    downloaded = download_blob(cid)
    
    expected_hash = _compute_sha256(expected_data)
    actual_hash = _compute_sha256(downloaded)
    
    if expected_hash != actual_hash:
        raise StorachaVerificationError(
            f"Hash mismatch. Expected: {expected_hash}, Got: {actual_hash}"
        )
    
    return True


# ============================================================================
# Setup Instructions
# ============================================================================
SETUP_INSTRUCTIONS = """
================================================================================
STORACHA BACKEND SETUP INSTRUCTIONS
================================================================================

Storacha uses UCAN-based authentication, not simple API keys.
Follow these steps to set up your backend:

1. INSTALL THE CLI:
   npm install -g @storacha/cli

2. CREATE AN ACCOUNT (one-time, on your local machine):
   storacha login your-email@example.com
   # Click the link in your email to verify

3. CREATE A SPACE:
   storacha space create my-hospital-storage

4. GENERATE A SIGNING KEY FOR YOUR BACKEND:
   storacha key create --json
   # Output: {"did": "did:key:z6Mk...", "key": "MgCaT7..."}
   # Save the "key" value as STORACHA_PRINCIPAL

5. DELEGATE PERMISSIONS TO THAT KEY:
   AUDIENCE="did:key:z6Mk..."  # The "did" from step 4
   storacha delegation create $AUDIENCE \\
     -c space/blob/add \\
     -c space/index/add \\
     -c upload/add \\
     -c filecoin/offer \\
     --base64
   # Save the output as STORACHA_PROOF

6. ADD TO YOUR .env FILE:
   STORACHA_PRINCIPAL=MgCaT7...  # The "key" from step 4
   STORACHA_PROOF=mAYIEAP8OEaJ...  # The base64 proof from step 5
   STORACHA_GATEWAY_URL=https://storacha.link  # Optional, this is default

7. TEST YOUR SETUP:
   python scripts/test_storage.py

Documentation: https://docs.storacha.network/how-to/ci/
================================================================================
"""


def print_setup_instructions():
    """Print setup instructions to stderr."""
    print(SETUP_INSTRUCTIONS, file=sys.stderr)


if __name__ == "__main__":
    print_setup_instructions()
