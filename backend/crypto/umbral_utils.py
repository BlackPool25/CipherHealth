"""
Umbral Proxy Re-Encryption Utilities

This module provides clean, well-documented wrapper functions for pyUmbral operations:

- Key generation (Umbral keypairs) with passphrase-encrypted storage
- Secure key storage and retrieval with passphrase protection
- File encryption with AES-256-GCM Content Encryption Keys (CEK)
- Umbral encapsulation of CEKs
- Re-encryption key (kfrag) generation for proxy re-encryption
- Capsule re-encryption
- Decryption of re-encrypted capsules

The pyUmbral library implements the Umbral threshold proxy re-encryption scheme,
which allows a proxy to transform ciphertexts from one public key to another
without learning the underlying plaintext.

Reference Documentation Used:
- pyUmbral GitHub Repository: https://github.com/nucypher/pyUmbral
- pyUmbral ReadTheDocs API: https://pyumbral.readthedocs.io/en/latest/api.html
- pyUmbral Usage Guide: https://pyumbral.readthedocs.io/en/latest/using_pyumbral.html
- Umbral Whitepaper: https://github.com/nucypher/umbral-doc/blob/master/umbral-doc.pdf

Security Notes:
- Private keys are NEVER stored in plaintext
- All private key storage uses passphrase-based encryption (PBKDF2 + AES-256-GCM)
- The implementation uses audited cryptographic libraries only:
  - pyUmbral (NuCypher's official Umbral implementation)
  - cryptography.io (for AES-GCM and key derivation)
"""

import os
import hashlib
import json
from pathlib import Path
from typing import Dict, Optional, Tuple, Union

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
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
# Constants
# =============================================================================

# PBKDF2 parameters (OWASP recommended minimum iterations for 2023+)
PBKDF2_ITERATIONS = 600_000
PBKDF2_SALT_SIZE = 32
AES_KEY_SIZE = 32  # 256 bits
AES_NONCE_SIZE = 12  # 96 bits (GCM recommended)

# Default key storage directory
DEFAULT_KEYS_DIR = Path(__file__).parent.parent / "keys"


# =============================================================================
# Passphrase-Based Key Derivation
# =============================================================================


def _derive_key_from_passphrase(passphrase: str, salt: bytes) -> bytes:
    """
    Derive a 256-bit AES key from a passphrase using PBKDF2-HMAC-SHA256.

    Args:
        passphrase: User-provided passphrase
        salt: Random salt (must be stored alongside encrypted data)

    Returns:
        32-byte derived key suitable for AES-256

    Security:
        Uses 600,000 iterations as recommended by OWASP for PBKDF2-HMAC-SHA256.
    """
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=AES_KEY_SIZE,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
        backend=default_backend(),
    )
    return kdf.derive(passphrase.encode("utf-8"))


# =============================================================================
# Encrypted Private Key Storage
# =============================================================================


def store_private_key(path: Union[str, Path], encrypted_blob: bytes) -> None:
    """
    Store an encrypted private key blob to a file.

    The file contains the complete encrypted key package (salt + nonce + ciphertext).
    The private key can only be recovered with the correct passphrase.

    Args:
        path: File path to store the encrypted key
        encrypted_blob: The encrypted key blob (from _encrypt_private_key)

    Security:
        - Creates parent directories with restricted permissions (0o700)
        - Writes file with restricted permissions (0o600)
        - NEVER stores plaintext private keys
    """
    path = Path(path)

    # Create parent directories with restricted permissions
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass  # May fail on some systems, continue anyway

    # Write encrypted blob
    with open(path, "wb") as f:
        f.write(encrypted_blob)

    # Set restrictive permissions on the key file
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass  # May fail on some systems


def load_private_key(path: Union[str, Path], passphrase: str) -> str:
    """
    Load and decrypt a private key from an encrypted file.

    Args:
        path: Path to the encrypted key file
        passphrase: The passphrase used to encrypt the key

    Returns:
        The private key as a hex string

    Raises:
        FileNotFoundError: If the key file doesn't exist
        ValueError: If the passphrase is incorrect or data is corrupted
        cryptography.exceptions.InvalidTag: If decryption fails (wrong passphrase)

    Security:
        The passphrase is required at runtime - keys are never stored in plaintext.
    """
    path = Path(path)

    with open(path, "rb") as f:
        encrypted_blob = f.read()

    return _decrypt_private_key(encrypted_blob, passphrase)


def _encrypt_private_key(private_key_bytes: bytes, passphrase: str) -> bytes:
    """
    Encrypt a private key using passphrase-derived AES-256-GCM.

    Args:
        private_key_bytes: The raw private key bytes
        passphrase: User-provided passphrase

    Returns:
        Encrypted blob: salt (32 bytes) + nonce (12 bytes) + ciphertext

    Security:
        Uses PBKDF2 with 600k iterations for key derivation.
    """
    # Generate random salt and nonce
    salt = os.urandom(PBKDF2_SALT_SIZE)
    nonce = os.urandom(AES_NONCE_SIZE)

    # Derive encryption key from passphrase
    derived_key = _derive_key_from_passphrase(passphrase, salt)

    # Encrypt the private key
    aesgcm = AESGCM(derived_key)
    ciphertext = aesgcm.encrypt(nonce, private_key_bytes, associated_data=b"umbral_private_key")

    # Return: salt + nonce + ciphertext
    return salt + nonce + ciphertext


def _decrypt_private_key(encrypted_blob: bytes, passphrase: str) -> str:
    """
    Decrypt a private key blob using the passphrase.

    Args:
        encrypted_blob: The encrypted blob (salt + nonce + ciphertext)
        passphrase: User-provided passphrase

    Returns:
        The decrypted private key as hex string

    Raises:
        ValueError: If the blob is too short
        cryptography.exceptions.InvalidTag: If passphrase is wrong
    """
    min_size = PBKDF2_SALT_SIZE + AES_NONCE_SIZE + 16  # 16 = GCM tag
    if len(encrypted_blob) < min_size:
        raise ValueError("Encrypted blob is too short - data may be corrupted")

    # Parse the blob
    salt = encrypted_blob[:PBKDF2_SALT_SIZE]
    nonce = encrypted_blob[PBKDF2_SALT_SIZE : PBKDF2_SALT_SIZE + AES_NONCE_SIZE]
    ciphertext = encrypted_blob[PBKDF2_SALT_SIZE + AES_NONCE_SIZE :]

    # Derive decryption key
    derived_key = _derive_key_from_passphrase(passphrase, salt)

    # Decrypt
    aesgcm = AESGCM(derived_key)
    private_key_bytes = aesgcm.decrypt(nonce, ciphertext, associated_data=b"umbral_private_key")

    return private_key_bytes.hex()


# =============================================================================
# Key Generation
# =============================================================================


def generate_umbral_keypair(
    passphrase: Optional[str] = None,
    key_path: Optional[Union[str, Path]] = None,
    key_id: Optional[str] = None,
) -> Dict[str, str]:
    """
    Generate a new Umbral keypair with optional passphrase-encrypted storage.

    If a passphrase is provided, the private key is encrypted and stored to disk.
    If no passphrase is provided, the private key hex is returned (for in-memory use only).

    Args:
        passphrase: Optional passphrase to encrypt the private key for storage.
                   If provided, the key is stored encrypted to disk.
                   If None, returns private key hex (handle with extreme care!)
        key_path: Optional path for storing the encrypted private key.
                  If None and passphrase is provided, uses default keys directory.
        key_id: Optional identifier for the key file (e.g., "alice", "bob").
                Used to generate the filename if key_path is not provided.

    Returns:
        Dict with:
        - "private_key_path": Path to encrypted key file (if passphrase provided)
                             OR "IN_MEMORY_ONLY" (if no passphrase)
        - "private_key_hex": Hex-encoded private key (ONLY if no passphrase - handle carefully!)
        - "public_key": Hex-encoded public key (safe to share)

    Security:
        - When passphrase is provided, private key is encrypted with AES-256-GCM
          using PBKDF2-derived key (600k iterations)
        - Private keys should NEVER be logged, printed, or transmitted
        - For production, ALWAYS use passphrase-protected storage

    Example:
        >>> # With passphrase (recommended for production)
        >>> keys = generate_umbral_keypair(passphrase="my_secure_passphrase", key_id="alice")
        >>> print(keys["private_key_path"])  # Path to encrypted file
        >>> print(keys["public_key"])         # Safe to share

        >>> # Without passphrase (for testing only)
        >>> keys = generate_umbral_keypair()
        >>> # WARNING: private_key_hex is exposed - use only for testing!
    """
    # Generate random keypair using pyUmbral
    secret_key = SecretKey.random()
    public_key = secret_key.public_key()

    # Serialize keys
    private_key_bytes = secret_key.to_secret_bytes()
    public_key_hex = bytes(public_key).hex()

    result: Dict[str, str] = {
        "public_key": public_key_hex,
    }

    if passphrase is not None:
        # Encrypt and store the private key
        encrypted_blob = _encrypt_private_key(private_key_bytes, passphrase)

        # Determine storage path
        if key_path is not None:
            storage_path = Path(key_path)
        else:
            keys_dir = DEFAULT_KEYS_DIR
            filename = f"{key_id or 'umbral_key'}_{hashlib.sha256(public_key_hex.encode()).hexdigest()[:8]}.enc"
            storage_path = keys_dir / filename

        # Store the encrypted key
        store_private_key(storage_path, encrypted_blob)

        result["private_key_path"] = str(storage_path.absolute())
    else:
        # Return private key hex (for testing/in-memory use only)
        result["private_key_path"] = "IN_MEMORY_ONLY"
        result["private_key_hex"] = private_key_bytes.hex()

    return result


def generate_umbral_keypair_simple() -> Tuple[str, str]:
    """
    Generate a new Umbral keypair (simple version for backward compatibility).

    Returns a tuple containing:
    - private_key_hex: Hex-encoded secret key bytes
    - public_key_hex: Hex-encoded public key bytes

    Returns:
        Tuple[str, str]: (private_key_hex, public_key_hex)

    Warning:
        This returns the private key in plaintext hex format.
        Use generate_umbral_keypair(passphrase=...) for production.
    """
    secret_key = SecretKey.random()
    public_key = secret_key.public_key()
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


def encrypt_plaintext_with_cek(plaintext: bytes) -> Dict[str, bytes]:
    """
    Encrypt plaintext bytes with a randomly generated Content Encryption Key (CEK).

    This function generates a random CEK and uses AES-256-GCM to encrypt the plaintext.
    The CEK must be separately protected (e.g., encapsulated with Umbral).

    Args:
        plaintext: The data to encrypt

    Returns:
        Dict containing:
        - "ciphertext": The encrypted data (includes GCM auth tag)
        - "cek": The 32-byte Content Encryption Key (MUST be protected!)
        - "nonce": The 12-byte nonce used for encryption
        - "tag": The 16-byte GCM authentication tag

    Security:
        The CEK must be protected! Use encapsulate_cek() to encrypt the CEK
        with the data owner's Umbral public key.

    Example:
        >>> result = encrypt_plaintext_with_cek(b"secret medical data")
        >>> # Protect the CEK using Umbral encapsulation
        >>> capsule_result = encapsulate_cek(result["cek"], owner_public_key)
    """
    # Generate random CEK (256 bits = 32 bytes)
    cek_bytes = os.urandom(32)

    # Generate random nonce (96 bits = 12 bytes)
    nonce = os.urandom(12)

    # Encrypt using AES-256-GCM
    aesgcm = AESGCM(cek_bytes)
    ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext, associated_data=None)

    # Extract the authentication tag
    tag = ciphertext_with_tag[-16:]

    return {
        "ciphertext": ciphertext_with_tag,
        "cek": cek_bytes,
        "nonce": nonce,
        "tag": tag,
    }


# =============================================================================
# Umbral Encapsulation
# =============================================================================


def encapsulate_cek(cek: bytes, owner_pub: str) -> Dict[str, bytes]:
    """
    Encapsulate a Content Encryption Key (CEK) for the owner using Umbral.

    This creates a "capsule" that wraps the CEK such that:
    1. The owner can decrypt directly with their private key
    2. The capsule can later be re-encrypted for a grantee

    Args:
        cek: The Content Encryption Key bytes to encapsulate
        owner_pub: The owner's public key as hex string

    Returns:
        Dict containing:
        - "capsule": Serialized Umbral capsule bytes
        - "encapsulated_blob": The encrypted CEK bytes (ciphertext)

    Note:
        The capsule is essential for both direct decryption and re-encryption.
        Store it alongside the encrypted CEK.

    Example:
        >>> result = encapsulate_cek(cek, owner_public_key_hex)
        >>> capsule = result["capsule"]
        >>> encrypted_cek = result["encapsulated_blob"]
    """
    # Deserialize owner's public key from hex
    owner_public_key = PublicKey.from_bytes(bytes.fromhex(owner_pub))

    # Encrypt (encapsulate) the CEK for the owner
    capsule, encrypted_cek = encrypt(owner_public_key, cek)

    # Serialize capsule and return
    return {
        "capsule": bytes(capsule),
        "encapsulated_blob": encrypted_cek,
    }


def encapsulate_cek_tuple(cek: bytes, owner_pub: str) -> Tuple[bytes, bytes]:
    """
    Encapsulate a CEK (backward-compatible tuple version).

    Returns:
        Tuple of (capsule_bytes, encrypted_cek_bytes)
    """
    result = encapsulate_cek(cek, owner_pub)
    return result["capsule"], result["encapsulated_blob"]


# =============================================================================
# Re-encryption Key Generation
# =============================================================================


def generate_rekey(
    owner_priv_ref: str,
    grantee_pub: str,
    passphrase: Optional[str] = None,
) -> bytes:
    """
    Generate a re-encryption key (kfrag) from owner to grantee.

    This creates a key fragment that allows a proxy to re-encrypt capsules
    from the owner's public key to the grantee's public key, without the proxy
    learning the plaintext or the owner's private key.

    Args:
        owner_priv_ref: Either:
            - Hex string of the owner's private key, OR
            - Path to the encrypted private key file
        grantee_pub: The grantee's public key as hex string
        passphrase: Required if owner_priv_ref is a path to an encrypted key file

    Returns:
        bytes: Serialized re-encryption key fragment (kfrag) bytes

    Note:
        This implements a 1-of-1 threshold scheme for simplicity.
        For production use with multiple proxies, consider threshold > 1.

    Security:
        The owner's private key is required to generate the kfrag.
        This operation should happen on a trusted system.
        The private key is never stored in plaintext by this function.

    Example:
        >>> # With hex key (testing)
        >>> rekey = generate_rekey(owner_private_hex, grantee_public_hex)

        >>> # With encrypted key file (production)
        >>> rekey = generate_rekey("/path/to/owner.enc", grantee_pub, passphrase="secret")
    """
    # Determine if owner_priv_ref is a path or hex string
    if Path(owner_priv_ref).exists():
        # It's a path to an encrypted key file
        if passphrase is None:
            raise ValueError("Passphrase required to decrypt private key from file")
        owner_priv_hex = load_private_key(owner_priv_ref, passphrase)
    else:
        # Assume it's a hex string
        owner_priv_hex = owner_priv_ref

    # Deserialize keys from hex
    owner_secret_key = SecretKey.from_bytes(bytes.fromhex(owner_priv_hex))
    grantee_public_key = PublicKey.from_bytes(bytes.fromhex(grantee_pub))

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

    # Return the first (and only) kfrag serialized
    return bytes(kfrags[0])


def generate_rekey_with_metadata(
    owner_priv: str,
    grantee_pub: str,
) -> Tuple[bytes, str, str]:
    """
    Generate a re-encryption key with metadata (backward-compatible version).

    Returns:
        Tuple of (rekey_bytes, owner_public_key_hex, grantee_public_key_hex)
    """
    owner_secret_key = SecretKey.from_bytes(bytes.fromhex(owner_priv))
    grantee_public_key = PublicKey.from_bytes(bytes.fromhex(grantee_pub))
    owner_public_key = owner_secret_key.public_key()

    signer = Signer(owner_secret_key)
    kfrags = generate_kfrags(
        delegating_sk=owner_secret_key,
        receiving_pk=grantee_public_key,
        signer=signer,
        threshold=1,
        shares=1,
    )

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


def decrypt_with_capsule(
    reenc_capsule: bytes,
    grantee_priv_ref: str,
    ciphertext: bytes,
    owner_pub: str,
    original_capsule: bytes,
    passphrase: Optional[str] = None,
) -> bytes:
    """
    Decrypt a re-encrypted capsule using the grantee's private key.

    This is the primary decryption function for grantees who have received
    a re-encrypted capsule fragment (cfrag).

    Args:
        reenc_capsule: The re-encrypted capsule fragment (cfrag) bytes
        grantee_priv_ref: Either:
            - Hex string of the grantee's private key, OR
            - Path to the encrypted private key file
        ciphertext: The original encrypted CEK bytes
        owner_pub: The owner's public key hex (who granted access)
        original_capsule: The original capsule bytes
        passphrase: Required if grantee_priv_ref is a path to encrypted key

    Returns:
        bytes: The decrypted plaintext (typically the CEK)

    Example:
        >>> # With hex key
        >>> cek = decrypt_with_capsule(cfrag, grantee_priv_hex, encrypted_cek, owner_pub, capsule)

        >>> # With encrypted key file
        >>> cek = decrypt_with_capsule(cfrag, "/path/to/grantee.enc", encrypted_cek,
        ...                            owner_pub, capsule, passphrase="secret")
    """
    # Determine if grantee_priv_ref is a path or hex string
    if Path(grantee_priv_ref).exists():
        if passphrase is None:
            raise ValueError("Passphrase required to decrypt private key from file")
        grantee_priv_hex = load_private_key(grantee_priv_ref, passphrase)
    else:
        grantee_priv_hex = grantee_priv_ref

    return decrypt_capsule_and_cek(
        reenc_capsule=reenc_capsule,
        grantee_priv=grantee_priv_hex,
        ciphertext=ciphertext,
        owner_pub=owner_pub,
        original_capsule=original_capsule,
    )
