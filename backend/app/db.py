"""
Database module for Decent-Hospital Backend

Uses SQLite with aiosqlite for async operations.
Defines models for users, files, and grants.
"""

import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

import aiosqlite
from pydantic import BaseModel

# Database file path
DATABASE_PATH = os.getenv("DATABASE_URL", "sqlite:///./decent_hospital.db").replace(
    "sqlite:///", ""
)


# ============================================================================
# Pydantic Models (for API request/response validation)
# ============================================================================


class GrantStatus(str, Enum):
    """Status of a grant."""

    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"


class UserRole(str, Enum):
    """Role of a user."""
    
    PATIENT = "patient"
    HOSPITAL = "hospital"


class UserCreate(BaseModel):
    """Schema for user registration."""

    username: str
    email: str
    invite_code: str
    public_key: Optional[str] = None  # Umbral public key (hex encoded)


class UserResponse(BaseModel):
    """Schema for user response."""

    id: int
    username: str
    email: str
    public_key: Optional[str]
    created_at: str


class FileRecord(BaseModel):
    """Schema for file metadata."""

    id: Optional[int] = None
    cid: str  # IPFS Content Identifier
    owner_id: int
    filename: str
    encrypted_cek: Optional[str] = None  # CEK encrypted with owner's public key
    capsule: Optional[str] = None  # Umbral capsule for re-encryption (hex)
    created_at: Optional[str] = None


class GrantCreate(BaseModel):
    """Schema for creating a grant."""

    granter_id: int
    grantee_id: int
    file_id: int
    expires_at: Optional[str] = None  # ISO format datetime


class GrantResponse(BaseModel):
    """Schema for grant response."""

    id: int
    granter_id: int
    grantee_id: int
    file_id: int
    reencryption_key: Optional[str]  # Umbral re-encryption key (hex encoded)
    expires_at: Optional[str]
    status: GrantStatus
    created_at: str
    tx_hash: Optional[str] = None  # On-chain transaction hash


class AccessRequestStatus(str, Enum):
    """Status of an access request."""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    EXPIRED = "expired"


class AccessRequestCreate(BaseModel):
    """Schema for creating an access request."""

    cid: str
    requester_pubkey: str
    purpose: str


class AccessRequestResponse(BaseModel):
    """Schema for access request response."""

    id: int
    cid: str
    requester_pubkey: str
    purpose: str
    status: AccessRequestStatus
    created_at: str
    owner_id: Optional[int] = None
    expires_at: Optional[str] = None
    kfrags_encrypted: Optional[str] = None  # Encrypted kfrags metadata
    verifying_key: Optional[str] = None  # Signer's public key for kfrag verification
    tx_hash: Optional[str] = None


class InviteCode(BaseModel):
    """Schema for invite code."""

    code: str
    created_by: Optional[int] = None
    used_by: Optional[int] = None
    created_at: Optional[str] = None
    used_at: Optional[str] = None


class HospitalInviteToken(BaseModel):
    """Schema for hospital-generated invite tokens (single-use patient invites)."""

    token: str
    hospital_id: int
    expires_at: Optional[str] = None
    used_by: Optional[int] = None
    used_at: Optional[str] = None
    created_at: Optional[str] = None


# ============================================================================
# Database Initialization
# ============================================================================


async def init_db():
    """
    Initialize the SQLite database with required tables.
    Creates tables if they don't exist.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Users table with role and password_hash for hospital/patient registration
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                public_key TEXT,
                role TEXT DEFAULT 'patient',
                password_hash TEXT,
                needs_profile_upload INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Invite codes table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS invite_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                created_by INTEGER,
                used_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                used_at TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (used_by) REFERENCES users(id)
            )
        """)

        # Files table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cid TEXT UNIQUE NOT NULL,
                owner_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                encrypted_cek TEXT,
                capsule TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id)
            )
        """)

        # Grants table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS grants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                granter_id INTEGER NOT NULL,
                grantee_id INTEGER NOT NULL,
                file_id INTEGER NOT NULL,
                reencryption_key TEXT,
                expires_at TIMESTAMP,
                status TEXT DEFAULT 'active',
                tx_hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (granter_id) REFERENCES users(id),
                FOREIGN KEY (grantee_id) REFERENCES users(id),
                FOREIGN KEY (file_id) REFERENCES files(id)
            )
        """)

        # Access requests table - for client-side-first workflow
        await db.execute("""
            CREATE TABLE IF NOT EXISTS access_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cid TEXT NOT NULL,
                requester_pubkey TEXT NOT NULL,
                purpose TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                owner_id INTEGER,
                expires_at TIMESTAMP,
                kfrags_encrypted TEXT,
                verifying_key TEXT,
                tx_hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id)
            )
        """)

        # Add verifying_key column if it doesn't exist (migration for existing DBs)
        try:
            await db.execute("ALTER TABLE access_requests ADD COLUMN verifying_key TEXT")
        except Exception:
            pass  # Column already exists

        # Hospital invite tokens table (single-use tokens generated by hospitals)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS hospital_invite_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE NOT NULL,
                hospital_id INTEGER NOT NULL,
                expires_at TIMESTAMP,
                used_by INTEGER,
                used_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (hospital_id) REFERENCES users(id),
                FOREIGN KEY (used_by) REFERENCES users(id)
            )
        """)

        # Migration: Add role column to users if it doesn't exist
        try:
            await db.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'patient'")
        except Exception:
            pass  # Column already exists

        # Migration: Add password_hash column to users if it doesn't exist
        try:
            await db.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        except Exception:
            pass  # Column already exists

        # Migration: Add needs_profile_upload column to users if it doesn't exist
        try:
            await db.execute("ALTER TABLE users ADD COLUMN needs_profile_upload INTEGER DEFAULT 0")
        except Exception:
            pass  # Column already exists

        await db.commit()
        print("Database initialized successfully.")


# ============================================================================
# Database Operations - Users
# ============================================================================


async def create_user(user: UserCreate) -> int:
    """
    Create a new user in the database.
    Returns the new user's ID.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO users (username, email, public_key)
            VALUES (?, ?, ?)
            """,
            (user.username, user.email, user.public_key),
        )
        await db.commit()
        return cursor.lastrowid


async def get_user_by_id(user_id: int) -> Optional[dict]:
    """Get a user by their ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_user_by_username(username: str) -> Optional[dict]:
    """Get a user by their username."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def update_user_public_key(user_id: int, public_key: str) -> bool:
    """
    Update a user's Umbral public key.
    Returns True if successful.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE users SET public_key = ? WHERE id = ?
            """,
            (public_key, user_id),
        )
        await db.commit()
        return cursor.rowcount > 0


# ============================================================================
# Database Operations - Invite Codes
# ============================================================================


async def create_invite_code(code: str, created_by: Optional[int] = None) -> int:
    """
    Create a new invite code.
    Returns the invite code's ID.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO invite_codes (code, created_by)
            VALUES (?, ?)
            """,
            (code, created_by),
        )
        await db.commit()
        return cursor.lastrowid


async def get_invite_code(code: str) -> Optional[dict]:
    """Get an invite code record."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM invite_codes WHERE code = ?", (code,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def use_invite_code(code: str, user_id: int) -> bool:
    """
    Mark an invite code as used.
    Returns True if successful.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE invite_codes
            SET used_by = ?, used_at = CURRENT_TIMESTAMP
            WHERE code = ? AND used_by IS NULL
            """,
            (user_id, code),
        )
        await db.commit()
        return cursor.rowcount > 0


# ============================================================================
# Database Operations - Hospital Invite Tokens
# ============================================================================


async def create_hospital_invite_token(
    hospital_id: int,
    expires_seconds: Optional[int] = None,
) -> str:
    """
    Create a new hospital invite token.
    Returns the token string.
    """
    token = secrets.token_urlsafe(32)
    
    # Default expiry from env or 3600 seconds (1 hour)
    default_expiry = int(os.getenv("INVITE_TOKEN_EXPIRY_SECONDS", "3600"))
    expiry_seconds = expires_seconds if expires_seconds is not None else default_expiry
    
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expiry_seconds)
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute(
            """
            INSERT INTO hospital_invite_tokens (token, hospital_id, expires_at)
            VALUES (?, ?, ?)
            """,
            (token, hospital_id, expires_at.isoformat()),
        )
        await db.commit()
        return token


async def get_hospital_invite_token(token: str) -> Optional[dict]:
    """Get a hospital invite token record."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM hospital_invite_tokens WHERE token = ?", (token,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def validate_hospital_invite_token(token: str) -> Optional[dict]:
    """
    Validate a hospital invite token.
    Returns the token record if valid (unused and not expired), None otherwise.
    """
    token_record = await get_hospital_invite_token(token)
    if not token_record:
        return None
    
    # Check if already used
    if token_record.get("used_by") is not None:
        return None
    
    # Check if expired
    expires_at_str = token_record.get("expires_at")
    if expires_at_str:
        try:
            expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
            if expires_at < datetime.now(timezone.utc):
                return None
        except (ValueError, TypeError):
            pass  # If we can't parse, assume not expired
    
    return token_record


async def use_hospital_invite_token(token: str, user_id: int) -> bool:
    """
    Mark a hospital invite token as used.
    Returns True if successful.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE hospital_invite_tokens
            SET used_by = ?, used_at = CURRENT_TIMESTAMP
            WHERE token = ? AND used_by IS NULL
            """,
            (user_id, token),
        )
        await db.commit()
        return cursor.rowcount > 0


async def get_hospital_invite_tokens(hospital_id: int) -> list[dict]:
    """Get all invite tokens created by a hospital."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT * FROM hospital_invite_tokens 
            WHERE hospital_id = ?
            ORDER BY created_at DESC
            """,
            (hospital_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


# ============================================================================
# Database Operations - User Registration with Password
# ============================================================================


async def create_user_with_password(
    username: str,
    email: str,
    password_hash: str,
    role: str = "patient",
    public_key: Optional[str] = None,
    needs_profile_upload: bool = False,
) -> int:
    """
    Create a new user with password hash.
    Returns the new user's ID.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO users (username, email, password_hash, role, public_key, needs_profile_upload)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (username, email, password_hash, role, public_key, 1 if needs_profile_upload else 0),
        )
        await db.commit()
        return cursor.lastrowid


async def get_user_by_email(email: str) -> Optional[dict]:
    """Get a user by their email."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


# ============================================================================
# Database Operations - Files
# ============================================================================


async def create_file_record(file: FileRecord) -> int:
    """
    Create a new file record.
    Returns the file record's ID.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO files (cid, owner_id, filename, encrypted_cek, capsule)
            VALUES (?, ?, ?, ?, ?)
            """,
            (file.cid, file.owner_id, file.filename, file.encrypted_cek, file.capsule),
        )
        await db.commit()
        return cursor.lastrowid


async def get_file_by_cid(cid: str) -> Optional[dict]:
    """Get a file record by CID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM files WHERE cid = ?", (cid,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_file_by_id(file_id: int) -> Optional[dict]:
    """Get a file record by ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM files WHERE id = ?", (file_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_files_by_owner(owner_id: int) -> list[dict]:
    """Get all files owned by a user."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM files WHERE owner_id = ?", (owner_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


# ============================================================================
# Database Operations - Grants
# ============================================================================


async def create_grant(grant: GrantCreate, reencryption_key: str) -> int:
    """
    Create a new grant record.
    Returns the grant's ID.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO grants (granter_id, grantee_id, file_id, reencryption_key, expires_at, status)
            VALUES (?, ?, ?, ?, ?, 'active')
            """,
            (
                grant.granter_id,
                grant.grantee_id,
                grant.file_id,
                reencryption_key,
                grant.expires_at,
            ),
        )
        await db.commit()
        return cursor.lastrowid


async def get_grant_by_id(grant_id: int) -> Optional[dict]:
    """Get a grant by ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM grants WHERE id = ?", (grant_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def revoke_grant(grant_id: int, tx_hash: Optional[str] = None) -> bool:
    """
    Revoke a grant.
    Returns True if successful.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE grants
            SET status = 'revoked', tx_hash = ?
            WHERE id = ? AND status = 'active'
            """,
            (tx_hash, grant_id),
        )
        await db.commit()
        return cursor.rowcount > 0


async def get_grants_for_grantee(grantee_id: int) -> list[dict]:
    """Get all active grants for a grantee with file and granter info."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT 
                g.id,
                g.file_id,
                g.granter_id,
                g.grantee_id,
                g.reencryption_key,
                g.expires_at,
                g.status,
                g.tx_hash,
                g.created_at,
                f.filename,
                f.cid,
                u.username AS granter_username
            FROM grants g
            JOIN files f ON g.file_id = f.id
            JOIN users u ON g.granter_id = u.id
            WHERE g.grantee_id = ? AND g.status = 'active'
            ORDER BY g.created_at DESC
            """,
            (grantee_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_grants_by_granter(granter_id: int) -> list[dict]:
    """Get all grants created by a granter with file and grantee info."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT 
                g.id,
                g.file_id,
                g.granter_id,
                g.grantee_id,
                g.reencryption_key,
                g.expires_at,
                g.status,
                g.tx_hash,
                g.created_at,
                f.filename,
                f.cid,
                u.username AS grantee_username
            FROM grants g
            JOIN files f ON g.file_id = f.id
            JOIN users u ON g.grantee_id = u.id
            WHERE g.granter_id = ?
            ORDER BY g.created_at DESC
            """,
            (granter_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_grants_for_file(file_id: int) -> list[dict]:
    """
    Get all grants for a specific file.
    
    Used for revocation to find all grants that need to be invalidated.
    
    Args:
        file_id: ID of the file
        
    Returns:
        List of grant dictionaries
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT 
                g.id,
                g.file_id,
                g.granter_id,
                g.grantee_id,
                g.reencryption_key,
                g.expires_at,
                g.status,
                g.tx_hash,
                g.created_at
            FROM grants g
            WHERE g.file_id = ?
            ORDER BY g.created_at DESC
            """,
            (file_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


# ============================================================================
# Database Operations - Access Requests
# ============================================================================


async def create_access_request(
    cid: str,
    requester_pubkey: str,
    purpose: str,
    owner_id: Optional[int] = None,
) -> int:
    """
    Create a new access request.
    Returns the request ID.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO access_requests (cid, requester_pubkey, purpose, status, owner_id)
            VALUES (?, ?, ?, 'pending', ?)
            """,
            (cid, requester_pubkey, purpose, owner_id),
        )
        await db.commit()
        return cursor.lastrowid


async def get_access_request_by_id(request_id: int) -> Optional[dict]:
    """Get an access request by ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM access_requests WHERE id = ?", (request_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_access_requests_by_cid(cid: str) -> list[dict]:
    """Get all access requests for a specific CID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM access_requests WHERE cid = ?", (cid,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_pending_requests_for_owner(owner_id: int) -> list[dict]:
    """Get all pending access requests for files owned by a user."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT ar.* FROM access_requests ar
            JOIN files f ON ar.cid = f.cid
            WHERE f.owner_id = ? AND ar.status = 'pending'
            ORDER BY ar.created_at DESC
            """,
            (owner_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def approve_access_request(
    request_id: int,
    kfrags_encrypted: str,
    expires_at: Optional[str] = None,
    tx_hash: Optional[str] = None,
    verifying_key: Optional[str] = None,
) -> bool:
    """
    Approve an access request and store encrypted kfrags.
    Returns True if successful.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE access_requests
            SET status = 'approved', kfrags_encrypted = ?, expires_at = ?, tx_hash = ?, verifying_key = ?
            WHERE id = ? AND status = 'pending'
            """,
            (kfrags_encrypted, expires_at, tx_hash, verifying_key, request_id),
        )
        await db.commit()
        return cursor.rowcount > 0


async def deny_access_request(request_id: int) -> bool:
    """
    Deny an access request.
    Returns True if successful.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            UPDATE access_requests
            SET status = 'denied'
            WHERE id = ? AND status = 'pending'
            """,
            (request_id,),
        )
        await db.commit()
        return cursor.rowcount > 0


async def get_approved_request_by_cid_and_pubkey(
    cid: str,
    requester_pubkey: str,
) -> Optional[dict]:
    """Get an approved access request for a specific CID and requester."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT * FROM access_requests
            WHERE cid = ? AND requester_pubkey = ? AND status = 'approved'
            ORDER BY id DESC
            LIMIT 1
            """,
            (cid, requester_pubkey),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def update_file_tx_hash(file_id: int, tx_hash: str) -> bool:
    """
    Update a file record with its on-chain transaction hash.
    Returns True if successful.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # First check if tx_hash column exists, add it if not
        cursor = await db.execute("PRAGMA table_info(files)")
        columns = [row[1] for row in await cursor.fetchall()]
        
        if "tx_hash" not in columns:
            await db.execute("ALTER TABLE files ADD COLUMN tx_hash TEXT")
        
        cursor = await db.execute(
            "UPDATE files SET tx_hash = ? WHERE id = ?",
            (tx_hash, file_id),
        )
        await db.commit()
        return cursor.rowcount > 0
