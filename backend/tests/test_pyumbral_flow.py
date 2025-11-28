#!/usr/bin/env python3
"""
Test script for pyUmbral Proxy Re-Encryption flow.

This test demonstrates the complete PRE workflow:
1. Alice (owner) and Bob (grantee) generate keypairs
2. Alice encrypts sample data with a CEK
3. Alice encapsulates the CEK with her public key
4. Alice generates a re-encryption key for Bob
5. A proxy re-encrypts the capsule for Bob
6. Bob decrypts and recovers the original data

On success, prints only: "PYUMBRAL FLOW OK"
"""

import sys
import os
import tempfile

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from crypto.umbral_utils import (
    generate_umbral_keypair,
    encrypt_file_with_cek,
    encrypt_bytes_with_cek,
    decrypt_bytes_with_cek,
    encapsulate_cek,
    generate_rekey,
    reencrypt_capsule,
    decrypt_capsule_and_cek,
    decrypt_original,
)


def test_pyumbral_full_flow():
    """
    Test the complete pyUmbral proxy re-encryption flow.

    Scenario:
    - Alice (data owner) wants to share encrypted data with Bob (grantee)
    - A proxy performs the re-encryption without seeing the plaintext
    """
    # ==========================================================================
    # Step 1: Key Generation - Both users generate keypairs
    # ==========================================================================
    alice_priv, alice_pub = generate_umbral_keypair()
    bob_priv, bob_pub = generate_umbral_keypair()

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
        assert len(ciphertext) > len(original_data), "Ciphertext should include auth tag"

    finally:
        # Clean up temp file
        os.unlink(temp_file_path)

    # Verify we can decrypt with the CEK
    decrypted_data = decrypt_bytes_with_cek(ciphertext, cek, nonce)
    assert decrypted_data == original_data, "Direct CEK decryption should recover original data"

    # ==========================================================================
    # Step 3: Alice encapsulates the CEK with her public key
    # ==========================================================================
    capsule, encrypted_cek = encapsulate_cek(cek, alice_pub)

    assert len(capsule) > 0, "Capsule should not be empty"
    assert len(encrypted_cek) > 0, "Encrypted CEK should not be empty"

    # Verify Alice can decrypt her own encapsulated CEK
    recovered_cek = decrypt_original(capsule, alice_priv, encrypted_cek)
    assert recovered_cek == cek, "Alice should be able to decrypt her own CEK"

    # ==========================================================================
    # Step 4: Alice generates a re-encryption key for Bob
    # ==========================================================================
    rekey, alice_verifying_pub, _ = generate_rekey(alice_priv, bob_pub)

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

    # ==========================================================================
    # Success!
    # ==========================================================================
    return True


def test_encrypt_bytes_directly():
    """Test encrypting and decrypting bytes directly (without file)."""
    alice_priv, alice_pub = generate_umbral_keypair()
    bob_priv, bob_pub = generate_umbral_keypair()

    # Original data
    original_data = b"Direct bytes encryption test data - patient vitals: 120/80 mmHg"

    # Generate CEK and encrypt
    cek = os.urandom(32)
    ciphertext, nonce, tag = encrypt_bytes_with_cek(original_data, cek)

    # Verify direct decryption works
    decrypted = decrypt_bytes_with_cek(ciphertext, cek, nonce)
    assert decrypted == original_data, "Direct decryption should work"

    # Now test the full PRE flow with these bytes
    capsule, encrypted_cek = encapsulate_cek(cek, alice_pub)
    rekey, alice_verifying_pub, _ = generate_rekey(alice_priv, bob_pub)
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
    owner_priv, owner_pub = generate_umbral_keypair()
    grantee1_priv, grantee1_pub = generate_umbral_keypair()
    grantee2_priv, grantee2_pub = generate_umbral_keypair()

    # Original data
    original_data = b"Medical record accessible by multiple doctors"
    cek = os.urandom(32)
    ciphertext, nonce, tag = encrypt_bytes_with_cek(original_data, cek)

    # Encapsulate CEK
    capsule, encrypted_cek = encapsulate_cek(cek, owner_pub)

    # Generate separate rekeys for each grantee
    rekey1, owner_verifying_pub, _ = generate_rekey(owner_priv, grantee1_pub)
    rekey2, _, _ = generate_rekey(owner_priv, grantee2_pub)

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


if __name__ == "__main__":
    try:
        # Run all tests
        test_pyumbral_full_flow()
        test_encrypt_bytes_directly()
        test_multiple_grantees()

        # All tests passed
        print("PYUMBRAL FLOW OK")
        sys.exit(0)

    except Exception as e:
        print(f"TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
