"""
Field-level encryption utilities for sensitive data.

Uses Fernet (AES-128-CBC with HMAC-SHA256) for encrypting sensitive fields
like Aadhar numbers and hospital registration IDs before storing in database.

Security Notes:
- FIELD_ENCRYPTION_KEY must be set in .env (generate with Fernet.generate_key())
- Encrypted values are base64-encoded and can be safely stored as TEXT
- Only decrypt when the owner requests their own data
- Never expose encrypted sensitive fields to other users
"""

import os
import base64
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken


# Load encryption key from environment
_ENCRYPTION_KEY = os.getenv("FIELD_ENCRYPTION_KEY")
_fernet: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    """Get or initialize Fernet cipher with the encryption key."""
    global _fernet
    
    if _fernet is not None:
        return _fernet
    
    key = os.getenv("FIELD_ENCRYPTION_KEY")
    
    if not key:
        # In development, generate a temporary key (NOT for production!)
        import warnings
        warnings.warn(
            "FIELD_ENCRYPTION_KEY not set! Using temporary key. "
            "Set FIELD_ENCRYPTION_KEY in .env for production."
        )
        # Use a deterministic key for development (based on JWT_SECRET)
        jwt_secret = os.getenv("JWT_SECRET", "dev-secret")
        # Create a valid Fernet key from the JWT secret
        key_bytes = jwt_secret.encode()[:32].ljust(32, b'\0')
        key = base64.urlsafe_b64encode(key_bytes).decode()
    
    try:
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as e:
        raise ValueError(
            f"Invalid FIELD_ENCRYPTION_KEY. Generate with: "
            f"python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        ) from e
    
    return _fernet


def encrypt_field(plaintext: str) -> str:
    """
    Encrypt a sensitive field value.
    
    Args:
        plaintext: The value to encrypt (e.g., Aadhar number)
        
    Returns:
        Base64-encoded encrypted value (safe for TEXT column storage)
    """
    if not plaintext:
        return ""
    
    fernet = _get_fernet()
    encrypted = fernet.encrypt(plaintext.encode())
    return encrypted.decode()  # Fernet returns base64 bytes


def decrypt_field(ciphertext: str) -> str:
    """
    Decrypt a sensitive field value.
    
    Args:
        ciphertext: Base64-encoded encrypted value from database
        
    Returns:
        Decrypted plaintext value
        
    Raises:
        InvalidToken: If decryption fails (wrong key or corrupted data)
    """
    if not ciphertext:
        return ""
    
    fernet = _get_fernet()
    try:
        decrypted = fernet.decrypt(ciphertext.encode())
        return decrypted.decode()
    except InvalidToken:
        # Return placeholder if decryption fails
        return "[ENCRYPTED]"


def mask_aadhar(aadhar: str) -> str:
    """
    Mask Aadhar number for display (show only last 4 digits).
    
    Args:
        aadhar: Full Aadhar number (12 digits)
        
    Returns:
        Masked Aadhar like "XXXX-XXXX-1234"
    """
    if not aadhar or len(aadhar) < 4:
        return "XXXX-XXXX-XXXX"
    
    # Remove any existing formatting
    clean = aadhar.replace("-", "").replace(" ", "")
    
    if len(clean) >= 4:
        return f"XXXX-XXXX-{clean[-4:]}"
    
    return "XXXX-XXXX-XXXX"


def mask_registration_id(reg_id: str) -> str:
    """
    Mask hospital registration ID for display (show only last 4 characters).
    
    Args:
        reg_id: Full registration ID
        
    Returns:
        Masked ID like "******1234"
    """
    if not reg_id or len(reg_id) < 4:
        return "**********"
    
    return f"******{reg_id[-4:]}"


def validate_aadhar(aadhar: str) -> tuple[bool, str]:
    """
    Validate Aadhar number format.
    
    Args:
        aadhar: Aadhar number to validate
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not aadhar:
        return False, "Aadhar number is required"
    
    # Remove formatting
    clean = aadhar.replace("-", "").replace(" ", "")
    
    # Must be exactly 12 digits
    if not clean.isdigit():
        return False, "Aadhar must contain only digits"
    
    if len(clean) != 12:
        return False, "Aadhar must be exactly 12 digits"
    
    # First digit cannot be 0 or 1
    if clean[0] in "01":
        return False, "Invalid Aadhar number (cannot start with 0 or 1)"
    
    return True, ""


def format_aadhar(aadhar: str) -> str:
    """
    Format Aadhar number with proper spacing.
    
    Args:
        aadhar: Raw Aadhar number
        
    Returns:
        Formatted as "1234-5678-9012"
    """
    clean = aadhar.replace("-", "").replace(" ", "")
    if len(clean) == 12:
        return f"{clean[:4]}-{clean[4:8]}-{clean[8:]}"
    return aadhar
