"""
Storacha Storage Utilities

This module provides functions for uploading files to IPFS
via the Storacha CLI (@storacha/cli).

Storacha uses UCAN-based authentication, so we shell out to the
`storacha` CLI which handles the cryptographic auth.

Setup:
1. npm install -g @storacha/cli
2. storacha login your-email@example.com
3. storacha space create my-space

Environment Variables:
- STORACHA_CLI_PATH: Path to storacha binary (default: "storacha")
- DEV_MODE: If "true", use local file storage instead of Storacha
- LOCAL_STORAGE_DIR: Directory for dev mode storage (default: /tmp/decent-hospital-storage)
"""

import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict

import requests

# ============================================================================
# Configuration
# ============================================================================

# CID validation pattern (CIDv0 or CIDv1)
CID_PATTERN = re.compile(r"^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$")

# Local storage directory for dev mode
LOCAL_STORAGE_DIR = Path(os.getenv("LOCAL_STORAGE_DIR", "/tmp/decent-hospital-storage"))


def is_dev_mode() -> bool:
    """Check if running in development mode (local storage)."""
    return os.getenv("DEV_MODE", "").lower() in ("true", "1", "yes")


def get_storacha_cli() -> str:
    """Get path to storacha CLI binary."""
    return os.getenv("STORACHA_CLI_PATH", "storacha")


def check_storacha_cli() -> bool:
    """Check if storacha CLI is available and configured."""
    try:
        result = subprocess.run(
            [get_storacha_cli(), "space", "ls"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0 and "*" in result.stdout
    except (subprocess.SubprocessError, FileNotFoundError):
        return False


# ============================================================================
# Local Storage (Dev Mode)
# ============================================================================


def _generate_fake_cid(data: bytes) -> str:
    """Generate a fake CIDv1-like string from data hash for dev mode."""
    hash_hex = hashlib.sha256(data).hexdigest()
    # Create a fake bafy... CID (not a real CID, just looks like one)
    return f"bafydev{hash_hex[:52]}"


def _ensure_local_storage_dir():
    """Ensure local storage directory exists."""
    LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def upload_to_local_storage(data: bytes, filename: str = "data.bin") -> Dict[str, Any]:
    """
    Store data locally and return a fake CID (dev mode only).
    
    Args:
        data: Bytes to store
        filename: Original filename
        
    Returns:
        Dict with fake cid, name, size
    """
    _ensure_local_storage_dir()
    
    fake_cid = _generate_fake_cid(data)
    file_path = LOCAL_STORAGE_DIR / fake_cid
    
    # Store the file
    file_path.write_bytes(data)
    
    # Also store metadata
    meta_path = LOCAL_STORAGE_DIR / f"{fake_cid}.meta.json"
    meta_path.write_text(json.dumps({
        "filename": filename,
        "size": len(data),
        "cid": fake_cid,
    }))
    
    return {
        "cid": fake_cid,
        "name": filename,
        "size": len(data),
        "dev_mode": True,
    }


def download_from_local_storage(cid: str) -> bytes:
    """
    Retrieve data from local storage (dev mode only).
    
    Args:
        cid: The fake CID from upload
        
    Returns:
        File content as bytes
    """
    file_path = LOCAL_STORAGE_DIR / cid
    if not file_path.exists():
        raise FileNotFoundError(f"File not found in local storage: {cid}")
    return file_path.read_bytes()


# ============================================================================
# Storacha CLI Upload Functions
# ============================================================================


def upload_to_storacha(file_path: str) -> Dict[str, Any]:
    """
    Upload a file to Storacha using the CLI.

    Args:
        file_path: Path to the file to upload.

    Returns:
        Dict containing:
        - cid: IPFS Content Identifier (CID)
        - name: Original filename
        - size: File size in bytes

    Raises:
        FileNotFoundError: If file doesn't exist.
        RuntimeError: If storacha CLI fails.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    filename = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)
    
    # In dev mode, use local storage
    if is_dev_mode():
        with open(file_path, "rb") as f:
            data = f.read()
        return upload_to_local_storage(data, filename)

    # Use storacha CLI
    try:
        result = subprocess.run(
            [get_storacha_cli(), "up", file_path, "--no-wrap", "--json"],
            capture_output=True,
            text=True,
            timeout=300,
        )
        
        if result.returncode != 0:
            raise RuntimeError(f"Storacha upload failed: {result.stderr}")
        
        # Parse JSON output
        output = json.loads(result.stdout)
        cid = output.get("root", {}).get("/") or output.get("cid")
        
        if not cid:
            # Try to extract CID from URL in output
            url_match = re.search(r"https://([^.]+)\.ipfs\.", result.stdout)
            if url_match:
                cid = url_match.group(1)
            else:
                raise RuntimeError(f"Could not extract CID from output: {result.stdout}")
        
        return {
            "cid": cid,
            "name": filename,
            "size": file_size,
            "response": output,
        }
        
    except subprocess.TimeoutExpired:
        raise RuntimeError("Storacha upload timed out")
    except json.JSONDecodeError:
        # CLI might output URL instead of JSON
        lines = result.stdout.strip().split("\n")
        for line in lines:
            if "ipfs" in line.lower():
                # Extract CID from URL like https://bafyxxx.ipfs.storacha.link
                match = re.search(r"https://([^.]+)\.ipfs\.", line)
                if match:
                    cid = match.group(1)
                    return {
                        "cid": cid,
                        "name": filename,
                        "size": file_size,
                        "url": line.strip(),
                    }
        raise RuntimeError(f"Could not parse storacha output: {result.stdout}")


def upload_bytes_to_storacha(
    data: bytes,
    filename: str = "data.bin",
) -> Dict[str, Any]:
    """
    Upload raw bytes to Storacha.

    Writes bytes to a temp file and uploads via CLI.

    Args:
        data: Bytes to upload.
        filename: Optional name for the upload.

    Returns:
        Dict containing:
        - cid: IPFS Content Identifier (CID)
        - name: Provided filename
        - size: Data size in bytes
    """
    # In dev mode, use local storage directly
    if is_dev_mode():
        return upload_to_local_storage(data, filename)
    
    # Write to temp file and upload
    with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{filename}") as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    
    try:
        result = upload_to_storacha(tmp_path)
        result["name"] = filename
        return result
    finally:
        os.unlink(tmp_path)


# Aliases for backwards compatibility
upload_to_web3_storage = upload_to_storacha
upload_bytes_to_web3_storage = upload_bytes_to_storacha


# ============================================================================
# IPFS Gateway Functions
# ============================================================================


def get_ipfs_gateway_url(cid: str, gateway: str = "storacha.link") -> str:
    """
    Get a public gateway URL for an IPFS CID.

    Args:
        cid: IPFS Content Identifier.
        gateway: Gateway domain to use.

    Returns:
        Full gateway URL.

    Example:
        >>> get_ipfs_gateway_url("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
        "https://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.ipfs.storacha.link"
    """
    return f"https://{cid}.ipfs.{gateway}"


def download_from_ipfs(cid: str, gateway: str = "storacha.link") -> bytes:
    """
    Download file content from IPFS via gateway or local storage.

    Args:
        cid: IPFS Content Identifier.
        gateway: Gateway domain to use.

    Returns:
        File content as bytes.

    Raises:
        requests.HTTPError: If download fails.
    """
    # Check local storage first (for dev mode CIDs)
    if cid.startswith("bafydev"):
        return download_from_local_storage(cid)
    
    url = get_ipfs_gateway_url(cid, gateway)
    response = requests.get(url, timeout=300)
    response.raise_for_status()
    return response.content


# ============================================================================
# CID Validation
# ============================================================================


def is_valid_cid(cid: str) -> bool:
    """
    Validate that a string looks like an IPFS CID.

    Supports CIDv0 (Qm...), CIDv1 (bafy...), and dev mode (bafydev...).

    Args:
        cid: String to validate

    Returns:
        True if valid CID format, False otherwise
    """
    if not cid:
        return False
    
    # Accept dev mode CIDs
    if cid.startswith("bafydev"):
        return True
        
    return bool(CID_PATTERN.match(cid))


def validate_cid(cid: str) -> str:
    """
    Validate CID and return it if valid, raise otherwise.

    Args:
        cid: String to validate

    Returns:
        The validated CID string

    Raises:
        ValueError: If CID format is invalid
    """
    if not is_valid_cid(cid):
        raise ValueError(f"Invalid IPFS CID format: {cid}")
    return cid


# ============================================================================
# Status Functions
# ============================================================================


def get_storage_status() -> Dict[str, Any]:
    """
    Get the current storage configuration status.
    
    Returns:
        Dict with status information
    """
    if is_dev_mode():
        return {
            "mode": "dev",
            "storage": "local",
            "storage_dir": str(LOCAL_STORAGE_DIR),
            "ready": True,
        }
    
    cli_available = check_storacha_cli()
    return {
        "mode": "production",
        "storage": "storacha",
        "cli_path": get_storacha_cli(),
        "cli_available": cli_available,
        "ready": cli_available,
    }
