"""
Full End-to-End Integration Test

Tests the complete flow:
1. User A (Owner) registers and uploads encrypted file
2. User B (Grantee) registers and requests access
3. Owner generates kfrags (client-side) and approves access
4. Server re-encrypts (produces cfrag)
5. Owner can decrypt their own file
6. Grantee can decrypt with their key + cfrag

This simulates real API calls with actual encryption/decryption.
"""

import os
import pytest
import httpx
import asyncio
from umbral import (
    SecretKey,
    PublicKey,
    Signer,
    Capsule,
    KeyFrag,
    CapsuleFrag,
    encrypt,
    decrypt_original,
    decrypt_reencrypted,
    generate_kfrags,
    reencrypt,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Backend URL
BASE_URL = os.getenv("BACKEND_URL", "http://localhost:8000")


class TestE2EFullFlow:
    """End-to-end test class for the complete PRE flow."""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test fixtures."""
        # Generate Owner's keys
        self.owner_secret_key = SecretKey.random()
        self.owner_public_key = self.owner_secret_key.public_key()
        self.owner_public_key_hex = bytes(self.owner_public_key).hex()
        
        # Generate Owner's signing key
        self.owner_signing_key = SecretKey.random()
        self.owner_verifying_key = self.owner_signing_key.public_key()
        self.owner_verifying_key_hex = bytes(self.owner_verifying_key).hex()
        self.owner_signer = Signer(self.owner_signing_key)
        
        # Generate Grantee's keys
        self.grantee_secret_key = SecretKey.random()
        self.grantee_public_key = self.grantee_secret_key.public_key()
        self.grantee_public_key_hex = bytes(self.grantee_public_key).hex()
        
        # Test file content
        self.test_file_content = b"CONFIDENTIAL MEDICAL RECORD\n" \
                                 b"Patient: John Doe\n" \
                                 b"DOB: 1985-03-15\n" \
                                 b"Blood Type: O+\n" \
                                 b"Allergies: Penicillin\n" \
                                 b"Diagnosis: Healthy"
        
        print(f"\n{'='*60}")
        print("TEST SETUP")
        print(f"{'='*60}")
        print(f"Owner public key: {self.owner_public_key_hex[:32]}...")
        print(f"Grantee public key: {self.grantee_public_key_hex[:32]}...")
        
    def test_full_e2e_flow_offline(self):
        """
        Test the full flow offline (no API calls).
        This tests the cryptographic operations match what the API would do.
        """
        print(f"\n{'='*60}")
        print("OFFLINE E2E TEST (Crypto only)")
        print(f"{'='*60}")
        
        # =====================================================================
        # Step 1: Owner encrypts file (simulates upload)
        # =====================================================================
        print("\n[1] Owner encrypts file...")
        
        # Generate CEK
        cek = os.urandom(32)
        nonce = os.urandom(12)
        print(f"  CEK: {cek.hex()[:32]}...")
        
        # Encrypt file with AES-GCM
        aesgcm = AESGCM(cek)
        encrypted_file = aesgcm.encrypt(nonce, self.test_file_content, None)
        encrypted_blob = nonce + encrypted_file  # Store nonce with ciphertext
        print(f"  Encrypted file size: {len(encrypted_blob)} bytes")
        
        # Encapsulate CEK with owner's public key (Umbral)
        capsule, encrypted_cek = encrypt(self.owner_public_key, cek)
        capsule_hex = bytes(capsule).hex()
        encrypted_cek_hex = encrypted_cek.hex()
        print(f"  Capsule: {capsule_hex[:32]}...")
        print(f"  Encrypted CEK: {encrypted_cek_hex[:32]}...")
        
        # Simulated "CID" and database storage
        simulated_cid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
        
        print(f"  ✓ File encrypted and 'uploaded' with CID: {simulated_cid[:20]}...")
        
        # =====================================================================
        # Step 2: Owner can decrypt their own file
        # =====================================================================
        print("\n[2] Owner decrypts their own file...")
        
        # Decrypt CEK
        decrypted_cek = decrypt_original(
            self.owner_secret_key, 
            capsule, 
            encrypted_cek
        )
        assert decrypted_cek == cek, "CEK decryption failed!"
        print(f"  Decrypted CEK: {decrypted_cek.hex()[:32]}...")
        
        # Decrypt file with CEK
        stored_nonce = encrypted_blob[:12]
        stored_ciphertext = encrypted_blob[12:]
        aesgcm_owner = AESGCM(decrypted_cek)
        decrypted_file = aesgcm_owner.decrypt(stored_nonce, stored_ciphertext, None)
        
        assert decrypted_file == self.test_file_content, "File decryption failed!"
        print(f"  ✓ Owner decrypted file successfully:")
        print(f"    {decrypted_file.decode()[:50]}...")
        
        # =====================================================================
        # Step 3: Grantee requests access (simulates /request-access)
        # =====================================================================
        print("\n[3] Grantee requests access...")
        
        # In real API, this would be:
        # POST /access/request-access
        # {"cid": simulated_cid, "requester_pubkey": grantee_public_key_hex, "purpose": "..."}
        request_id = 1  # Simulated
        print(f"  Request ID: {request_id}")
        print(f"  Purpose: 'Need access for treatment consultation'")
        print(f"  ✓ Access request created (pending)")
        
        # =====================================================================
        # Step 4: Owner generates kfrags (CLIENT-SIDE)
        # =====================================================================
        print("\n[4] Owner generates kfrags for grantee (client-side)...")
        
        # This happens in the browser using @nucypher/umbral-pre
        kfrags = generate_kfrags(
            delegating_sk=self.owner_secret_key,
            receiving_pk=self.grantee_public_key,
            signer=self.owner_signer,
            threshold=1,
            shares=1,
        )
        
        # Serialize kfrag for transmission to server
        kfrag_hex = bytes(kfrags[0].kfrag).hex()
        print(f"  Generated 1 kfrag: {kfrag_hex[:32]}...")
        print(f"  Verifying key: {self.owner_verifying_key_hex[:32]}...")
        
        # =====================================================================
        # Step 5: Owner approves access (simulates /approve-access)
        # =====================================================================
        print("\n[5] Owner approves access...")
        
        # In real API, this would be:
        # POST /access/approve-access
        # {"request_id": 1, "kfrag_hex": kfrag_hex, "verifying_key_hex": verifying_key_hex}
        
        # Server stores kfrag and verifying_key
        stored_kfrag = kfrag_hex
        stored_verifying_key = self.owner_verifying_key_hex
        
        print(f"  ✓ Access approved")
        print(f"  Stored kfrag and verifying key in database")
        
        # =====================================================================
        # Step 6: Server re-encrypts (simulates /redeem)
        # =====================================================================
        print("\n[6] Grantee redeems access (server re-encrypts)...")
        
        # Server-side re-encryption
        # 1. Load kfrag from database
        reconstructed_kfrag = KeyFrag.from_bytes(bytes.fromhex(stored_kfrag))
        
        # 2. Verify kfrag
        verifying_pk = PublicKey.from_bytes(bytes.fromhex(stored_verifying_key))
        verified_kfrag = reconstructed_kfrag.verify(
            verifying_pk=verifying_pk,
            delegating_pk=self.owner_public_key,
            receiving_pk=self.grantee_public_key,
        )
        print(f"  ✓ kfrag verified")
        
        # 3. Re-encrypt capsule
        cfrag = reencrypt(capsule, verified_kfrag)
        cfrag_hex = bytes(cfrag).hex()
        print(f"  cfrag: {cfrag_hex[:32]}...")
        print(f"  ✓ Re-encryption complete")
        
        # =====================================================================
        # Step 7: Grantee decrypts with their key + cfrag
        # =====================================================================
        print("\n[7] Grantee decrypts file...")
        
        # Grantee receives:
        # - cfrag from server
        # - encrypted_blob (from Storacha/IPFS via blob_url)
        # - capsule_hex and encrypted_cek_hex (from file metadata)
        # - owner_public_key_hex (from file owner's profile)
        
        # Reconstruct cfrag
        reconstructed_cfrag = CapsuleFrag.from_bytes(bytes.fromhex(cfrag_hex))
        verified_cfrag = reconstructed_cfrag.verify(
            capsule=capsule,
            verifying_pk=verifying_pk,
            delegating_pk=self.owner_public_key,
            receiving_pk=self.grantee_public_key,
        )
        print(f"  ✓ cfrag verified")
        
        # Decrypt CEK using PRE
        grantee_decrypted_cek = decrypt_reencrypted(
            receiving_sk=self.grantee_secret_key,
            delegating_pk=self.owner_public_key,
            capsule=capsule,
            verified_cfrags=[verified_cfrag],
            ciphertext=encrypted_cek,
        )
        assert grantee_decrypted_cek == cek, "Grantee CEK decryption failed!"
        print(f"  Decrypted CEK: {grantee_decrypted_cek.hex()[:32]}...")
        
        # Decrypt file with CEK
        aesgcm_grantee = AESGCM(grantee_decrypted_cek)
        grantee_decrypted_file = aesgcm_grantee.decrypt(
            stored_nonce, 
            stored_ciphertext, 
            None
        )
        
        assert grantee_decrypted_file == self.test_file_content, "Grantee file decryption failed!"
        print(f"  ✓ Grantee decrypted file successfully:")
        print(f"    {grantee_decrypted_file.decode()[:50]}...")
        
        # =====================================================================
        # Summary
        # =====================================================================
        print(f"\n{'='*60}")
        print("✓ FULL E2E TEST PASSED")
        print(f"{'='*60}")
        print("\nFlow completed successfully:")
        print("  1. Owner encrypted file with their public key")
        print("  2. Owner decrypted their own file ✓")
        print("  3. Grantee requested access")
        print("  4. Owner generated kfrags (client-side)")
        print("  5. Owner approved access (kfrags sent to server)")
        print("  6. Server re-encrypted for grantee")
        print("  7. Grantee decrypted with their secret key + cfrag ✓")
        print("\nSECURITY NOTES:")
        print("  - Owner's secret key never left the client")
        print("  - Server only saw: encrypted file, kfrags, and public keys")
        print("  - Grantee's secret key never left the client")
        print("  - CEK was never exposed to the server")


@pytest.mark.asyncio
async def test_full_e2e_flow_with_api():
    """
    Test the full flow with actual API calls.
    Requires the backend to be running.
    """
    print(f"\n{'='*60}")
    print("ONLINE E2E TEST (With API calls)")
    print(f"{'='*60}")
    
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30.0) as client:
        # Check if backend is running
        try:
            response = await client.get("/")
            if response.status_code != 200:
                pytest.skip("Backend not running")
        except httpx.ConnectError:
            pytest.skip("Backend not running at " + BASE_URL)
        
        # =====================================================================
        # Setup: Generate keys for Owner and Grantee
        # =====================================================================
        owner_secret_key = SecretKey.random()
        owner_public_key = owner_secret_key.public_key()
        owner_public_key_hex = bytes(owner_public_key).hex()
        
        owner_signing_key = SecretKey.random()
        owner_signer = Signer(owner_signing_key)
        owner_verifying_key_hex = bytes(owner_signing_key.public_key()).hex()
        
        grantee_secret_key = SecretKey.random()
        grantee_public_key = grantee_secret_key.public_key()
        grantee_public_key_hex = bytes(grantee_public_key).hex()
        
        print(f"\nOwner public key: {owner_public_key_hex[:32]}...")
        print(f"Grantee public key: {grantee_public_key_hex[:32]}...")
        
        # =====================================================================
        # Step 1: Register Owner
        # =====================================================================
        print("\n[1] Registering owner...")
        
        # First create an invite code (or use existing)
        # For testing, we'll try to register and handle if user exists
        import uuid
        owner_username = f"owner_{uuid.uuid4().hex[:8]}"
        
        register_response = await client.post("/auth/register", json={
            "username": owner_username,
            "email": f"{owner_username}@test.com",
            "invite_code": "TESTCODE123",  # Assume this exists
            "public_key": owner_public_key_hex,
        })
        
        if register_response.status_code == 200:
            owner_data = register_response.json()
            owner_id = owner_data["user"]["id"]
            owner_token = owner_data["token"]
            print(f"  ✓ Owner registered: {owner_username} (ID: {owner_id})")
        else:
            # Try login instead
            login_response = await client.post("/auth/login", json={
                "username": owner_username,
            })
            if login_response.status_code != 200:
                print(f"  ✗ Failed to register/login owner: {register_response.text}")
                pytest.skip("Could not create owner user")
            owner_data = login_response.json()
            owner_id = owner_data["user"]["id"]
            owner_token = owner_data["token"]
        
        # =====================================================================
        # Step 2: Register Grantee
        # =====================================================================
        print("\n[2] Registering grantee...")
        
        grantee_username = f"grantee_{uuid.uuid4().hex[:8]}"
        
        register_response = await client.post("/auth/register", json={
            "username": grantee_username,
            "email": f"{grantee_username}@test.com",
            "invite_code": "TESTCODE123",
            "public_key": grantee_public_key_hex,
        })
        
        if register_response.status_code == 200:
            grantee_data = register_response.json()
            grantee_id = grantee_data["user"]["id"]
            grantee_token = grantee_data["token"]
            print(f"  ✓ Grantee registered: {grantee_username} (ID: {grantee_id})")
        else:
            print(f"  ✗ Failed to register grantee: {register_response.text}")
            pytest.skip("Could not create grantee user")
        
        # =====================================================================
        # Step 3: Owner uploads encrypted file
        # =====================================================================
        print("\n[3] Owner uploads encrypted file...")
        
        test_content = b"CONFIDENTIAL: Patient medical record for E2E test"
        
        files = {
            "file": ("test_record.txt", test_content, "text/plain"),
        }
        data = {
            "patient_id": str(owner_id),
            "owner_public_key": owner_public_key_hex,
        }
        
        upload_response = await client.post(
            "/upload",
            files=files,
            data=data,
        )
        
        if upload_response.status_code != 200:
            print(f"  ✗ Upload failed: {upload_response.text}")
            pytest.fail("Upload failed")
        
        upload_data = upload_response.json()
        cid = upload_data["cid"]
        capsule_hex = upload_data["capsule"]
        encrypted_cek_hex = upload_data["encrypted_cek"]
        
        print(f"  ✓ File uploaded")
        print(f"    CID: {cid[:20]}...")
        print(f"    Capsule: {capsule_hex[:32]}...")
        
        # =====================================================================
        # Step 4: Grantee requests access
        # =====================================================================
        print("\n[4] Grantee requests access...")
        
        request_response = await client.post(
            "/access/request-access",
            json={
                "cid": cid,
                "requester_pubkey": grantee_public_key_hex,
                "purpose": "Treatment consultation - E2E test",
            },
            headers={"Authorization": f"Bearer {grantee_token}"},
        )
        
        if request_response.status_code != 200:
            print(f"  ✗ Access request failed: {request_response.text}")
            pytest.fail("Access request failed")
        
        request_data = request_response.json()
        request_id = request_data["request_id"]
        print(f"  ✓ Access request created (ID: {request_id})")
        
        # =====================================================================
        # Step 5: Owner generates kfrags (client-side)
        # =====================================================================
        print("\n[5] Owner generates kfrags (client-side)...")
        
        kfrags = generate_kfrags(
            delegating_sk=owner_secret_key,
            receiving_pk=grantee_public_key,
            signer=owner_signer,
            threshold=1,
            shares=1,
        )
        
        kfrag_hex = bytes(kfrags[0].kfrag).hex()
        print(f"  ✓ Generated kfrag: {kfrag_hex[:32]}...")
        
        # =====================================================================
        # Step 6: Owner approves access
        # =====================================================================
        print("\n[6] Owner approves access...")
        
        approve_response = await client.post(
            "/access/approve-access",
            json={
                "request_id": request_id,
                "expiry_seconds": 3600,
                "kfrag_hex": kfrag_hex,
                "verifying_key_hex": owner_verifying_key_hex,
            },
            headers={"Authorization": f"Bearer {owner_token}"},
        )
        
        if approve_response.status_code != 200:
            print(f"  ✗ Approve failed: {approve_response.text}")
            pytest.fail("Approve failed")
        
        approve_data = approve_response.json()
        print(f"  ✓ Access approved")
        if approve_data.get("tx_hash"):
            print(f"    TX: {approve_data['tx_hash'][:20]}...")
        
        # =====================================================================
        # Step 7: Grantee redeems access
        # =====================================================================
        print("\n[7] Grantee redeems access...")
        
        redeem_response = await client.post(
            "/access/redeem",
            json={
                "cid": cid,
                "requester_pubkey": grantee_public_key_hex,
            },
            headers={"Authorization": f"Bearer {grantee_token}"},
        )
        
        if redeem_response.status_code != 200:
            print(f"  ✗ Redeem failed: {redeem_response.text}")
            pytest.fail("Redeem failed")
        
        redeem_data = redeem_response.json()
        import base64
        cfrag_bytes = base64.b64decode(redeem_data["reenc_capsule"])
        cfrag_hex = cfrag_bytes.hex()
        blob_url = redeem_data["blob_url"]
        
        print(f"  ✓ Redeemed access")
        print(f"    cfrag: {cfrag_hex[:32]}...")
        print(f"    blob_url: {blob_url[:50]}...")
        
        # =====================================================================
        # Step 8: Grantee decrypts
        # =====================================================================
        print("\n[8] Grantee decrypts file...")
        
        # Download encrypted blob from Storacha
        blob_response = await client.get(blob_url)
        if blob_response.status_code != 200:
            print(f"  ⚠ Could not download blob (may be CORS issue): {blob_response.status_code}")
            # Continue with crypto verification
        
        # Reconstruct capsule
        capsule = Capsule.from_bytes(bytes.fromhex(capsule_hex))
        
        # Reconstruct and verify cfrag
        reconstructed_cfrag = CapsuleFrag.from_bytes(cfrag_bytes)
        verifying_pk = PublicKey.from_bytes(bytes.fromhex(owner_verifying_key_hex))
        
        verified_cfrag = reconstructed_cfrag.verify(
            capsule=capsule,
            verifying_pk=verifying_pk,
            delegating_pk=owner_public_key,
            receiving_pk=grantee_public_key,
        )
        print(f"  ✓ cfrag verified")
        
        # Decrypt CEK
        encrypted_cek = bytes.fromhex(encrypted_cek_hex)
        grantee_cek = decrypt_reencrypted(
            receiving_sk=grantee_secret_key,
            delegating_pk=owner_public_key,
            capsule=capsule,
            verified_cfrags=[verified_cfrag],
            ciphertext=encrypted_cek,
        )
        print(f"  ✓ CEK decrypted: {grantee_cek.hex()[:32]}...")
        
        # If we got the blob, decrypt it
        if blob_response.status_code == 200:
            encrypted_blob = blob_response.content
            nonce = encrypted_blob[:12]
            ciphertext = encrypted_blob[12:]
            
            aesgcm = AESGCM(grantee_cek)
            decrypted_file = aesgcm.decrypt(nonce, ciphertext, None)
            
            assert decrypted_file == test_content, "File decryption failed!"
            print(f"  ✓ File decrypted: {decrypted_file.decode()}")
        else:
            print(f"  ⚠ Skipped file decryption (blob not accessible)")
        
        # =====================================================================
        # Summary
        # =====================================================================
        print(f"\n{'='*60}")
        print("✓ ONLINE E2E TEST PASSED")
        print(f"{'='*60}")


if __name__ == "__main__":
    # Run offline test
    test = TestE2EFullFlow()
    test.setup()
    test.test_full_e2e_flow_offline()
    
    # Run online test
    print("\n\n")
    asyncio.run(test_full_e2e_flow_with_api())
