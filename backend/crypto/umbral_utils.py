"""
Umbral Proxy Re-Encryption Utilities

This module provides clean, well-documented wrapper functions for pyUmbral operations:

- Key generation (Umbral keypairs)
- File encryption with AES-256-GCM Content Encryption Keys (CEK)
- Umbral encapsulation of CEKs
- Re-encryption key (kfrag) generation for proxy re-encryption
- Capsule re-encryption
- Decryption of re-encrypted capsules

The pyUmbral library implements the Umbral threshold proxy re-encryption scheme,
which allows a proxy to transform ciphertexts from one public key to another
without learning the underlying plaintext.

Reference: https://github.com/nucypher/pyUmbral
"""

import os
from typing import Tuple

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from umbral import (
    SecretKey,
    PublicKey,
    Signer,
    Capsule,
    KeyFrag,
    VerifiedKeyFrag,
    CapsuleFrag,
    VerifiedCapsuleFrag,
    encrypt,
    decrypt_original as umbral_decrypt_original,
    decrypt_reencrypted,
    generate_kfrags,
    reencrypt as umbral_reencrypt,
)


# =============================================================================
# Key Generation
# =============================================================================


def generate_umbral_keypair() -> Tuple[str, str]:
    """
    Generate a new Umbral keypair.

    Returns a tuple containing:
    - private_key_hex_placeholder: Hex-encoded secret key bytes
      (In production, this should be stored securely, e.g., HSM or encrypted storage)
    - public_key_pem: Hex-encoded public key bytes
      (Called 'pem' per spec but actually hex-encoded for Umbral compatibility)

    Returns:
        Tuple[str, str]: (private_key_hex_placeholder, public_key_pem)

    Example:
        >>> priv, pub = generate_umbral_keypair()
        >>> len(priv) > 0 and len(pub) > 0
        True
    """
    secret_key = SecretKey.random()
    public_key = secret_key.public_key()

    # SecretKey uses to_secret_bytes(), PublicKey uses bytes()
    private_key_hex = secret_key.to_secret_bytes().hex()
    public_key_hex = bytes(public_key).hex()

    return private_key_hex, public_key_hex


# =============================================================================
# File Encryption (AES-256-GCM)
# =============================================================================


def encrypt_file_with_cek(file_path: str) -> Tuple[bytes, bytes, bytes, bytes]:
    """
    Encrypt a file using AES-256-GCM with a randomly generated Content Encryption Key (CEK).

    This function:
    1. Reads the file contents
    2. Generates a random 256-bit CEK
    3. Generates a random 96-bit nonce
    4. Encrypts the file using AES-256-GCM

    Args:
        file_path: Path to the file to encrypt

    Returns:
        Tuple containing:
        - ciphertext_bytes: The encrypted file data (includes GCM auth tag appended)
        - cek_bytes: The 32-byte Content Encryption Key (must be protected!)
        - nonce: The 12-byte nonce used for encryption
        - tag: The 16-byte GCM authentication tag (extracted from ciphertext)

    Note:
        AES-GCM in cryptography library appends the 16-byte tag to the ciphertext.
        The tag is extracted and returned separately for clarity.

    Example:
        >>> ciphertext, cek, nonce, tag = encrypt_file_with_cek("/path/to/file.txt")
        >>> len(cek) == 32 and len(nonce) == 12 and len(tag) == 16
        True
    """
    # Read file contents
    with open(file_path, "rb") as f:
        plaintext = f.read()

    # Generate random CEK (256 bits = 32 bytes)
    cek_bytes = os.urandom(32)

    # Generate random nonce (96 bits = 12 bytes, recommended for GCM)
    nonce = os.urandom(12)

    # Encrypt using AES-256-GCM
    aesgcm = AESGCM(cek_bytes)
    ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext, associated_data=None)

    # AES-GCM appends a 16-byte authentication tag to the ciphertext
    # Extract it separately for the return value
    tag = ciphertext_with_tag[-16:]
    ciphertext_bytes = ciphertext_with_tag  # Keep full ciphertext (with tag) for decryption

    return ciphertext_bytes, cek_bytes, nonce, tag


def encrypt_bytes_with_cek(plaintext: bytes, cek: bytes) -> Tuple[bytes, bytes, bytes]:
    """
    Encrypt arbitrary bytes using AES-256-GCM with the provided CEK.

    Args:
        plaintext: The data to encrypt
        cek: The 32-byte Content Encryption Key

    Returns:
        Tuple containing:
        - ciphertext_bytes: The encrypted data (includes GCM auth tag)
        - nonce: The 12-byte nonce used
        - tag: The 16-byte GCM authentication tag

    Example:
        >>> ciphertext, nonce, tag = encrypt_bytes_with_cek(b"hello", os.urandom(32))
    """
    nonce = os.urandom(12)
    aesgcm = AESGCM(cek)
    ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext, associated_data=None)
    tag = ciphertext_with_tag[-16:]
    return ciphertext_with_tag, nonce, tag


def decrypt_bytes_with_cek(ciphertext: bytes, cek: bytes, nonce: bytes) -> bytes:
    """
    Decrypt AES-256-GCM encrypted data using the provided CEK.

    Args:
        ciphertext: The encrypted data (includes GCM auth tag)
        cek: The 32-byte Content Encryption Key
        nonce: The 12-byte nonce used during encryption

    Returns:
        The decrypted plaintext bytes

    Raises:
        InvalidTag: If authentication fails (data was tampered with)

    Example:
        >>> plaintext = decrypt_bytes_with_cek(ciphertext, cek, nonce)
    """
    aesgcm = AESGCM(cek)
    return aesgcm.decrypt(nonce, ciphertext, associated_data=None)


# =============================================================================
# Umbral Encapsulation
# =============================================================================


def encapsulate_cek(cek: bytes, owner_pub: str) -> Tuple[bytes, bytes]:
    """
    Encapsulate a Content Encryption Key (CEK) for the owner using Umbral.

    This creates a "capsule" that wraps the CEK such that:
    1. The owner can decrypt directly with their private key
    2. The capsule can later be re-encrypted for a grantee

    Args:
        cek: The Content Encryption Key bytes to encapsulate
        owner_pub: The owner's public key as hex string

    Returns:
        Tuple containing:
        - capsule: Serialized Umbral capsule bytes
        - encrypted_cek_blob: The encrypted CEK bytes

    Note:
        The capsule is essential for both direct decryption and re-encryption.
        Store it alongside the encrypted CEK.

    Example:
        >>> capsule, encrypted_cek = encapsulate_cek(cek, owner_public_key_hex)
    """
    # Deserialize owner's public key from hex
    owner_public_key = PublicKey.from_bytes(bytes.fromhex(owner_pub))

    # Encrypt (encapsulate) the CEK for the owner
    capsule, encrypted_cek = encrypt(owner_public_key, cek)

    # Serialize capsule and return
    capsule_bytes = bytes(capsule)
    encrypted_cek_blob = encrypted_cek

    return capsule_bytes, encrypted_cek_blob


# =============================================================================
# Re-encryption Key Generation
# =============================================================================


def generate_rekey(owner_priv: str, grantee_pub: str) -> Tuple[bytes, str, str]:
    """
    Generate a re-encryption key (kfrag) from owner to grantee.

    This creates a key fragment that allows a proxy to re-encrypt capsules
    from the owner's public key to the grantee's public key, without the proxy
    learning the plaintext or the owner's private key.

    Args:
        owner_priv: The owner's private (secret) key as hex string
        grantee_pub: The grantee's public key as hex string

    Returns:
        Tuple containing:
        - rekey_bytes: Serialized re-encryption key fragment (kfrag) bytes
        - owner_pub: Owner's public key hex (needed for verification)
        - grantee_pub: Grantee's public key hex (needed for verification)

    Note:
        This implements a 1-of-1 threshold scheme for simplicity.
        For production use with multiple proxies, consider threshold > 1.

    Security:
        The owner's private key is required to generate the kfrag.
        This operation should happen on a trusted system.

    Example:
        >>> rekey, owner_pub, grantee_pub = generate_rekey(owner_private_hex, grantee_public_hex)
    """
    # Deserialize keys from hex
    owner_secret_key = SecretKey.from_bytes(bytes.fromhex(owner_priv))
    grantee_public_key = PublicKey.from_bytes(bytes.fromhex(grantee_pub))
    owner_public_key = owner_secret_key.public_key()

    # Create a signer using the owner's key (required by pyUmbral)
    signer = Signer(owner_secret_key)

    # Generate key fragments (kfrags)
    # Using threshold=1, shares=1 for simplicity (no secret sharing)
    kfrags = generate_kfrags(
        delegating_sk=owner_secret_key,
        receiving_pk=grantee_public_key,
        signer=signer,
        threshold=1,
        shares=1,
    )

    # Return the first (and only) kfrag serialized along with verification keys
    rekey_bytes = bytes(kfrags[0])
    owner_pub_hex = bytes(owner_public_key).hex()
    return rekey_bytes, owner_pub_hex, grantee_pub


# =============================================================================
# Capsule Re-encryption
# =============================================================================


def reencrypt_capsule(
    capsule: bytes,
    rekey: bytes,
    verifying_pk: str,
    delegating_pk: str,
    receiving_pk: str,
) -> bytes:
    """
    Re-encrypt a capsule using a re-encryption key (kfrag).

    This transforms the capsule so that the grantee (for whom the rekey was
    generated) can decrypt the associated ciphertext.

    Args:
        capsule: The original serialized capsule bytes
        rekey: The re-encryption key fragment (kfrag) bytes
        verifying_pk: The signer's public key hex (owner's public key)
        delegating_pk: The delegator's public key hex (owner's public key)
        receiving_pk: The recipient's public key hex (grantee's public key)

    Returns:
        Serialized capsule fragment (cfrag) bytes

    Note:
        The cfrag is needed along with the original capsule for decryption
        by the grantee.

    Example:
        >>> cfrag = reencrypt_capsule(capsule_bytes, rekey_bytes, owner_pub, owner_pub, grantee_pub)
    """
    # Deserialize capsule and kfrag
    capsule_obj = Capsule.from_bytes(capsule)
    kfrag_obj = KeyFrag.from_bytes(rekey)

    # Deserialize verification public keys
    verifying_public_key = PublicKey.from_bytes(bytes.fromhex(verifying_pk))
    delegating_public_key = PublicKey.from_bytes(bytes.fromhex(delegating_pk))
    receiving_public_key = PublicKey.from_bytes(bytes.fromhex(receiving_pk))

    # Verify the kfrag before re-encryption (required by pyUmbral)
    verified_kfrag = kfrag_obj.verify(
        verifying_pk=verifying_public_key,
        delegating_pk=delegating_public_key,
        receiving_pk=receiving_public_key,
    )

    # Perform re-encryption with verified kfrag
    cfrag = umbral_reencrypt(capsule_obj, verified_kfrag)

    # Serialize and return
    reenc_capsule_bytes = bytes(cfrag)
    return reenc_capsule_bytes


# =============================================================================
# Decryption
# =============================================================================


def decrypt_capsule_and_cek(
    reenc_capsule: bytes,
    grantee_priv: str,
    ciphertext: bytes,
    owner_pub: str,
    original_capsule: bytes,
) -> bytes:
    """
    Decrypt a re-encrypted capsule and recover the plaintext.

    This function is used by the grantee to decrypt data that was originally
    encrypted for the owner, after the owner has generated a re-encryption key.

    Args:
        reenc_capsule: The re-encrypted capsule fragment (cfrag) bytes
        grantee_priv: The grantee's private key as hex string
        ciphertext: The original encrypted CEK bytes (from encapsulate_cek)
        owner_pub: The owner's public key as hex string (delegator)
        original_capsule: The original capsule bytes (from encapsulate_cek)

    Returns:
        The decrypted plaintext bytes (the original CEK)

    Note:
        The grantee needs:
        1. Their private key
        2. The original capsule
        3. The cfrag from re-encryption
        4. The owner's public key
        5. The encrypted ciphertext

    Example:
        >>> plaintext = decrypt_capsule_and_cek(
        ...     cfrag, grantee_priv, encrypted_cek, owner_pub, capsule
        ... )
    """
    # Deserialize keys
    grantee_secret_key = SecretKey.from_bytes(bytes.fromhex(grantee_priv))
    grantee_public_key = grantee_secret_key.public_key()
    owner_public_key = PublicKey.from_bytes(bytes.fromhex(owner_pub))

    # Deserialize capsule and cfrag
    capsule_obj = Capsule.from_bytes(original_capsule)
    cfrag_obj = CapsuleFrag.from_bytes(reenc_capsule)

    # Verify the cfrag before decryption
    # This ensures the cfrag was created correctly for this capsule and recipient
    verified_cfrag = cfrag_obj.verify(
        capsule=capsule_obj,
        verifying_pk=owner_public_key,  # The signer's public key (owner signed the kfrag)
        delegating_pk=owner_public_key,
        receiving_pk=grantee_public_key,
    )

    # Decrypt using the verified cfrag
    plaintext = decrypt_reencrypted(
        receiving_sk=grantee_secret_key,
        delegating_pk=owner_public_key,
        capsule=capsule_obj,
        verified_cfrags=[verified_cfrag],
        ciphertext=ciphertext,
    )

    return plaintext


def decrypt_original(
    capsule: bytes,
    owner_priv: str,
    ciphertext: bytes,
) -> bytes:
    """
    Decrypt a capsule directly using the owner's private key.

    This is used when the owner wants to decrypt their own data without
    any re-encryption involved.

    Args:
        capsule: The capsule bytes (from encapsulate_cek)
        owner_priv: The owner's private key as hex string
        ciphertext: The encrypted CEK bytes

    Returns:
        The decrypted plaintext bytes (the original CEK)

    Example:
        >>> cek = decrypt_original(capsule, owner_priv_hex, encrypted_cek)
    """
    # Deserialize key and capsule
    owner_secret_key = SecretKey.from_bytes(bytes.fromhex(owner_priv))
    capsule_obj = Capsule.from_bytes(capsule)

    # Decrypt directly using umbral's decrypt_original
    # The parameter name is 'delegating_sk' (the owner who delegated/encrypted)
    plaintext = umbral_decrypt_original(
        delegating_sk=owner_secret_key,
        capsule=capsule_obj,
        ciphertext=ciphertext,
    )

    return plaintext
