"""
Umbral Proxy Re-Encryption Utilities

This module provides wrapper functions for pyUmbral operations including:
- Key generation and management
- AES-256-GCM symmetric encryption
- Umbral encapsulation and re-encryption

SECURITY NOTE:
- Private keys should NEVER be hardcoded or logged
- Keys should be read from secure files specified in environment variables
- In production, use HSM or secure key management

Environment Variables:
- UMBRAL_SIGNING_KEY_FILE: Path to signing key file
- UMBRAL_SECRET_KEY_FILE: Path to secret key file
"""

import os
from typing import Optional, Tuple

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# pyUmbral imports
try:
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
        reencrypt as umbral_reencrypt,
    )
    UMBRAL_AVAILABLE = True
except ImportError:
    UMBRAL_AVAILABLE = False
    SecretKey = None
    PublicKey = None

# ============================================================================
# Key File Paths from Environment
# ============================================================================

SIGNING_KEY_FILE = os.getenv("UMBRAL_SIGNING_KEY_FILE", "./keys/signing_key.bin")
SECRET_KEY_FILE = os.getenv("UMBRAL_SECRET_KEY_FILE", "./keys/secret_key.bin")


# ============================================================================
# Key Generation and Management
# ============================================================================


def generate_keys(key_dir: str = "./keys") -> Tuple[str, str]:
    """
    Generate a new Umbral keypair (secret key and public key).
    
    Saves the secret key to a file and returns the public key.
    NEVER returns or logs the secret key.

    Args:
        key_dir: Directory to store key files

    Returns:
        Tuple of (secret_key_path, public_key_hex)
        - secret_key_path: Path where secret key was saved
        - public_key_hex: Hex-encoded public key (safe to share)
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    os.makedirs(key_dir, exist_ok=True)
    
    secret_key = SecretKey.random()
    public_key = secret_key.public_key()
    
    secret_key_bytes = bytes(secret_key)
    public_key_bytes = bytes(public_key)
    
    secret_key_path = os.path.join(key_dir, "secret_key.bin")
    with open(secret_key_path, "wb") as f:
        f.write(secret_key_bytes)
    os.chmod(secret_key_path, 0o600)
    
    return secret_key_path, public_key_bytes.hex()


def generate_signing_key(key_dir: str = "./keys") -> Tuple[str, str]:
    """
    Generate a new Umbral signing keypair.
    
    Used for signing kfrags during re-encryption key generation.

    Args:
        key_dir: Directory to store key files

    Returns:
        Tuple of (signing_key_path, verifying_key_hex)
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    os.makedirs(key_dir, exist_ok=True)
    
    signing_key = SecretKey.random()
    verifying_key = signing_key.public_key()
    
    signing_key_path = os.path.join(key_dir, "signing_key.bin")
    with open(signing_key_path, "wb") as f:
        f.write(bytes(signing_key))
    os.chmod(signing_key_path, 0o600)
    
    return signing_key_path, bytes(verifying_key).hex()


def load_secret_key(key_file: Optional[str] = None) -> "SecretKey":
    """
    Load secret key from file.

    Args:
        key_file: Path to key file (default: from environment)

    Returns:
        umbral.SecretKey object
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    key_path = key_file or SECRET_KEY_FILE
    with open(key_path, "rb") as f:
        key_bytes = f.read()
    
    return SecretKey.from_bytes(key_bytes)


def load_signing_key(key_file: Optional[str] = None) -> "SecretKey":
    """
    Load signing key from file.

    Args:
        key_file: Path to key file (default: from environment)

    Returns:
        umbral.SecretKey object for signing
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    key_path = key_file or SIGNING_KEY_FILE
    with open(key_path, "rb") as f:
        key_bytes = f.read()
    
    return SecretKey.from_bytes(key_bytes)


def load_public_key(public_key_hex: str) -> "PublicKey":
    """
    Load a public key from hex string.

    Args:
        public_key_hex: Hex-encoded public key string

    Returns:
        umbral.PublicKey object
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    key_bytes = bytes.fromhex(public_key_hex)
    return PublicKey.from_bytes(key_bytes)


def get_public_key_hex(secret_key_file: Optional[str] = None) -> str:
    """
    Get the public key corresponding to a secret key file.
    
    Args:
        secret_key_file: Path to secret key file
        
    Returns:
        Hex-encoded public key
    """
    secret_key = load_secret_key(secret_key_file)
    public_key = secret_key.public_key()
    return bytes(public_key).hex()


# ============================================================================
# Content Encryption Key (CEK) Operations - AES-256-GCM
# ============================================================================


def generate_cek() -> bytes:
    """
    Generate a random Content Encryption Key for AES-256-GCM.

    Returns:
        32-byte random key for AES-256-GCM
    """
    return os.urandom(32)


def encrypt_with_cek(plaintext: bytes, cek: bytes) -> Tuple[bytes, bytes]:
    """
    Encrypt data using AES-256-GCM with the given CEK.

    Args:
        plaintext: Data to encrypt
        cek: 32-byte Content Encryption Key

    Returns:
        Tuple of (ciphertext, nonce)
        - ciphertext: Encrypted data with GCM authentication tag
        - nonce: 12-byte nonce (must be stored with ciphertext)
    """
    nonce = os.urandom(12)
    aesgcm = AESGCM(cek)
    ciphertext = aesgcm.encrypt(nonce, plaintext, associated_data=None)
    return ciphertext, nonce


def decrypt_with_cek(ciphertext: bytes, cek: bytes, nonce: bytes) -> bytes:
    """
    Decrypt data using AES-256-GCM with the given CEK.

    Args:
        ciphertext: Encrypted data with GCM tag
        cek: 32-byte Content Encryption Key
        nonce: 12-byte nonce used during encryption

    Returns:
        Decrypted plaintext bytes
    """
    aesgcm = AESGCM(cek)
    plaintext = aesgcm.decrypt(nonce, ciphertext, associated_data=None)
    return plaintext


# ============================================================================
# Umbral Proxy Re-Encryption Operations
# ============================================================================


def encapsulate_cek(cek: bytes, public_key_hex: str) -> Tuple[str, str]:
    """
    Encapsulate a CEK for a recipient using Umbral.

    This creates a ciphertext that can only be decrypted by the holder
    of the corresponding secret key, or by someone with a valid
    re-encryption key (kfrag).

    Args:
        cek: Content Encryption Key to encapsulate
        public_key_hex: Recipient's public key (hex string)

    Returns:
        Tuple of (capsule_hex, ciphertext_hex)
        - capsule_hex: Umbral capsule (needed for re-encryption)
        - ciphertext_hex: Encrypted CEK
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    recipient_pk = load_public_key(public_key_hex)
    capsule, ciphertext = encrypt(recipient_pk, cek)
    
    capsule_hex = bytes(capsule).hex()
    ciphertext_hex = ciphertext.hex()
    
    return capsule_hex, ciphertext_hex


def generate_reenc_key(
    granter_secret_key: Optional[str],
    grantee_public_key: str,
    threshold: int = 1,
    shares: int = 1,
    granter_secret_key_file: Optional[str] = None,
    signing_key_file: Optional[str] = None,
) -> str:
    """
    Generate Umbral re-encryption key fragments (kfrags).

    Creates key fragments that allow a proxy to re-encrypt data
    from the granter to the grantee without seeing the plaintext.

    Args:
        granter_secret_key: Ignored for security (loaded from file)
        grantee_public_key: Grantee's public key (hex string)
        threshold: Minimum number of kfrags needed to decrypt
        shares: Total number of kfrags to generate
        granter_secret_key_file: Path to granter's secret key file
        signing_key_file: Path to signing key file

    Returns:
        Hex-encoded kfrag (re-encryption key fragment)
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    granter_sk = load_secret_key(granter_secret_key_file)
    grantee_pk = load_public_key(grantee_public_key)
    signing_sk = load_signing_key(signing_key_file)
    signer = Signer(signing_sk)
    
    kfrags = generate_kfrags(
        delegating_sk=granter_sk,
        receiving_pk=grantee_pk,
        signer=signer,
        threshold=threshold,
        shares=shares,
    )
    
    return bytes(kfrags[0]).hex()


def generate_reenc_keys_multiple(
    grantee_public_key: str,
    threshold: int = 2,
    shares: int = 3,
    granter_secret_key_file: Optional[str] = None,
    signing_key_file: Optional[str] = None,
) -> list[str]:
    """
    Generate multiple Umbral kfrags for threshold schemes.

    Args:
        grantee_public_key: Grantee's public key (hex string)
        threshold: Minimum kfrags needed (e.g., 2 of 3)
        shares: Total kfrags to generate
        granter_secret_key_file: Path to granter's secret key file
        signing_key_file: Path to signing key file

    Returns:
        List of hex-encoded kfrags
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    granter_sk = load_secret_key(granter_secret_key_file)
    grantee_pk = load_public_key(grantee_public_key)
    signing_sk = load_signing_key(signing_key_file)
    signer = Signer(signing_sk)
    
    kfrags = generate_kfrags(
        delegating_sk=granter_sk,
        receiving_pk=grantee_pk,
        signer=signer,
        threshold=threshold,
        shares=shares,
    )
    
    return [bytes(kfrag).hex() for kfrag in kfrags]


def reencrypt_capsule(
    capsule_hex: str,
    kfrag_hex: str,
    delegating_pk_hex: str,
    verifying_pk_hex: str,
) -> str:
    """
    Re-encrypt a capsule using a kfrag with explicit keys.

    Args:
        capsule_hex: Original Umbral capsule (hex string)
        kfrag_hex: Re-encryption key fragment (hex string)
        delegating_pk_hex: Granter's public key (hex string)
        verifying_pk_hex: Signing/verifying public key (hex string)

    Returns:
        Hex-encoded cfrag (ciphertext fragment)
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    capsule = Capsule.from_bytes(bytes.fromhex(capsule_hex))
    kfrag = KeyFrag.from_bytes(bytes.fromhex(kfrag_hex))
    delegating_pk = load_public_key(delegating_pk_hex)
    verifying_pk = load_public_key(verifying_pk_hex)
    
    verified_kfrag = kfrag.verify(
        verifying_pk=verifying_pk,
        delegating_pk=delegating_pk,
        receiving_pk=None,
    )
    
    cfrag = umbral_reencrypt(capsule, verified_kfrag)
    
    return bytes(cfrag).hex()


def decrypt_original_data(
    capsule_hex: str,
    ciphertext_hex: str,
    secret_key_file: Optional[str] = None,
) -> bytes:
    """
    Decrypt a ciphertext using the original recipient's secret key.

    Used by the data owner to decrypt their own data.

    Args:
        capsule_hex: Umbral capsule (hex string)
        ciphertext_hex: Encrypted data (hex string)
        secret_key_file: Path to secret key file (default: from env)

    Returns:
        Decrypted plaintext bytes
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    secret_key = load_secret_key(secret_key_file)
    capsule = Capsule.from_bytes(bytes.fromhex(capsule_hex))
    ciphertext = bytes.fromhex(ciphertext_hex)
    
    plaintext = decrypt_original(secret_key, capsule, ciphertext)
    
    return plaintext


def decrypt_reencrypted_data(
    capsule_hex: str,
    cfrags_hex: list[str],
    ciphertext_hex: str,
    delegating_pk_hex: str,
    receiving_secret_key_file: Optional[str] = None,
) -> bytes:
    """
    Decrypt re-encrypted data using cfrags.

    Used by a grantee to decrypt data that was re-encrypted for them.

    Args:
        capsule_hex: Original Umbral capsule (hex string)
        cfrags_hex: List of ciphertext fragments (hex strings)
        ciphertext_hex: Encrypted data (hex string)
        delegating_pk_hex: Granter's public key (hex string)
        receiving_secret_key_file: Path to grantee's secret key file

    Returns:
        Decrypted plaintext bytes
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    receiving_sk = load_secret_key(receiving_secret_key_file)
    delegating_pk = load_public_key(delegating_pk_hex)
    
    capsule = Capsule.from_bytes(bytes.fromhex(capsule_hex))
    cfrags = [CapsuleFrag.from_bytes(bytes.fromhex(cf)) for cf in cfrags_hex]
    ciphertext = bytes.fromhex(ciphertext_hex)
    
    plaintext = decrypt_reencrypted(
        receiving_sk=receiving_sk,
        delegating_pk=delegating_pk,
        capsule=capsule,
        verified_cfrags=cfrags,
        ciphertext=ciphertext,
    )
    
    return plaintext


# ============================================================================
# Utility Functions
# ============================================================================


def keys_exist(key_dir: str = "./keys") -> bool:
    """Check if key files exist."""
    secret_key_path = os.path.join(key_dir, "secret_key.bin")
    signing_key_path = os.path.join(key_dir, "signing_key.bin")
    return os.path.exists(secret_key_path) and os.path.exists(signing_key_path)


def ensure_keys_exist(key_dir: str = "./keys") -> Tuple[str, str]:
    """
    Ensure keys exist, generating them if necessary.
    
    Returns:
        Tuple of (secret_key_path, public_key_hex)
    """
    if not keys_exist(key_dir):
        generate_signing_key(key_dir)
        return generate_keys(key_dir)
    else:
        secret_key_path = os.path.join(key_dir, "secret_key.bin")
        public_key_hex = get_public_key_hex(secret_key_path)
        return secret_key_path, public_key_hex
