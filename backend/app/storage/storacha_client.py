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


def _check_configuration() -> tuple[str, str, str]:
    """
    Check that required environment variables are set.
    
    Returns:
        Tuple of (principal, proof, gateway_url)
    
    Raises:
        StorachaConfigError if required variables are missing.
    """
    principal = os.environ.get("STORACHA_PRINCIPAL")
    proof = os.environ.get("STORACHA_PROOF")
    gateway_url = os.environ.get("STORACHA_GATEWAY_URL", DEFAULT_GATEWAY_URL)
    
    if not principal:
        print("Set STORACHA_PRINCIPAL in .env", file=sys.stderr)
        raise StorachaConfigError(
            "STORACHA_PRINCIPAL not set. "
            "Generate with: storacha key create --json"
        )
    
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
    
    Args:
        bytes_data: The bytes to upload
        filename: Original filename (preserved in IPFS directory)
    
    Returns:
        dict with keys:
            - cid: The IPFS Content Identifier (CIDv1)
            - size: Size in bytes
    
    Raises:
        StorachaConfigError: If environment variables not configured
        StorachaUploadError: If upload fails after retries
        StorachaVerificationError: If post-upload verification fails
    """
    # Check configuration
    principal, proof, gateway_url = _check_configuration()
    
    # Check CLI is installed
    if not _check_cli_installed():
        raise StorachaError(
            "Storacha CLI not installed. Install with: npm install -g @storacha/cli"
        )
    
    size = len(bytes_data)
    original_hash = _compute_sha256(bytes_data)
    
    logger.info(f"Uploading {filename} ({size} bytes) to Storacha...")
    
    last_error = None
    
    for attempt in range(MAX_RETRIES):
        # Create a temporary directory for isolated CLI state
        # This avoids conflicts with any existing stored principal
        with tempfile.TemporaryDirectory(prefix="storacha_") as temp_store_dir:
            try:
                # Create temporary file for upload
                with tempfile.NamedTemporaryFile(
                    mode='wb',
                    suffix=f"_{filename}",
                    delete=False,
                    dir=temp_store_dir
                ) as tmp_file:
                    tmp_file.write(bytes_data)
                    tmp_path = tmp_file.name
                
                # Set up isolated environment with custom store path
                cli_env = {
                    **os.environ,
                    "STORACHA_PRINCIPAL": principal,
                    # Use XDG_CONFIG_HOME to isolate the CLI store
                    "XDG_CONFIG_HOME": temp_store_dir,
                    "HOME": temp_store_dir,  # Fallback for some systems
                }
                
                try:
                    # First, import the proof to set up the space
                    import_result = subprocess.run(
                        ["storacha", "space", "add", proof],
                        capture_output=True,
                        text=True,
                        timeout=REQUEST_TIMEOUT,
                        env=cli_env
                    )
                    
                    if import_result.returncode != 0:
                        # Log but don't fail - space might already be added
                        logger.debug(f"Space add output: {import_result.stderr}")
                    
                    # Upload using CLI with JSON output
                    # Use --no-wrap to get direct file CID (not wrapped in directory)
                    result = subprocess.run(
                        ["storacha", "up", tmp_path, "--json", "--no-wrap"],
                        capture_output=True,
                        text=True,
                        timeout=REQUEST_TIMEOUT,
                        env=cli_env
                    )
                    
                    if result.returncode != 0:
                        raise StorachaUploadError(
                            f"CLI upload failed: {result.stderr}"
                        )
                    
                    # Parse JSON output to get CID
                    try:
                        output = json.loads(result.stdout)
                        # The CLI outputs {"root": {"/": "<cid>"}}
                        if isinstance(output, dict) and "root" in output:
                            root = output["root"]
                            if isinstance(root, dict) and "/" in root:
                                cid = root["/"]
                            else:
                                cid = str(root)
                        else:
                            # Try to extract CID from stdout
                            cid = result.stdout.strip()
                    except json.JSONDecodeError:
                        # If not JSON, try to extract CID from output
                        # CLI might output URL like https://storacha.link/ipfs/<cid>
                        output_lines = result.stdout.strip().split('\n')
                        for line in output_lines:
                            if "ipfs/" in line:
                                cid = line.split("ipfs/")[-1].split()[0]
                                break
                            elif line.startswith("bafy"):
                                cid = line.strip()
                                break
                        else:
                            raise StorachaUploadError(
                                f"Could not parse CID from output: {result.stdout}"
                            )
                    
                    logger.info(f"Upload successful. CID: {cid}")
                    
                    # Verify upload by downloading and checking hash
                    logger.info("Verifying upload integrity...")
                    try:
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
    
    # Get gateway URL from environment
    gateway_url = os.environ.get("STORACHA_GATEWAY_URL", DEFAULT_GATEWAY_URL)
    
    # Construct gateway URL
    # Try subdomain style first (recommended), fall back to path style
    # Subdomain: https://<cid>.ipfs.storacha.link
    # Path: https://storacha.link/ipfs/<cid>
    
    # Extract hostname for subdomain URL
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
    
    last_error = None
    
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(
                url,
                timeout=REQUEST_TIMEOUT,
                headers={
                    "Accept": "*/*",
                    "User-Agent": "StorachaClient/1.0"
                }
            )
            
            if response.status_code == 200:
                data = response.content
                logger.info(f"Download successful. Size: {len(data)} bytes")
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
                f"Download attempt {attempt + 1} failed. "
                f"Retrying in {delay}s... Error: {last_error}"
            )
            time.sleep(delay)
    
    raise last_error or StorachaDownloadError("Download failed after all retries")


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
