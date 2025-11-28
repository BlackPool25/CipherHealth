"""
Web3.Storage Utilities

This module provides functions for uploading files to IPFS
via the web3.storage API.

Environment Variables:
- WEB3_STORAGE_TOKEN: API token from https://web3.storage
"""

import os
from typing import Any, Dict

import requests

# ============================================================================
# Configuration
# ============================================================================

WEB3_STORAGE_API_URL = "https://api.web3.storage"
WEB3_STORAGE_TOKEN = os.getenv("WEB3_STORAGE_TOKEN")


# ============================================================================
# Upload Functions
# ============================================================================


def upload_to_web3_storage(file_path: str) -> Dict[str, Any]:
    """
    Upload a file to web3.storage (IPFS).

    Uses the web3.storage HTTP API to pin a file to IPFS.
    Requires WEB3_STORAGE_TOKEN environment variable to be set.

    API Documentation: https://web3.storage/docs/reference/http-api/

    Args:
        file_path: Path to the file to upload.

    Returns:
        Dict containing:
        - cid: IPFS Content Identifier (CID)
        - name: Original filename (if available)
        - size: File size in bytes

    Raises:
        ValueError: If WEB3_STORAGE_TOKEN is not set.
        FileNotFoundError: If file doesn't exist.
        requests.HTTPError: If API request fails.

    Example:
        >>> result = upload_to_web3_storage("/path/to/encrypted.bin")
        >>> print(result["cid"])
        "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
    """
    # Validate token is configured
    token = WEB3_STORAGE_TOKEN
    if not token:
        raise ValueError(
            "WEB3_STORAGE_TOKEN environment variable not set. "
            "Get a token at https://web3.storage"
        )

    # Validate file exists
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    # Get file info
    filename = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)

    # Prepare headers
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Name": filename,  # Optional: name for the upload
    }

    # Upload file
    # web3.storage accepts raw file upload with Content-Type header
    upload_url = f"{WEB3_STORAGE_API_URL}/upload"

    with open(file_path, "rb") as f:
        response = requests.post(
            upload_url,
            headers=headers,
            data=f,
            timeout=300,  # 5 minute timeout for large files
        )

    # Check for errors
    response.raise_for_status()

    # Parse response
    result = response.json()

    # The response contains the CID
    # See: https://web3.storage/docs/reference/http-api/#operation/post-upload
    return {
        "cid": result.get("cid"),
        "name": filename,
        "size": file_size,
        "response": result,  # Include full response for debugging
    }


def upload_bytes_to_web3_storage(
    data: bytes,
    filename: str = "data.bin",
) -> Dict[str, Any]:
    """
    Upload raw bytes to web3.storage (IPFS).

    Convenience function that uploads bytes directly without
    requiring a file on disk.

    Args:
        data: Bytes to upload.
        filename: Optional name for the upload.

    Returns:
        Dict containing:
        - cid: IPFS Content Identifier (CID)
        - name: Provided filename
        - size: Data size in bytes

    Raises:
        ValueError: If WEB3_STORAGE_TOKEN is not set.
        requests.HTTPError: If API request fails.
    """
    # Validate token is configured
    token = WEB3_STORAGE_TOKEN
    if not token:
        raise ValueError(
            "WEB3_STORAGE_TOKEN environment variable not set. "
            "Get a token at https://web3.storage"
        )

    # Prepare headers
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Name": filename,
    }

    # Upload bytes
    upload_url = f"{WEB3_STORAGE_API_URL}/upload"

    response = requests.post(
        upload_url,
        headers=headers,
        data=data,
        timeout=300,
    )

    # Check for errors
    response.raise_for_status()

    # Parse response
    result = response.json()

    return {
        "cid": result.get("cid"),
        "name": filename,
        "size": len(data),
        "response": result,
    }


def get_file_status(cid: str) -> Dict[str, Any]:
    """
    Check the status of an uploaded file.

    Args:
        cid: IPFS Content Identifier.

    Returns:
        Dict with upload status information.

    Raises:
        ValueError: If WEB3_STORAGE_TOKEN is not set.
        requests.HTTPError: If API request fails.
    """
    token = WEB3_STORAGE_TOKEN
    if not token:
        raise ValueError("WEB3_STORAGE_TOKEN environment variable not set.")

    headers = {
        "Authorization": f"Bearer {token}",
    }

    status_url = f"{WEB3_STORAGE_API_URL}/status/{cid}"

    response = requests.get(
        status_url,
        headers=headers,
        timeout=30,
    )

    response.raise_for_status()
    return response.json()


def list_uploads(
    before: str = None,
    size: int = 25,
) -> Dict[str, Any]:
    """
    List uploaded files.

    Args:
        before: CID to list uploads before (for pagination).
        size: Number of results to return (max 100).

    Returns:
        Dict with list of uploads.

    Raises:
        ValueError: If WEB3_STORAGE_TOKEN is not set.
        requests.HTTPError: If API request fails.
    """
    token = WEB3_STORAGE_TOKEN
    if not token:
        raise ValueError("WEB3_STORAGE_TOKEN environment variable not set.")

    headers = {
        "Authorization": f"Bearer {token}",
    }

    params = {"size": min(size, 100)}
    if before:
        params["before"] = before

    list_url = f"{WEB3_STORAGE_API_URL}/user/uploads"

    response = requests.get(
        list_url,
        headers=headers,
        params=params,
        timeout=30,
    )

    response.raise_for_status()
    return response.json()


# ============================================================================
# IPFS Gateway Functions
# ============================================================================


def get_ipfs_gateway_url(cid: str, gateway: str = "w3s.link") -> str:
    """
    Get a public gateway URL for an IPFS CID.

    Args:
        cid: IPFS Content Identifier.
        gateway: Gateway domain to use.

    Returns:
        Full gateway URL.

    Example:
        >>> get_ipfs_gateway_url("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
        "https://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.ipfs.w3s.link"
    """
    return f"https://{cid}.ipfs.{gateway}"


def download_from_ipfs(cid: str, gateway: str = "w3s.link") -> bytes:
    """
    Download file content from IPFS via gateway.

    Args:
        cid: IPFS Content Identifier.
        gateway: Gateway domain to use.

    Returns:
        File content as bytes.

    Raises:
        requests.HTTPError: If download fails.
    """
    url = get_ipfs_gateway_url(cid, gateway)
    response = requests.get(url, timeout=300)
    response.raise_for_status()
    return response.content
