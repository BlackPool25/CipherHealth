#!/usr/bin/env python3
"""
Test script for pyUmbral Proxy Re-Encryption flow.

This test demonstrates the complete PRE workflow with passphrase-encrypted key storage:
1. Alice (owner) and Bob (grantee) generate keypairs stored encrypted locally
2. Alice encrypts sample data with a CEK
3. Alice encapsulates the CEK with her public key
4. Alice generates a re-encryption key for Bob
5. A proxy re-encrypts the capsule for Bob
6. Bob decrypts and recovers the original data

On success, prints only: "PYUMBRAL FLOW OK"

Reference Documentation:
- pyUmbral GitHub: https://github.com/nucypher/pyUmbral
- pyUmbral API Docs: https://pyumbral.readthedocs.io/en/latest/api.html
- pyUmbral Usage Guide: https://pyumbral.readthedocs.io/en/latest/using_pyumbral.html
"""

import sys
import os
import tempfile
import shutil
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from crypto.umbral_utils import (
    # New API functions
    generate_umbral_keypair,
    generate_umbral_keypair_simple,
    encrypt_plaintext_with_cek,
    encapsulate_cek,
    encapsulate_cek_tuple,
    generate_rekey,
    generate_rekey_with_metadata,
    reencrypt_capsule,
    decrypt_with_capsule,
    decrypt_capsule_and_cek,
    decrypt_original,
    # Key storage functions
    store_private_key,
    load_private_key,
    # Legacy functions for backward compatibility
    encrypt_file_with_cek,
    encrypt_bytes_with_cek,
    decrypt_bytes_with_cek,
)


def test_pyumbral_full_flow_with_encrypted_keys():
    """
    Test the complete pyUmbral proxy re-encryption flow with encrypted key storage.

    This test uses passphrase-protected keys stored on disk, demonstrating
    the production-ready approach.

    Scenario:
    - Alice (data owner) creates keys with passphrase "alice_secret"
    - Bob (grantee) creates keys with passphrase "bob_secret"
    - Alice encrypts medical data and shares it with Bob via PRE
    """
    # Create a temporary directory for encrypted keys
    temp_keys_dir = tempfile.mkdtemp(prefix="umbral_test_keys_")

    try:
        # ==========================================================================
        # Step 1: Key Generation with encrypted storage
        # ==========================================================================
        alice_passphrase = "alice_secure_passphrase_2024"
        bob_passphrase = "bob_secure_passphrase_2024"

        # Alice generates keys with passphrase (stored encrypted)
        alice_keys = generate_umbral_keypair(
            passphrase=alice_passphrase,
            key_path=Path(temp_keys_dir) / "alice_key.enc",
            key_id="alice",
        )

        # Bob generates keys with passphrase (stored encrypted)
        bob_keys = generate_umbral_keypair(
            passphrase=bob_passphrase,
            key_path=Path(temp_keys_dir) / "bob_key.enc",
            key_id="bob",
        )

        assert Path(alice_keys["private_key_path"]).exists(), "Alice key file should exist"
        assert Path(bob_keys["private_key_path"]).exists(), "Bob key file should exist"
        assert "private_key_hex" not in alice_keys, "Private key hex should not be exposed"
        assert len(alice_keys["public_key"]) > 0, "Alice public key should not be empty"
        assert len(bob_keys["public_key"]) > 0, "Bob public key should not be empty"

        alice_pub = alice_keys["public_key"]
        bob_pub = bob_keys["public_key"]
        alice_key_path = alice_keys["private_key_path"]
        bob_key_path = bob_keys["private_key_path"]

        # ==========================================================================
        # Step 2: Encrypt sample data using the new API
        # ==========================================================================
        original_data = b"Patient: John Doe, DOB: 1985-03-15, Diagnosis: Healthy"

        # Use the new encrypt_plaintext_with_cek function
        encryption_result = encrypt_plaintext_with_cek(original_data)

        ciphertext = encryption_result["ciphertext"]
        cek = encryption_result["cek"]
        nonce = encryption_result["nonce"]
        tag = encryption_result["tag"]

        assert len(cek) == 32, "CEK should be 32 bytes (256 bits)"
        assert len(nonce) == 12, "Nonce should be 12 bytes (96 bits)"
        assert len(tag) == 16, "Tag should be 16 bytes (128 bits)"

        # Verify we can decrypt with the CEK directly
        decrypted_data = decrypt_bytes_with_cek(ciphertext, cek, nonce)
        assert decrypted_data == original_data, "Direct CEK decryption should work"

        # ==========================================================================
        # Step 3: Encapsulate CEK with Alice's public key using new API
        # ==========================================================================
        encap_result = encapsulate_cek(cek, alice_pub)

        capsule = encap_result["capsule"]
        encrypted_cek = encap_result["encapsulated_blob"]

        assert len(capsule) > 0, "Capsule should not be empty"
        assert len(encrypted_cek) > 0, "Encrypted CEK should not be empty"

        # Verify Alice can decrypt her own encapsulated CEK using encrypted key file
        alice_priv = load_private_key(alice_key_path, alice_passphrase)
        recovered_cek = decrypt_original(capsule, alice_priv, encrypted_cek)
        assert recovered_cek == cek, "Alice should be able to decrypt her own CEK"

        # ==========================================================================
        # Step 4: Alice generates re-encryption key for Bob (using encrypted key file)
        # ==========================================================================
        rekey = generate_rekey(alice_key_path, bob_pub, passphrase=alice_passphrase)

        assert len(rekey) > 0, "Rekey (kfrag) should not be empty"

        # ==========================================================================
        # Step 5: Proxy re-encrypts the capsule for Bob
        # ==========================================================================
        cfrag = reencrypt_capsule(
            capsule=capsule,
            rekey=rekey,
            verifying_pk=alice_pub,  # Alice signed the kfrag
            delegating_pk=alice_pub,  # Alice is the delegator
            receiving_pk=bob_pub,  # Bob is the receiver
        )

        assert len(cfrag) > 0, "Cfrag should not be empty"

        # ==========================================================================
        # Step 6: Bob decrypts using the new API with encrypted key file
        # ==========================================================================
        bob_recovered_cek = decrypt_with_capsule(
            reenc_capsule=cfrag,
            grantee_priv_ref=bob_key_path,
            ciphertext=encrypted_cek,
            owner_pub=alice_pub,
            original_capsule=capsule,
            passphrase=bob_passphrase,
        )

        assert bob_recovered_cek == cek, "Bob should recover the same CEK"

        # ==========================================================================
        # Step 7: Bob decrypts the actual data with the recovered CEK
        # ==========================================================================
        bob_decrypted_data = decrypt_bytes_with_cek(ciphertext, bob_recovered_cek, nonce)

        assert bob_decrypted_data == original_data, "Bob should recover the original data"

        return True

    finally:
        # Clean up temporary keys directory
        shutil.rmtree(temp_keys_dir, ignore_errors=True)


def test_pyumbral_full_flow_simple():
    """
    Test the complete pyUmbral PRE flow using simple (unencrypted) keys.

    This is for testing/development only - production should use encrypted keys.
    """
    # ==========================================================================
    # Step 1: Key Generation - Both users generate keypairs (simple mode)
    # ==========================================================================
    alice_priv, alice_pub = generate_umbral_keypair_simple()
    bob_priv, bob_pub = generate_umbral_keypair_simple()

    assert len(alice_priv) > 0, "Alice private key should not be empty"
    assert len(alice_pub) > 0, "Alice public key should not be empty"
    assert len(bob_priv) > 0, "Bob private key should not be empty"
    assert len(bob_pub) > 0, "Bob public key should not be empty"

    # ==========================================================================
    # Step 2: Alice creates sample data and encrypts it
    # ==========================================================================
    original_data = b"This is Alice's confidential medical record. Patient ID: 12345."

    # Create a temporary file with the sample data
    with tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".txt") as f:
        f.write(original_data)
        temp_file_path = f.name

    try:
        # Encrypt the file with a random CEK
        ciphertext, cek, nonce, tag = encrypt_file_with_cek(temp_file_path)

        assert len(cek) == 32, "CEK should be 32 bytes (256 bits)"
        assert len(nonce) == 12, "Nonce should be 12 bytes (96 bits)"
        assert len(tag) == 16, "Tag should be 16 bytes (128 bits)"

    finally:
        os.unlink(temp_file_path)

    # Verify we can decrypt with the CEK
    decrypted_data = decrypt_bytes_with_cek(ciphertext, cek, nonce)
    assert decrypted_data == original_data, "Direct CEK decryption should recover original data"

    # ==========================================================================
    # Step 3: Alice encapsulates the CEK with her public key
    # ==========================================================================
    capsule, encrypted_cek = encapsulate_cek_tuple(cek, alice_pub)

    assert len(capsule) > 0, "Capsule should not be empty"
    assert len(encrypted_cek) > 0, "Encrypted CEK should not be empty"

    # Verify Alice can decrypt her own encapsulated CEK
    recovered_cek = decrypt_original(capsule, alice_priv, encrypted_cek)
    assert recovered_cek == cek, "Alice should be able to decrypt her own CEK"

    # ==========================================================================
    # Step 4: Alice generates a re-encryption key for Bob
    # ==========================================================================
    rekey, alice_verifying_pub, _ = generate_rekey_with_metadata(alice_priv, bob_pub)

    assert len(rekey) > 0, "Rekey (kfrag) should not be empty"

    # ==========================================================================
    # Step 5: Proxy re-encrypts the capsule for Bob
    # ==========================================================================
    cfrag = reencrypt_capsule(
        capsule=capsule,
        rekey=rekey,
        verifying_pk=alice_verifying_pub,
        delegating_pk=alice_pub,
        receiving_pk=bob_pub,
    )

    assert len(cfrag) > 0, "Cfrag should not be empty"

    # ==========================================================================
    # Step 6: Bob decrypts the re-encrypted capsule to get the CEK
    # ==========================================================================
    bob_recovered_cek = decrypt_capsule_and_cek(
        reenc_capsule=cfrag,
        grantee_priv=bob_priv,
        ciphertext=encrypted_cek,
        owner_pub=alice_pub,
        original_capsule=capsule,
    )

    assert bob_recovered_cek == cek, "Bob should recover the same CEK"

    # ==========================================================================
    # Step 7: Bob decrypts the actual data with the recovered CEK
    # ==========================================================================
    bob_decrypted_data = decrypt_bytes_with_cek(ciphertext, bob_recovered_cek, nonce)

    assert bob_decrypted_data == original_data, "Bob should recover the original data"

    return True


def test_key_storage_and_retrieval():
    """Test that keys can be stored encrypted and retrieved with passphrase."""
    temp_keys_dir = tempfile.mkdtemp(prefix="umbral_key_storage_test_")

    try:
        passphrase = "test_passphrase_123!"

        # Generate keys with passphrase
        keys = generate_umbral_keypair(
            passphrase=passphrase,
            key_path=Path(temp_keys_dir) / "test_key.enc",
        )

        # Verify file was created
        key_path = keys["private_key_path"]
        assert Path(key_path).exists(), "Key file should exist"

        # Verify file permissions are restrictive (on Unix systems)
        if os.name != "nt":  # Skip on Windows
            stat_info = os.stat(key_path)
            # Check that file is not world-readable
            assert (stat_info.st_mode & 0o777) <= 0o600, "Key file should have restrictive permissions"

        # Load the key with correct passphrase
        loaded_priv = load_private_key(key_path, passphrase)
        assert len(loaded_priv) > 0, "Loaded private key should not be empty"

        # Verify the loaded key works by generating a public key
        from umbral import SecretKey
        secret_key = SecretKey.from_bytes(bytes.fromhex(loaded_priv))
        derived_pub = bytes(secret_key.public_key()).hex()
        assert derived_pub == keys["public_key"], "Derived public key should match"

        # Verify wrong passphrase fails
        try:
            load_private_key(key_path, "wrong_passphrase")
            assert False, "Should have raised an exception for wrong passphrase"
        except Exception:
            pass  # Expected

        return True

    finally:
        shutil.rmtree(temp_keys_dir, ignore_errors=True)


def test_encrypt_bytes_directly():
    """Test encrypting and decrypting bytes directly (without file)."""
    alice_priv, alice_pub = generate_umbral_keypair_simple()
    bob_priv, bob_pub = generate_umbral_keypair_simple()

    # Original data
    original_data = b"Direct bytes encryption test data - patient vitals: 120/80 mmHg"

    # Generate CEK and encrypt
    cek = os.urandom(32)
    ciphertext, nonce, tag = encrypt_bytes_with_cek(original_data, cek)

    # Verify direct decryption works
    decrypted = decrypt_bytes_with_cek(ciphertext, cek, nonce)
    assert decrypted == original_data, "Direct decryption should work"

    # Now test the full PRE flow with these bytes
    capsule, encrypted_cek = encapsulate_cek_tuple(cek, alice_pub)
    rekey, alice_verifying_pub, _ = generate_rekey_with_metadata(alice_priv, bob_pub)
    cfrag = reencrypt_capsule(
        capsule=capsule,
        rekey=rekey,
        verifying_pk=alice_verifying_pub,
        delegating_pk=alice_pub,
        receiving_pk=bob_pub,
    )

    # Bob decrypts
    bob_cek = decrypt_capsule_and_cek(cfrag, bob_priv, encrypted_cek, alice_pub, capsule)
    bob_data = decrypt_bytes_with_cek(ciphertext, bob_cek, nonce)

    assert bob_data == original_data, "Bob should recover original bytes"

    return True


def test_multiple_grantees():
    """Test that an owner can grant access to multiple grantees."""
    # Create owner and two grantees
    owner_priv, owner_pub = generate_umbral_keypair_simple()
    grantee1_priv, grantee1_pub = generate_umbral_keypair_simple()
    grantee2_priv, grantee2_pub = generate_umbral_keypair_simple()

    # Original data
    original_data = b"Medical record accessible by multiple doctors"
    cek = os.urandom(32)
    ciphertext, nonce, tag = encrypt_bytes_with_cek(original_data, cek)

    # Encapsulate CEK
    capsule, encrypted_cek = encapsulate_cek_tuple(cek, owner_pub)

    # Generate separate rekeys for each grantee
    rekey1, owner_verifying_pub, _ = generate_rekey_with_metadata(owner_priv, grantee1_pub)
    rekey2, _, _ = generate_rekey_with_metadata(owner_priv, grantee2_pub)

    # Re-encrypt for each grantee
    cfrag1 = reencrypt_capsule(
        capsule=capsule,
        rekey=rekey1,
        verifying_pk=owner_verifying_pub,
        delegating_pk=owner_pub,
        receiving_pk=grantee1_pub,
    )
    cfrag2 = reencrypt_capsule(
        capsule=capsule,
        rekey=rekey2,
        verifying_pk=owner_verifying_pub,
        delegating_pk=owner_pub,
        receiving_pk=grantee2_pub,
    )

    # Each grantee should be able to decrypt
    grantee1_cek = decrypt_capsule_and_cek(
        cfrag1, grantee1_priv, encrypted_cek, owner_pub, capsule
    )
    grantee2_cek = decrypt_capsule_and_cek(
        cfrag2, grantee2_priv, encrypted_cek, owner_pub, capsule
    )

    # Both should recover the same CEK
    assert grantee1_cek == cek, "Grantee 1 should recover CEK"
    assert grantee2_cek == cek, "Grantee 2 should recover CEK"

    # Both should decrypt the data
    data1 = decrypt_bytes_with_cek(ciphertext, grantee1_cek, nonce)
    data2 = decrypt_bytes_with_cek(ciphertext, grantee2_cek, nonce)

    assert data1 == original_data, "Grantee 1 should recover original data"
    assert data2 == original_data, "Grantee 2 should recover original data"

    return True


def test_server_side_kfrag_from_secret_bytes():
    """
    Test server-side kfrag generation from raw secret key bytes.
    
    This tests the workflow where:
    1. Frontend decrypts patient's secret key (using passphrase)
    2. Frontend sends secret key bytes (hex) to server
    3. Server generates pyumbral-compatible kfrags
    4. Re-encryption works with server-generated kfrags
    
    This is the fix for WASM library (@nucypher/umbral-pre) incompatibility.
    """
    from app.utils.umbral_utils import generate_kfrag_from_secret_key_bytes
    from umbral import SecretKey, Signer, encrypt, Capsule, KeyFrag
    from umbral.pre import generate_kfrags, reencrypt as umbral_reencrypt
    
    # Simulate patient (Alice) with keys
    patient_sk = SecretKey.random()
    patient_pk = patient_sk.public_key()
    patient_signing_sk = SecretKey.random()
    
    # Simulate hospital (Bob) with keys
    hospital_sk = SecretKey.random()
    hospital_pk = hospital_sk.public_key()
    
    # Patient's secret key bytes (what frontend would send after decryption)
    patient_sk_bytes_hex = bytes(patient_sk.to_secret_bytes()).hex()
    patient_signing_sk_bytes_hex = bytes(patient_signing_sk.to_secret_bytes()).hex()
    hospital_pk_hex = bytes(hospital_pk).hex()
    
    # Generate kfrag using the new server-side function
    kfrag_hex, verifying_key_hex = generate_kfrag_from_secret_key_bytes(
        delegating_sk_bytes_hex=patient_sk_bytes_hex,
        receiving_pk_hex=hospital_pk_hex,
        signing_sk_bytes_hex=patient_signing_sk_bytes_hex,
    )
    
    # Verify kfrag is 260 bytes (pyumbral format, not 310 bytes WASM format)
    kfrag_bytes = bytes.fromhex(kfrag_hex)
    assert len(kfrag_bytes) == 260, f"KFrag should be 260 bytes (pyumbral), got {len(kfrag_bytes)}"
    
    # Verify the kfrag can be parsed by pyumbral
    kfrag = KeyFrag.from_bytes(kfrag_bytes)
    assert kfrag is not None, "KFrag should be parseable by pyumbral"
    
    # Test full re-encryption flow with server-generated kfrag
    # 1. Patient encrypts data
    test_data = b"Patient medical record"
    capsule, encrypted_data = encrypt(patient_pk, test_data)
    
    # 2. Verify kfrag and re-encrypt
    from umbral import PublicKey
    verifying_pk = PublicKey.from_bytes(bytes.fromhex(verifying_key_hex))
    verified_kfrag = kfrag.verify(
        verifying_pk=verifying_pk,
        delegating_pk=patient_pk,
        receiving_pk=hospital_pk,
    )
    
    cfrag = umbral_reencrypt(capsule, verified_kfrag)
    
    # 3. Hospital decrypts with their key
    from umbral.pre import decrypt_reencrypted
    decrypted_data = decrypt_reencrypted(
        receiving_sk=hospital_sk,
        delegating_pk=patient_pk,
        capsule=capsule,
        verified_cfrags=[cfrag],
        ciphertext=encrypted_data,
    )
    
    assert decrypted_data == test_data, "Hospital should decrypt original data"
    
    return True


if __name__ == "__main__":
    try:
        # Run all tests
        test_key_storage_and_retrieval()
        test_pyumbral_full_flow_with_encrypted_keys()
        test_pyumbral_full_flow_simple()
        test_encrypt_bytes_directly()
        test_multiple_grantees()
        test_server_side_kfrag_from_secret_bytes()

        # All tests passed
        print("PYUMBRAL FLOW OK")
        sys.exit(0)

    except Exception as e:
        print(f"TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
