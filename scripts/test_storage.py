#!/usr/bin/env python3
"""
Test script for Storacha storage integration.

This script tests the upload and download functionality of the Storacha client.

Usage:
    python scripts/test_storage.py

Prerequisites:
    1. Install Storacha CLI: npm install -g @storacha/cli
    2. Set environment variables in .env:
       - STORACHA_PRINCIPAL
       - STORACHA_PROOF
    
    See: python -c "from backend.app.storage import print_setup_instructions; print_setup_instructions()"
"""

import os
import sys

# Add backend to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import after loading env
from backend.app.storage.storacha_client import (
    upload_blob,
    download_blob,
    print_setup_instructions,
    StorachaConfigError,
    StorachaError,
)


def main():
    """Run storage test."""
    print("=" * 60)
    print("STORACHA STORAGE TEST")
    print("=" * 60)
    
    # Check for sample file
    sample_path = os.path.join(os.path.dirname(__file__), "sample.txt")
    
    if not os.path.exists(sample_path):
        # Create sample file if it doesn't exist
        print(f"Creating sample file: {sample_path}")
        sample_content = b"Hello from Decent-Hospital! This is a test file for Storacha storage.\n"
        sample_content += b"Timestamp: " + str(os.urandom(8).hex()).encode() + b"\n"
        with open(sample_path, "wb") as f:
            f.write(sample_content)
    
    # Read sample file
    print(f"\nReading sample file: {sample_path}")
    with open(sample_path, "rb") as f:
        sample_data = f.read()
    
    print(f"Sample data size: {len(sample_data)} bytes")
    print(f"Sample data preview: {sample_data[:100]}...")
    
    try:
        # Test upload
        print("\n" + "-" * 40)
        print("STEP 1: Testing upload_blob...")
        print("-" * 40)
        
        result = upload_blob(sample_data, "sample.txt")
        
        cid = result["cid"]
        size = result["size"]
        
        print(f"\nSTORAGE OK: {cid}")
        print(f"Size: {size} bytes")
        
        # Test download
        print("\n" + "-" * 40)
        print("STEP 2: Testing download_blob...")
        print("-" * 40)
        
        downloaded_data = download_blob(cid)
        
        # Verify content matches
        if downloaded_data == sample_data:
            print(f"\nSTORAGE VERIFY OK")
            print(f"Downloaded {len(downloaded_data)} bytes - content matches!")
        else:
            print(f"\n❌ VERIFICATION FAILED")
            print(f"Original size: {len(sample_data)}")
            print(f"Downloaded size: {len(downloaded_data)}")
            sys.exit(1)
        
        # Print gateway URL for manual verification
        gateway_url = os.environ.get("STORACHA_GATEWAY_URL", "https://storacha.link")
        print("\n" + "-" * 40)
        print("MANUAL VERIFICATION")
        print("-" * 40)
        print(f"Gateway URL: {gateway_url}/ipfs/{cid}")
        print(f"Subdomain URL: https://{cid}.ipfs.storacha.link")
        
        print("\n" + "=" * 60)
        print("✅ ALL TESTS PASSED")
        print("=" * 60)
        
    except StorachaConfigError as e:
        print(f"\n❌ CONFIGURATION ERROR: {e}")
        print("\nPlease set up your environment variables.")
        print_setup_instructions()
        sys.exit(1)
        
    except StorachaError as e:
        print(f"\n❌ STORAGE ERROR: {e}")
        sys.exit(1)
        
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
