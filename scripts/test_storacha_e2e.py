"""
End-to-end test for Storacha upload integration.

Tests:
1. File encryption with AES-256-GCM
2. CEK encapsulation with Umbral
3. Upload to Storacha
4. Verification that content is ciphertext (not plaintext)
5. Download and decryption

Run from project root: python scripts/test_storacha_e2e.py
"""

import asyncio
import os
import sys
from datetime import datetime

# Setup path to import from backend
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
BACKEND_DIR = os.path.join(PROJECT_ROOT, 'backend')

# Change to backend directory for imports
os.chdir(BACKEND_DIR)
sys.path.insert(0, BACKEND_DIR)

# Set environment for testing
os.environ.setdefault("DEV_MODE", "false")  # Use real Storacha

import httpx
from umbral import SecretKey

# Import backend modules
from app.db import init_db, create_user, create_invite_code, use_invite_code, UserCreate
from app.utils.umbral_utils import (
    generate_cek, encrypt_with_cek, decrypt_with_cek, 
    encapsulate_cek, decrypt_original_data,
    PublicKey, SecretKey as UmbralSecretKey
)


API_BASE = "http://localhost:8000"
STORACHA_GATEWAY = "https://{cid}.ipfs.storacha.link"


async def setup_test_user():
    """Create a test user with Umbral keys directly in DB."""
    # Initialize database
    await init_db()
    
    # Generate Umbral key pair
    secret_key = SecretKey.random()
    public_key = secret_key.public_key()
    
    secret_key_hex = secret_key.to_secret_bytes().hex()
    public_key_hex = bytes(public_key).hex()
    
    # Create invite code directly in DB
    invite_code = f"TEST_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    await create_invite_code(invite_code)
    
    # Create user using UserCreate model
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    user_data = UserCreate(
        username=f"storacha_test_{timestamp}",
        email=f"storacha_test_{timestamp}@test.com",
        invite_code=invite_code,
        public_key=public_key_hex,
    )
    user_id = await create_user(user_data)
    
    await use_invite_code(invite_code, user_id)
    
    return {
        "user_id": user_id,
        "secret_key": secret_key_hex,
        "public_key": public_key_hex,
        "username": user_data.username,
    }


async def test_upload_flow(user_data: dict, test_content: bytes, filename: str):
    """Test the upload and encryption flow."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        # Upload file
        print(f"\n[2] Uploading file: {filename} ({len(test_content)} bytes)")
        
        files = {"file": (filename, test_content, "application/octet-stream")}
        data = {
            "patient_id": str(user_data["user_id"]),
            "owner_public_key": user_data["public_key"],
        }
        
        response = await client.post(f"{API_BASE}/upload", files=files, data=data)
        
        if response.status_code != 200:
            print(f"    ERROR: Upload failed: {response.text}")
            return None
        
        result = response.json()
        print(f"    CID: {result['cid']}")
        print(f"    File ID: {result['file_id']}")
        print(f"    Capsule: {result['capsule'][:80]}...")
        
        return result


async def verify_ciphertext(cid: str, original_content: bytes):
    """Verify that content on Storacha is encrypted (not plaintext)."""
    print(f"\n[3] Verifying ciphertext on Storacha...")
    
    gateway_url = STORACHA_GATEWAY.format(cid=cid)
    print(f"    Gateway URL: {gateway_url}")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(gateway_url)
            if response.status_code != 200:
                print(f"    WARNING: Could not fetch from gateway: {response.status_code}")
                return False
            
            stored_content = response.content
            print(f"    Stored size: {len(stored_content)} bytes")
            print(f"    First 50 bytes (hex): {stored_content[:50].hex()}")
            
            # Check if content matches original (should NOT match - should be encrypted)
            if stored_content == original_content:
                print("    FAIL: Content is PLAINTEXT (not encrypted)!")
                return False
            
            # Check if any plaintext snippets exist
            sample_text = original_content[:50] if len(original_content) > 50 else original_content
            if sample_text in stored_content:
                print("    FAIL: Original content found in stored data!")
                return False
            
            print("    SUCCESS: Content appears to be encrypted (ciphertext)")
            return True
            
        except Exception as e:
            print(f"    WARNING: Gateway fetch failed: {e}")
            # Still try to continue
            return None


async def test_download_decrypt(file_id: int, cid: str, capsule: str, encrypted_cek: str, 
                                  secret_key_hex: str, original_content: bytes):
    """Test download and decryption."""
    print(f"\n[4] Testing download and decryption...")
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        # Download endpoint - use file_id and owner_private_key
        response = await client.post(
            f"{API_BASE}/upload/download",
            json={
                "file_id": file_id,
                "owner_private_key": secret_key_hex,
            }
        )
        
        if response.status_code == 200:
            result = response.json()
            if "content_base64" in result:
                import base64
                decrypted = base64.b64decode(result["content_base64"])
                if decrypted == original_content:
                    print("    SUCCESS: Decrypted content matches original!")
                    return True
                else:
                    print(f"    FAIL: Decrypted content does not match!")
                    print(f"    Original: {original_content[:50]}")
                    print(f"    Decrypted: {decrypted[:50] if decrypted else 'None'}")
                    return False
            print(f"    Response: {result}")
        else:
            print(f"    Download endpoint returned: {response.status_code}")
            print(f"    Response: {response.text}")
    
    # Try manual decryption
    print("\n    Attempting manual decryption...")
    try:
        from umbral import SecretKey as USecretKey, Capsule, decrypt_original
        
        # Fetch from gateway
        async with httpx.AsyncClient(timeout=30.0) as client:
            gateway_url = STORACHA_GATEWAY.format(cid=cid)
            response = await client.get(gateway_url)
            if response.status_code != 200:
                print(f"    Could not fetch from gateway")
                return False
            
            encrypted_blob = response.content
        
        # The blob format is: nonce (12 bytes) + ciphertext
        nonce = encrypted_blob[:12]
        ciphertext = encrypted_blob[12:]
        
        # Decrypt CEK using Umbral
        secret_key = USecretKey.from_bytes(bytes.fromhex(secret_key_hex))
        capsule_bytes = bytes.fromhex(capsule)
        capsule_obj = Capsule.from_bytes(capsule_bytes)
        encrypted_cek_bytes = bytes.fromhex(encrypted_cek)
        
        cek = decrypt_original(secret_key, capsule_obj, encrypted_cek_bytes)
        
        # Decrypt content with CEK
        plaintext = decrypt_with_cek(ciphertext, cek, nonce)
        
        if plaintext == original_content:
            print("    SUCCESS: Manual decryption successful!")
            return True
        else:
            print(f"    FAIL: Manual decryption produced wrong content")
            return False
            
    except Exception as e:
        print(f"    Manual decryption failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_image_upload(user_data: dict):
    """Test uploading a PNG image."""
    # Create a simple PNG (1x1 red pixel)
    # PNG signature + IHDR chunk + IDAT chunk + IEND chunk
    png_data = bytes([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
        0x00, 0x00, 0x00, 0x0D,  # IHDR length
        0x49, 0x48, 0x44, 0x52,  # IHDR type
        0x00, 0x00, 0x00, 0x01,  # width = 1
        0x00, 0x00, 0x00, 0x01,  # height = 1
        0x08, 0x02,              # 8-bit RGB
        0x00, 0x00, 0x00,        # compression, filter, interlace
        0x90, 0x77, 0x53, 0xDE,  # CRC
        0x00, 0x00, 0x00, 0x0C,  # IDAT length
        0x49, 0x44, 0x41, 0x54,  # IDAT type
        0x08, 0xD7, 0x63, 0xF8,  # compressed data
        0xCF, 0xC0, 0x00, 0x00,
        0x01, 0x01, 0x01, 0x00,  # CRC
        0x18, 0xDD, 0x8D, 0xB4,
        0x00, 0x00, 0x00, 0x00,  # IEND length
        0x49, 0x45, 0x4E, 0x44,  # IEND type
        0xAE, 0x42, 0x60, 0x82,  # CRC
    ])
    
    print(f"\n[5] Testing image upload (PNG)...")
    result = await test_upload_flow(user_data, png_data, "test_image.png")
    
    if result:
        print(f"    Image uploaded with CID: {result['cid']}")
        return result
    return None


async def main():
    """Run all tests."""
    print("=" * 60)
    print("Storacha Upload Integration Test")
    print("=" * 60)
    
    # Check API is running
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(f"{API_BASE}/health")
            if response.status_code != 200:
                print(f"ERROR: API not healthy: {response.text}")
                return
            health = response.json()
            print(f"API Status: {health}")
            if health.get("dev_mode"):
                print("WARNING: DEV_MODE is enabled - uploads go to local storage!")
        except Exception as e:
            print(f"ERROR: Cannot connect to API: {e}")
            print("Make sure the backend is running: cd backend && uvicorn app.main:app --reload")
            return
    
    # Setup test user
    print("\n[1] Setting up test user with Umbral keys...")
    user_data = await setup_test_user()
    print(f"    User ID: {user_data['user_id']}")
    print(f"    Public Key: {user_data['public_key'][:40]}...")
    print(f"    Secret Key: {user_data['secret_key'][:40]}... (SAVE FOR FRONTEND)")
    
    # Test text file upload
    test_content = b"Patient: John Doe\nDiagnosis: Healthy\nDate: 2024-01-15\nNotes: Confidential medical record."
    
    result = await test_upload_flow(user_data, test_content, "medical_record.txt")
    
    if not result:
        print("\nFAIL: Upload failed!")
        return
    
    # Verify ciphertext
    is_encrypted = await verify_ciphertext(result["cid"], test_content)
    
    # Test decryption
    decrypt_success = await test_download_decrypt(
        result["file_id"],
        result["cid"],
        result["capsule"],
        result["encrypted_cek"],
        user_data["secret_key"],
        test_content,
    )
    
    # Test image upload
    image_result = await test_image_upload(user_data)
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    print(f"Upload: {'PASS' if result else 'FAIL'}")
    print(f"Ciphertext verified: {'PASS' if is_encrypted else 'FAIL' if is_encrypted == False else 'SKIPPED'}")
    print(f"Decryption: {'PASS' if decrypt_success else 'FAIL'}")
    print(f"Image upload: {'PASS' if image_result else 'FAIL'}")
    
    print("\n" + "=" * 60)
    print("Frontend Test Data")
    print("=" * 60)
    print(f"User ID: {user_data['user_id']}")
    print(f"Secret Key (for FileViewer): {user_data['secret_key']}")
    print(f"Public Key: {user_data['public_key']}")
    if result:
        print(f"CID: {result['cid']}")
        print(f"Gateway URL: {STORACHA_GATEWAY.format(cid=result['cid'])}")


if __name__ == "__main__":
    asyncio.run(main())
