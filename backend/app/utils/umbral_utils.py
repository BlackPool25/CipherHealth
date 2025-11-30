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
    
    # Use to_secret_bytes() for SecretKey, bytes() for PublicKey
    secret_key_bytes = secret_key.to_secret_bytes()
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
        f.write(signing_key.to_secret_bytes())
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
    
    # kfrags[0] is VerifiedKeyFrag, need inner .kfrag for serialization
    return bytes(kfrags[0].kfrag).hex()


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
    
    # kfrags are VerifiedKeyFrag, need inner .kfrag for serialization
    return [bytes(kfrag.kfrag).hex() for kfrag in kfrags]


def reencrypt_capsule(
    capsule_hex: str,
    kfrag_hex: str,
    delegating_pk_hex: str,
    verifying_pk_hex: str,
    receiving_pk_hex: Optional[str] = None,
) -> str:
    """
    Re-encrypt a capsule using a kfrag with explicit keys.

    Args:
        capsule_hex: Original Umbral capsule (hex string)
        kfrag_hex: Re-encryption key fragment (hex string)
        delegating_pk_hex: Granter's public key (hex string)
        verifying_pk_hex: Signing/verifying public key (hex string)
        receiving_pk_hex: Grantee's public key (hex string) - required for verification

    Returns:
        Hex-encoded cfrag (ciphertext fragment)
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    capsule = Capsule.from_bytes(bytes.fromhex(capsule_hex))
    
    # Handle both pyumbral KeyFrag format (260 bytes) and 
    # @nucypher/umbral-pre VerifiedKeyFrag format (310 bytes)
    kfrag_bytes = bytes.fromhex(kfrag_hex)
    
    if len(kfrag_bytes) == 260:
        # Standard pyumbral KeyFrag
        kfrag = KeyFrag.from_bytes(kfrag_bytes)
    elif len(kfrag_bytes) == 310:
        # @nucypher/umbral-pre VerifiedKeyFrag format - not directly compatible
        # This is a WASM library with different serialization
        raise ValueError(
            f"KFrag appears to be from @nucypher/umbral-pre WASM library (310 bytes). "
            f"This is not compatible with pyumbral. Please regenerate kfrags server-side."
        )
    else:
        raise ValueError(f"Expected 260 bytes for KeyFrag, got {len(kfrag_bytes)}")
    
    delegating_pk = load_public_key(delegating_pk_hex)
    verifying_pk = load_public_key(verifying_pk_hex)
    
    # receiving_pk is required for kfrag verification
    receiving_pk = load_public_key(receiving_pk_hex) if receiving_pk_hex else None
    
    verified_kfrag = kfrag.verify(
        verifying_pk=verifying_pk,
        delegating_pk=delegating_pk,
        receiving_pk=receiving_pk,
    )
    
    cfrag = umbral_reencrypt(capsule, verified_kfrag)
    
    return bytes(cfrag).hex()


def generate_kfrag_for_hospital(
    delegating_sk_file: Optional[str] = None,
    receiving_pk_hex: str = "",
    signing_sk_file: Optional[str] = None,
) -> tuple[str, str]:
    """
    Generate a kfrag for a hospital using server-side keys.
    
    This is the server-side alternative when client-side kfrag generation
    uses incompatible libraries.
    
    Args:
        delegating_sk_file: Patient's secret key file
        receiving_pk_hex: Hospital's public key (hex)
        signing_sk_file: Signing key file
        
    Returns:
        Tuple of (kfrag_hex, verifying_key_hex)
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required")
    
    delegating_sk = load_secret_key(delegating_sk_file)
    receiving_pk = load_public_key(receiving_pk_hex)
    signing_sk = load_signing_key(signing_sk_file)
    signer = Signer(signing_sk)
    verifying_pk = signing_sk.public_key()
    
    kfrags = generate_kfrags(
        delegating_sk=delegating_sk,
        receiving_pk=receiving_pk,
        signer=signer,
        threshold=1,
        shares=1,
    )
    
    # kfrags[0] is VerifiedKeyFrag, extract inner KeyFrag
    kfrag_hex = bytes(kfrags[0].kfrag).hex()
    verifying_key_hex = bytes(verifying_pk).hex()
    
    return kfrag_hex, verifying_key_hex


def generate_kfrag_from_secret_key_bytes(
    delegating_sk_bytes_hex: str,
    receiving_pk_hex: str,
    signing_sk_bytes_hex: Optional[str] = None,
) -> tuple[str, str]:
    """
    Generate kfrag from raw secret key bytes sent by frontend.
    
    This is the server-side kfrag generation for when client-side
    libraries (like @nucypher/umbral-pre WASM) use incompatible
    serialization formats.
    
    SECURITY NOTE: The secret key is only held in memory briefly and
    should be cleared after use. All transport should be over HTTPS.
    
    Args:
        delegating_sk_bytes_hex: Patient's secret key as hex (32 bytes raw)
        receiving_pk_hex: Hospital's public key hex (33 bytes compressed)
        signing_sk_bytes_hex: Signing key hex (32 bytes). If not provided,
                              uses server's signing key
    
    Returns:
        Tuple of (kfrag_hex, verifying_key_hex)
        - kfrag_hex: 260-byte pyumbral-compatible KeyFrag
        - verifying_key_hex: 33-byte compressed verifying public key
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required")
    
    # Reconstruct secret key from bytes
    delegating_sk_bytes = bytes.fromhex(delegating_sk_bytes_hex)
    delegating_sk = SecretKey.from_bytes(delegating_sk_bytes)
    
    # Reconstruct receiving public key
    receiving_pk = load_public_key(receiving_pk_hex)
    
    # Use provided signing key or fall back to server's signing key
    if signing_sk_bytes_hex:
        signing_sk_bytes = bytes.fromhex(signing_sk_bytes_hex)
        signing_sk = SecretKey.from_bytes(signing_sk_bytes)
    else:
        signing_sk = load_signing_key()
    
    signer = Signer(signing_sk)
    verifying_pk = signing_sk.public_key()
    
    # Generate kfrags using pyumbral (will be compatible with pyumbral)
    kfrags = generate_kfrags(
        delegating_sk=delegating_sk,
        receiving_pk=receiving_pk,
        signer=signer,
        threshold=1,
        shares=1,
    )
    
    # Extract inner KeyFrag for serialization (260 bytes)
    kfrag_hex = bytes(kfrags[0].kfrag).hex()
    verifying_key_hex = bytes(verifying_pk).hex()
    
    return kfrag_hex, verifying_key_hex


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


def decrypt_reencrypted_from_bytes(
    capsule_hex: str,
    cfrag_hex: str,
    ciphertext_hex: str,
    delegating_pk_hex: str,
    receiving_sk_bytes_hex: str,
    receiving_pk_hex: str,
    verifying_pk_hex: str,
) -> bytes:
    """
    Decrypt re-encrypted data using hospital's raw secret key bytes.
    
    This is used for server-side decryption where the hospital sends
    their secret key bytes for decryption.
    
    SECURITY NOTE: The secret key is only held in memory briefly.
    All transport should be over HTTPS.

    Args:
        capsule_hex: Original Umbral capsule (hex string)
        cfrag_hex: Ciphertext fragment from re-encryption (hex string)
        ciphertext_hex: Encrypted CEK (hex string)
        delegating_pk_hex: Patient's public key (hex string)
        receiving_sk_bytes_hex: Hospital's secret key as hex (32 bytes raw)
        receiving_pk_hex: Hospital's public key (hex string) for cfrag verification
        verifying_pk_hex: Verifying public key (from kfrag generation) (hex string)

    Returns:
        Decrypted CEK bytes
    """
    if not UMBRAL_AVAILABLE:
        raise ImportError("pyumbral is required. Install with: pip install pyumbral")
    
    # Reconstruct secret key from bytes
    receiving_sk_bytes = bytes.fromhex(receiving_sk_bytes_hex)
    receiving_sk = SecretKey.from_bytes(receiving_sk_bytes)
    
    # Load public keys
    delegating_pk = load_public_key(delegating_pk_hex)
    receiving_pk = load_public_key(receiving_pk_hex)
    verifying_pk = load_public_key(verifying_pk_hex)
    
    # Parse capsule and cfrag
    capsule = Capsule.from_bytes(bytes.fromhex(capsule_hex))
    cfrag = CapsuleFrag.from_bytes(bytes.fromhex(cfrag_hex))
    ciphertext = bytes.fromhex(ciphertext_hex)
    
    # Verify cfrag
    verified_cfrag = cfrag.verify(
        capsule=capsule,
        verifying_pk=verifying_pk,
        delegating_pk=delegating_pk,
        receiving_pk=receiving_pk,
    )
    
    # Decrypt using re-encrypted data
    plaintext = decrypt_reencrypted(
        receiving_sk=receiving_sk,
        delegating_pk=delegating_pk,
        capsule=capsule,
        verified_cfrags=[verified_cfrag],
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
