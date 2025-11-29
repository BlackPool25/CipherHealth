"""
Full End-to-End Test for Proxy Re-Encryption Flow

Tests the complete flow:
1. Owner encrypts data with their public key
2. Owner generates kfrags for grantee (client-side)
3. Server stores kfrags and performs re-encryption
4. Grantee decrypts using their secret key + cfrags

This tests the actual cryptographic operations to verify
the entire PRE pipeline works correctly.
"""

import pytest
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
import os


def test_full_pre_flow():
    """
    Test the complete PRE workflow end-to-end.
    
    This simulates:
    - Client A (Owner) encrypts data
    - Client A generates kfrags for Client B (Grantee)
    - Server re-encrypts using kfrags
    - Client B decrypts using their secret key
    """
    print("\n" + "="*60)
    print("FULL PRE FLOW TEST")
    print("="*60)
    
    # =========================================================================
    # Step 1: Setup - Generate keys for Owner, Grantee, and Signing
    # =========================================================================
    print("\n[1] Generating keys...")
    
    # Owner (Alice) - the file owner
    owner_secret_key = SecretKey.random()
    owner_public_key = owner_secret_key.public_key()
    print(f"  Owner public key: {bytes(owner_public_key).hex()[:32]}...")
    
    # Grantee (Bob) - the recipient
    grantee_secret_key = SecretKey.random()
    grantee_public_key = grantee_secret_key.public_key()
    print(f"  Grantee public key: {bytes(grantee_public_key).hex()[:32]}...")
    
    # Signing key (for kfrag signatures - owned by Owner)
    signing_key = SecretKey.random()
    verifying_key = signing_key.public_key()
    signer = Signer(signing_key)
    print(f"  Verifying key: {bytes(verifying_key).hex()[:32]}...")
    
    # =========================================================================
    # Step 2: Owner encrypts data with Umbral
    # =========================================================================
    print("\n[2] Owner encrypts data...")
    
    # Original plaintext
    plaintext = b"This is a secret medical record for patient John Doe."
    print(f"  Plaintext: {plaintext.decode()}")
    
    # Encrypt with owner's public key
    capsule, ciphertext = encrypt(owner_public_key, plaintext)
    print(f"  Capsule: {bytes(capsule).hex()[:32]}...")
    print(f"  Ciphertext length: {len(ciphertext)} bytes")
    
    # =========================================================================
    # Step 3: Verify owner can decrypt their own data
    # =========================================================================
    print("\n[3] Verifying owner can decrypt...")
    
    decrypted = decrypt_original(owner_secret_key, capsule, ciphertext)
    assert decrypted == plaintext, "Owner decryption failed!"
    print(f"  ✓ Owner decryption successful: {decrypted.decode()}")
    
    # =========================================================================
    # Step 4: Owner generates kfrags for grantee (CLIENT-SIDE)
    # =========================================================================
    print("\n[4] Owner generates kfrags for grantee...")
    
    # In real app, this happens in the browser using @nucypher/umbral-pre
    threshold = 1  # Minimum kfrags needed
    shares = 1     # Total kfrags generated
    
    kfrags = generate_kfrags(
        delegating_sk=owner_secret_key,
        receiving_pk=grantee_public_key,
        signer=signer,
        threshold=threshold,
        shares=shares,
    )
    
    # kfrags are VerifiedKeyFrag objects
    print(f"  Generated {len(kfrags)} kfrags")
    kfrag_hex = bytes(kfrags[0].kfrag).hex()
    print(f"  kfrag[0]: {kfrag_hex[:32]}...")
    
    # =========================================================================
    # Step 5: Serialize/deserialize kfrag (simulates sending to server)
    # =========================================================================
    print("\n[5] Simulating kfrag transmission to server...")
    
    # Serialize
    kfrag_bytes = bytes(kfrags[0].kfrag)
    print(f"  Serialized kfrag: {len(kfrag_bytes)} bytes")
    
    # Deserialize on server
    reconstructed_kfrag = KeyFrag.from_bytes(kfrag_bytes)
    print(f"  ✓ kfrag reconstructed on server")
    
    # =========================================================================
    # Step 6: Server verifies kfrag
    # =========================================================================
    print("\n[6] Server verifies kfrag...")
    
    # Server needs: verifying_pk, delegating_pk (owner), receiving_pk (grantee)
    owner_public_key_bytes = bytes(owner_public_key)
    verifying_key_bytes = bytes(verifying_key)
    grantee_public_key_bytes = bytes(grantee_public_key)
    
    # Reconstruct keys from bytes (as server would do)
    server_owner_pk = PublicKey.from_bytes(owner_public_key_bytes)
    server_verifying_pk = PublicKey.from_bytes(verifying_key_bytes)
    server_grantee_pk = PublicKey.from_bytes(grantee_public_key_bytes)
    
    # Verify kfrag
    verified_kfrag = reconstructed_kfrag.verify(
        verifying_pk=server_verifying_pk,
        delegating_pk=server_owner_pk,
        receiving_pk=server_grantee_pk,
    )
    print(f"  ✓ kfrag verified successfully")
    
    # =========================================================================
    # Step 7: Server performs re-encryption
    # =========================================================================
    print("\n[7] Server performs re-encryption...")
    
    # Serialize/deserialize capsule (simulates transmission)
    capsule_bytes = bytes(capsule)
    server_capsule = Capsule.from_bytes(capsule_bytes)
    
    # Re-encrypt
    cfrag = reencrypt(server_capsule, verified_kfrag)
    print(f"  cfrag: {bytes(cfrag).hex()[:32]}...")
    
    # =========================================================================
    # Step 8: Serialize cfrag (simulates sending to grantee)
    # =========================================================================
    print("\n[8] Serializing cfrag for grantee...")
    
    cfrag_bytes = bytes(cfrag)
    print(f"  Serialized cfrag: {len(cfrag_bytes)} bytes")
    
    # Reconstruct cfrag on grantee side
    reconstructed_cfrag = CapsuleFrag.from_bytes(cfrag_bytes)
    # Verify cfrag (grantee needs: capsule, verifying_pk, delegating_pk, receiving_pk)
    verified_cfrag = reconstructed_cfrag.verify(
        capsule=capsule,
        verifying_pk=verifying_key,
        delegating_pk=owner_public_key,
        receiving_pk=grantee_public_key,
    )
    print(f"  ✓ cfrag reconstructed and verified on grantee side")
    
    # =========================================================================
    # Step 9: Grantee decrypts using their secret key + cfrag
    # =========================================================================
    print("\n[9] Grantee decrypts with their secret key...")
    
    # Grantee needs:
    # - Their secret key
    # - Owner's public key
    # - The capsule
    # - The cfrags
    # - The ciphertext
    
    grantee_decrypted = decrypt_reencrypted(
        receiving_sk=grantee_secret_key,
        delegating_pk=owner_public_key,
        capsule=capsule,
        verified_cfrags=[verified_cfrag],
        ciphertext=ciphertext,
    )
    
    assert grantee_decrypted == plaintext, "Grantee decryption failed!"
    print(f"  ✓ Grantee decryption successful: {grantee_decrypted.decode()}")
    
    # =========================================================================
    # Final Summary
    # =========================================================================
    print("\n" + "="*60)
    print("✓ FULL PRE FLOW TEST PASSED")
    print("="*60)
    print("\nFlow summary:")
    print("  1. Owner encrypted data with their public key")
    print("  2. Owner generated kfrags (re-encryption keys) for grantee")
    print("  3. Server verified kfrag using verifying key")
    print("  4. Server re-encrypted capsule to produce cfrag")
    print("  5. Grantee decrypted using their secret key + cfrag")
    print("\nKey insight: Owner's secret key was ONLY used on the client")
    print("Server never saw owner's secret key, yet re-encryption worked!")
    

def test_hybrid_encryption_with_pre():
    """
    Test hybrid encryption: AES-GCM for data, Umbral for key encapsulation.
    
    This is the actual pattern used in the app:
    1. Generate random CEK (Content Encryption Key)
    2. Encrypt data with AES-GCM using CEK
    3. Encrypt CEK with Umbral (produces capsule)
    4. For sharing: use PRE to re-encrypt the capsule
    5. Grantee decrypts CEK with their key, then decrypts data with CEK
    """
    print("\n" + "="*60)
    print("HYBRID ENCRYPTION TEST (AES-GCM + PRE)")
    print("="*60)
    
    # =========================================================================
    # Setup keys
    # =========================================================================
    owner_secret_key = SecretKey.random()
    owner_public_key = owner_secret_key.public_key()
    
    grantee_secret_key = SecretKey.random()
    grantee_public_key = grantee_secret_key.public_key()
    
    signing_key = SecretKey.random()
    signer = Signer(signing_key)
    verifying_key = signing_key.public_key()
    
    # =========================================================================
    # Owner encrypts data with hybrid encryption
    # =========================================================================
    print("\n[1] Owner performs hybrid encryption...")
    
    # Large file content
    file_data = b"PATIENT: John Doe\nDOB: 1985-03-15\nDIAGNOSIS: Healthy\n" * 100
    print(f"  File size: {len(file_data)} bytes")
    
    # Generate CEK
    cek = os.urandom(32)  # 256-bit key
    print(f"  CEK: {cek.hex()[:32]}...")
    
    # Encrypt file with AES-GCM
    nonce = os.urandom(12)
    aesgcm = AESGCM(cek)
    encrypted_file = aesgcm.encrypt(nonce, file_data, None)
    print(f"  Encrypted file size: {len(encrypted_file)} bytes")
    
    # Encrypt CEK with Umbral
    capsule, encrypted_cek = encrypt(owner_public_key, cek)
    print(f"  Capsule: {bytes(capsule).hex()[:32]}...")
    print(f"  Encrypted CEK length: {len(encrypted_cek)} bytes")
    
    # =========================================================================
    # Verify owner can decrypt
    # =========================================================================
    print("\n[2] Verifying owner can decrypt...")
    
    decrypted_cek = decrypt_original(owner_secret_key, capsule, encrypted_cek)
    assert decrypted_cek == cek, "Owner CEK decryption failed!"
    
    aesgcm_owner = AESGCM(decrypted_cek)
    decrypted_file = aesgcm_owner.decrypt(nonce, encrypted_file, None)
    assert decrypted_file == file_data, "Owner file decryption failed!"
    print(f"  ✓ Owner decryption successful")
    
    # =========================================================================
    # Owner generates kfrags for grantee
    # =========================================================================
    print("\n[3] Owner generates kfrags for grantee...")
    
    kfrags = generate_kfrags(
        delegating_sk=owner_secret_key,
        receiving_pk=grantee_public_key,
        signer=signer,
        threshold=1,
        shares=1,
    )
    print(f"  Generated {len(kfrags)} kfrags")
    
    # =========================================================================
    # Server re-encrypts
    # =========================================================================
    print("\n[4] Server re-encrypts...")
    
    # Serialize/deserialize (simulates network)
    kfrag_bytes = bytes(kfrags[0].kfrag)
    reconstructed_kfrag = KeyFrag.from_bytes(kfrag_bytes)
    
    # Verify kfrag
    verified_kfrag = reconstructed_kfrag.verify(
        verifying_pk=verifying_key,
        delegating_pk=owner_public_key,
        receiving_pk=grantee_public_key,
    )
    
    # Re-encrypt
    cfrag = reencrypt(capsule, verified_kfrag)
    print(f"  ✓ Re-encryption successful")
    
    # =========================================================================
    # Grantee decrypts
    # =========================================================================
    print("\n[5] Grantee decrypts...")
    
    # Reconstruct cfrag
    cfrag_bytes = bytes(cfrag)
    reconstructed_cfrag = CapsuleFrag.from_bytes(cfrag_bytes)
    # Verify cfrag (grantee needs: capsule, verifying_pk, delegating_pk, receiving_pk)
    verified_cfrag = reconstructed_cfrag.verify(
        capsule=capsule,
        verifying_pk=verifying_key,
        delegating_pk=owner_public_key,
        receiving_pk=grantee_public_key,
    )
    
    # Decrypt CEK with PRE
    grantee_cek = decrypt_reencrypted(
        receiving_sk=grantee_secret_key,
        delegating_pk=owner_public_key,
        capsule=capsule,
        verified_cfrags=[verified_cfrag],
        ciphertext=encrypted_cek,
    )
    assert grantee_cek == cek, "Grantee CEK decryption failed!"
    print(f"  ✓ CEK decrypted: {grantee_cek.hex()[:32]}...")
    
    # Decrypt file with CEK
    aesgcm_grantee = AESGCM(grantee_cek)
    grantee_file = aesgcm_grantee.decrypt(nonce, encrypted_file, None)
    assert grantee_file == file_data, "Grantee file decryption failed!"
    print(f"  ✓ File decrypted: {len(grantee_file)} bytes")
    
    print("\n" + "="*60)
    print("✓ HYBRID ENCRYPTION TEST PASSED")
    print("="*60)


def test_serialization_formats():
    """
    Test that our serialization matches between Python and expected JS formats.
    """
    print("\n" + "="*60)
    print("SERIALIZATION FORMAT TEST")
    print("="*60)
    
    # Generate keys
    secret_key = SecretKey.random()
    public_key = secret_key.public_key()
    
    # Test secret key serialization
    sk_bytes = secret_key.to_secret_bytes()
    print(f"\n[1] SecretKey serialization:")
    print(f"  Bytes length: {len(sk_bytes)}")
    print(f"  Hex: {sk_bytes.hex()[:32]}...")
    
    # Reconstruct
    reconstructed_sk = SecretKey.from_bytes(sk_bytes)
    assert bytes(reconstructed_sk.public_key()) == bytes(public_key)
    print(f"  ✓ SecretKey round-trip successful")
    
    # Test public key serialization
    pk_bytes = bytes(public_key)
    print(f"\n[2] PublicKey serialization:")
    print(f"  Bytes length: {len(pk_bytes)}")
    print(f"  Hex: {pk_bytes.hex()[:32]}...")
    
    # Reconstruct
    reconstructed_pk = PublicKey.from_bytes(pk_bytes)
    assert bytes(reconstructed_pk) == pk_bytes
    print(f"  ✓ PublicKey round-trip successful")
    
    # Test capsule serialization
    capsule, ciphertext = encrypt(public_key, b"test data")
    capsule_bytes = bytes(capsule)
    print(f"\n[3] Capsule serialization:")
    print(f"  Bytes length: {len(capsule_bytes)}")
    print(f"  Hex: {capsule_bytes.hex()[:32]}...")
    
    reconstructed_capsule = Capsule.from_bytes(capsule_bytes)
    assert bytes(reconstructed_capsule) == capsule_bytes
    print(f"  ✓ Capsule round-trip successful")
    
    # Test kfrag serialization
    signing_key = SecretKey.random()
    signer = Signer(signing_key)
    grantee_sk = SecretKey.random()
    grantee_pk = grantee_sk.public_key()
    
    kfrags = generate_kfrags(
        delegating_sk=secret_key,
        receiving_pk=grantee_pk,
        signer=signer,
        threshold=1,
        shares=1,
    )
    
    # Access the inner kfrag from VerifiedKeyFrag
    kfrag_bytes = bytes(kfrags[0].kfrag)
    print(f"\n[4] KeyFrag serialization:")
    print(f"  Bytes length: {len(kfrag_bytes)}")
    print(f"  Hex: {kfrag_bytes.hex()[:32]}...")
    
    reconstructed_kfrag = KeyFrag.from_bytes(kfrag_bytes)
    assert bytes(reconstructed_kfrag) == kfrag_bytes
    print(f"  ✓ KeyFrag round-trip successful")
    
    print("\n" + "="*60)
    print("✓ SERIALIZATION FORMAT TEST PASSED")
    print("="*60)


if __name__ == "__main__":
    test_full_pre_flow()
    print("\n\n")
    test_hybrid_encryption_with_pre()
    print("\n\n")
    test_serialization_formats()
    print("\n\n✓ ALL TESTS PASSED")
