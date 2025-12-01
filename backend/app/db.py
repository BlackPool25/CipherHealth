"""
Database module for Decent-Hospital Backend

Uses SQLite with aiosqlite for async operations.
Defines models for users, files, and grants.
"""

import os
import secrets
import sqlite3
import uuid
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
    category: Optional[str] = None  # File category (e.g., Lab Results, Imaging)
    description: Optional[str] = None  # Description/notes about the file
    uploaded_by_hospital_id: Optional[int] = None  # Hospital that uploaded for patient
    tx_hash: Optional[str] = None  # On-chain transaction hash
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
# User Profile Models
# ============================================================================


class PatientProfileCreate(BaseModel):
    """Schema for creating/updating patient profile."""
    
    full_name: str
    date_of_birth: str  # ISO format: YYYY-MM-DD
    gender: str  # male, female, other
    aadhar: Optional[str] = None  # Will be encrypted before storage
    blood_group: Optional[str] = None
    phone: Optional[str] = None
    emergency_contact: Optional[str] = None
    address: Optional[str] = None


class HospitalProfileCreate(BaseModel):
    """Schema for creating/updating hospital profile."""
    
    hospital_name: str
    branch_name: str
    location: str
    registration_id: Optional[str] = None  # Will be encrypted before storage
    phone: Optional[str] = None
    specializations: Optional[str] = None  # Comma-separated
    accreditation: Optional[str] = None  # e.g., NABH, JCI


class UserProfileResponse(BaseModel):
    """Schema for profile response (public/shareable fields only)."""
    
    user_id: int
    role: str
    full_name: Optional[str] = None
    profile_completed: bool = False
    
    # Patient fields (shareable)
    gender: Optional[str] = None
    blood_group: Optional[str] = None
    # Age calculated from DOB, not the DOB itself
    age: Optional[int] = None
    
    # Hospital fields (shareable)
    hospital_name: Optional[str] = None
    branch_name: Optional[str] = None
    location: Optional[str] = None
    specializations: Optional[str] = None
    accreditation: Optional[str] = None


class UserProfilePrivateResponse(BaseModel):
    """Schema for full profile response (owner-only, includes sensitive data)."""
    
    user_id: int
    role: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    profile_completed: bool = False
    
    # Patient fields
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    aadhar_masked: Optional[str] = None  # Masked: XXXX-XXXX-1234
    blood_group: Optional[str] = None
    emergency_contact: Optional[str] = None
    address: Optional[str] = None
    
    # Hospital fields
    hospital_name: Optional[str] = None
    branch_name: Optional[str] = None
    location: Optional[str] = None
    registration_id_masked: Optional[str] = None  # Masked: ******1234
    specializations: Optional[str] = None
    accreditation: Optional[str] = None
    
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


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
                uuid TEXT UNIQUE,
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
                uploaded_by_hospital_id INTEGER,
                category TEXT,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id),
                FOREIGN KEY (uploaded_by_hospital_id) REFERENCES users(id)
            )
        """)
        
        # Migration: Add uploaded_by_hospital_id, category, and description columns if they don't exist
        for column, col_type in [("uploaded_by_hospital_id", "INTEGER"), ("category", "TEXT"), ("description", "TEXT")]:
            try:
                await db.execute(f"ALTER TABLE files ADD COLUMN {column} {col_type}")
            except Exception:
                pass  # Column already exists

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

        # Migration: Add uuid column to users if it doesn't exist
        try:
            await db.execute("ALTER TABLE users ADD COLUMN uuid TEXT UNIQUE")
        except Exception:
            pass  # Column already exists

        # Generate UUIDs for existing users that don't have one
        try:
            cursor = await db.execute("SELECT id FROM users WHERE uuid IS NULL")
            users_without_uuid = await cursor.fetchall()
            for (user_id,) in users_without_uuid:
                new_uuid = str(uuid.uuid4())
                await db.execute("UPDATE users SET uuid = ? WHERE id = ?", (new_uuid, user_id))
        except Exception as e:
            print(f"Error generating UUIDs for existing users: {e}")

        # Audit logs table - for blockchain-verified audit trail
        # Enhanced with hash columns for on-chain event correlation
        await db.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                actor_id INTEGER,
                target_id INTEGER,
                patient_id INTEGER,
                file_id INTEGER,
                cid TEXT,
                cid_hash TEXT,
                patient_id_hash TEXT,
                hospital_id_hash TEXT,
                details TEXT,
                tx_hash TEXT,
                block_number INTEGER,
                chain_timestamp INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (actor_id) REFERENCES users(id),
                FOREIGN KEY (target_id) REFERENCES users(id),
                FOREIGN KEY (patient_id) REFERENCES users(id),
                FOREIGN KEY (file_id) REFERENCES files(id)
            )
        """)
        
        # Migration: Add hash columns to audit_logs if they don't exist
        for column in ["cid_hash", "patient_id_hash", "hospital_id_hash", "chain_timestamp"]:
            try:
                await db.execute(f"ALTER TABLE audit_logs ADD COLUMN {column} TEXT")
            except Exception:
                pass  # Column already exists

        # User profiles table - stores extended profile info for patients and hospitals
        # Sensitive fields (aadhar, registration_id) are encrypted at application level
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER UNIQUE NOT NULL,
                
                -- Common fields
                full_name TEXT,
                phone TEXT,
                
                -- Patient-specific fields
                date_of_birth TEXT,
                gender TEXT,
                aadhar_encrypted TEXT,
                blood_group TEXT,
                emergency_contact TEXT,
                address TEXT,
                
                -- Hospital-specific fields
                hospital_name TEXT,
                branch_name TEXT,
                location TEXT,
                registration_id_encrypted TEXT,
                specializations TEXT,
                accreditation TEXT,
                
                -- Metadata
                profile_completed INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)

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
    user_uuid = str(uuid.uuid4())
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO users (uuid, username, email, public_key)
            VALUES (?, ?, ?, ?)
            """,
            (user_uuid, user.username, user.email, user.public_key),
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


async def get_user_by_uuid(user_uuid: str) -> Optional[dict]:
    """Get a user by their UUID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM users WHERE uuid = ?", (user_uuid,)
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
    user_uuid = str(uuid.uuid4())
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO users (uuid, username, email, password_hash, role, public_key, needs_profile_upload)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (user_uuid, username, email, password_hash, role, public_key, 1 if needs_profile_upload else 0),
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
    # Ensure category column exists
    await ensure_files_columns()
    
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO files (cid, owner_id, filename, encrypted_cek, capsule, category, description, uploaded_by_hospital_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (file.cid, file.owner_id, file.filename, file.encrypted_cek, file.capsule, file.category, file.description, file.uploaded_by_hospital_id),
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
    """Get all files owned by a user, including hospital uploader info."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT f.*, 
                   h.username as uploaded_by_hospital_name,
                   h.role as uploader_role
            FROM files f
            LEFT JOIN users h ON f.uploaded_by_hospital_id = h.id
            WHERE f.owner_id = ?
            ORDER BY f.created_at DESC
            """,
            (owner_id,)
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


async def get_grants_by_granter(granter_id: int, include_revoked: bool = False) -> list[dict]:
    """Get all grants created by a granter with file and grantee info.
    
    Args:
        granter_id: ID of the user who created the grants
        include_revoked: If False (default), only return active grants.
                        If True, return all grants including revoked ones.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        
        # Build status filter - exclude revoked grants by default
        status_filter = "" if include_revoked else "AND g.status = 'active'"
        
        cursor = await db.execute(
            f"""
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
            WHERE g.granter_id = ? {status_filter}
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


async def get_grant_by_file_and_grantee(file_id: int, grantee_id: int) -> Optional[dict]:
    """
    Get an active grant for a specific file and grantee.
    
    Args:
        file_id: ID of the file
        grantee_id: ID of the grantee user
        
    Returns:
        Grant dictionary if found, None otherwise
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
            WHERE g.file_id = ? AND g.grantee_id = ? AND g.status = 'active'
            ORDER BY g.created_at DESC
            LIMIT 1
            """,
            (file_id, grantee_id),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


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


async def ensure_files_columns() -> None:
    """
    Ensure files table has all required columns (tx_hash, category, uploaded_by_hospital_id).
    Run at startup or before operations that need these columns.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute("PRAGMA table_info(files)")
        columns = [row[1] for row in await cursor.fetchall()]
        
        if "tx_hash" not in columns:
            await db.execute("ALTER TABLE files ADD COLUMN tx_hash TEXT")
        
        if "category" not in columns:
            await db.execute("ALTER TABLE files ADD COLUMN category TEXT")
        
        if "uploaded_by_hospital_id" not in columns:
            await db.execute("ALTER TABLE files ADD COLUMN uploaded_by_hospital_id INTEGER")
        
        await db.commit()


async def update_file_tx_hash(file_id: int, tx_hash: str) -> bool:
    """
    Update a file record with its on-chain transaction hash.
    Returns True if successful.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Ensure columns exist
        await ensure_files_columns()
        
        cursor = await db.execute(
            "UPDATE files SET tx_hash = ? WHERE id = ?",
            (tx_hash, file_id),
        )
        await db.commit()
        return cursor.rowcount > 0


async def update_file_category(file_id: int, category: str) -> bool:
    """
    Update a file record with its category.
    Returns True if successful.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Ensure columns exist
        await ensure_files_columns()
        
        cursor = await db.execute(
            "UPDATE files SET category = ? WHERE id = ?",
            (category, file_id),
        )
        await db.commit()
        return cursor.rowcount > 0


async def update_file_display_name(file_id: int, display_name: str, owner_id: int) -> bool:
    """
    Update a file's display name (what the user sees).
    
    This does NOT affect:
    - The CID (content-addressed, immutable)
    - The actual stored filename (used for content-type detection)
    - Access grants or encryption
    
    Args:
        file_id: ID of the file to rename
        display_name: New display name for the file
        owner_id: ID of the user (must own the file)
        
    Returns:
        True if successful, False if file not found or not owned by user
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Add display_name column if it doesn't exist
        try:
            await db.execute("ALTER TABLE files ADD COLUMN display_name TEXT")
        except Exception:
            pass  # Column already exists
        
        # Only allow owner to rename
        cursor = await db.execute(
            "UPDATE files SET display_name = ? WHERE id = ? AND owner_id = ?",
            (display_name, file_id, owner_id),
        )
        await db.commit()
        return cursor.rowcount > 0


async def get_users_without_uuid() -> list[dict]:
    """
    Get all users that don't have a UUID assigned.
    
    These are legacy users from before UUIDs were mandatory.
    They need to re-register or be cleaned up.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM users WHERE uuid IS NULL OR uuid = ''"
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def delete_users_without_uuid() -> int:
    """
    Delete all users that don't have a UUID.
    
    WARNING: This is destructive! Should be called only during cleanup.
    This will also delete associated data (files, grants) due to FK constraints.
    
    Returns:
        Number of users deleted
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Get IDs first for cleanup
        cursor = await db.execute(
            "SELECT id FROM users WHERE uuid IS NULL OR uuid = ''"
        )
        rows = await cursor.fetchall()
        user_ids = [row[0] for row in rows]
        
        if not user_ids:
            return 0
        
        placeholders = ",".join("?" * len(user_ids))
        
        # Delete associated grants
        await db.execute(
            f"DELETE FROM grants WHERE granter_id IN ({placeholders}) OR grantee_id IN ({placeholders})",
            user_ids + user_ids,
        )
        
        # Delete associated files
        await db.execute(
            f"DELETE FROM files WHERE owner_id IN ({placeholders})",
            user_ids,
        )
        
        # Delete associated access requests
        await db.execute(
            f"DELETE FROM access_requests WHERE owner_id IN ({placeholders})",
            user_ids,
        )
        
        # Delete the users
        cursor = await db.execute(
            f"DELETE FROM users WHERE id IN ({placeholders})",
            user_ids,
        )
        
        await db.commit()
        return cursor.rowcount


async def get_files_accessed_by_hospital(patient_id: int, hospital_id: int) -> list[dict]:
    """
    Get list of files that a specific hospital has accessed for a patient.
    
    This is used for selective rotation - only rotate files the revoked hospital 
    actually accessed, not all files.
    
    Returns list of file records with access metadata.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        
        # Get files that have active grants to this hospital
        cursor = await db.execute(
            """
            SELECT DISTINCT f.*, g.created_at as granted_at, g.id as grant_id
            FROM files f
            JOIN grants g ON f.id = g.file_id
            WHERE f.owner_id = ? 
              AND g.grantee_id = ?
              AND g.status = 'active'
            ORDER BY g.created_at DESC
            """,
            (patient_id, hospital_id),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


# ============================================================================
# Database Operations - Audit Logs
# ============================================================================


async def create_audit_log(
    event_type: str,
    actor_id: Optional[int] = None,
    target_id: Optional[int] = None,
    patient_id: Optional[int] = None,
    file_id: Optional[int] = None,
    cid: Optional[str] = None,
    cid_hash: Optional[str] = None,
    patient_id_hash: Optional[str] = None,
    hospital_id_hash: Optional[str] = None,
    details: Optional[str] = None,
    tx_hash: Optional[str] = None,
    block_number: Optional[int] = None,
    chain_timestamp: Optional[int] = None,
) -> int:
    """
    Create a new audit log entry.
    
    Args:
        event_type: Type of event (access, grant, revoke, upload, AccessGranted, etc.)
        actor_id: ID of user performing the action
        target_id: ID of the target user (e.g., patient for hospital access)
        patient_id: ID of the patient whose records are involved
        file_id: ID of the file accessed
        cid: Content identifier of the file
        cid_hash: keccak256 hash of the CID (from chain event)
        patient_id_hash: keccak256 hash of patientId (from chain event)
        hospital_id_hash: keccak256 hash of hospitalId (from chain event)
        details: JSON string with additional details
        tx_hash: Blockchain transaction hash
        block_number: Blockchain block number
        chain_timestamp: Timestamp from blockchain event
        
    Returns:
        ID of the created audit log entry
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO audit_logs (
                event_type, actor_id, target_id, patient_id, 
                file_id, cid, cid_hash, patient_id_hash, hospital_id_hash,
                details, tx_hash, block_number, chain_timestamp
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (event_type, actor_id, target_id, patient_id, file_id, cid,
             cid_hash, patient_id_hash, hospital_id_hash, details, 
             tx_hash, block_number, chain_timestamp),
        )
        await db.commit()
        return cursor.lastrowid


async def get_audit_logs_for_patient(patient_id: int) -> list[dict]:
    """
    Get all audit logs related to a patient.
    
    Returns logs where the patient is either the actor, target, or patient_id.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT al.*, 
                   u1.username as actor_name, u1.role as actor_role,
                   u2.username as target_name, u2.role as target_role,
                   f.filename
            FROM audit_logs al
            LEFT JOIN users u1 ON al.actor_id = u1.id
            LEFT JOIN users u2 ON al.target_id = u2.id
            LEFT JOIN files f ON al.file_id = f.id
            WHERE al.patient_id = ? OR al.actor_id = ? OR al.target_id = ?
            ORDER BY al.created_at DESC
            """,
            (patient_id, patient_id, patient_id),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_audit_logs_by_type(patient_id: int, event_type: str) -> list[dict]:
    """
    Get audit logs of a specific type for a patient.
    
    Args:
        patient_id: The patient's ID
        event_type: Type of event to filter by (access, grant, revoke, upload)
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT al.*, 
                   u1.username as actor_name, u1.role as actor_role,
                   u2.username as target_name, u2.role as target_role,
                   f.filename
            FROM audit_logs al
            LEFT JOIN users u1 ON al.actor_id = u1.id
            LEFT JOIN users u2 ON al.target_id = u2.id
            LEFT JOIN files f ON al.file_id = f.id
            WHERE (al.patient_id = ? OR al.actor_id = ? OR al.target_id = ?)
              AND al.event_type = ?
            ORDER BY al.created_at DESC
            """,
            (patient_id, patient_id, patient_id, event_type),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_grant_events_for_patient(patient_id: int) -> list[dict]:
    """
    Get all grant events from audit_logs for a patient.
    This captures grants that may not be in the grants table.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT al.*, 
                   u1.username as actor_name,
                   u2.username as target_name, u2.role as target_role,
                   f.filename
            FROM audit_logs al
            LEFT JOIN users u1 ON al.actor_id = u1.id
            LEFT JOIN users u2 ON al.target_id = u2.id
            LEFT JOIN files f ON al.file_id = f.id
            WHERE al.patient_id = ? AND al.event_type = 'grant'
            ORDER BY al.created_at DESC
            """,
            (patient_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_grants_for_patient(patient_id: int) -> list[dict]:
    """
    Get all grants where the patient is the granter (active and revoked).
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT g.*, 
                   u.username as grantee_name, u.role as grantee_role,
                   f.filename, f.cid
            FROM grants g
            LEFT JOIN users u ON g.grantee_id = u.id
            LEFT JOIN files f ON g.file_id = f.id
            WHERE g.granter_id = ?
            ORDER BY g.created_at DESC
            """,
            (patient_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_access_events_for_patient(patient_id: int) -> list[dict]:
    """
    Get all access events for a patient's records.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT al.*, 
                   u1.username as actor_name, u1.role as actor_role,
                   f.filename
            FROM audit_logs al
            LEFT JOIN users u1 ON al.actor_id = u1.id
            LEFT JOIN files f ON al.file_id = f.id
            WHERE al.patient_id = ? AND al.event_type = 'access'
            ORDER BY al.created_at DESC
            """,
            (patient_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_revoke_events_for_patient(patient_id: int) -> list[dict]:
    """
    Get all revoke events for a patient.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT al.*, 
                   u1.username as actor_name,
                   u2.username as target_name, u2.role as target_role,
                   f.filename
            FROM audit_logs al
            LEFT JOIN users u1 ON al.actor_id = u1.id
            LEFT JOIN users u2 ON al.target_id = u2.id
            LEFT JOIN files f ON al.file_id = f.id
            WHERE al.patient_id = ? AND al.event_type = 'revoke'
            ORDER BY al.created_at DESC
            """,
            (patient_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_audit_logs_for_hospital(hospital_id: int) -> list[dict]:
    """
    Get all audit logs where the hospital was the actor.
    This includes uploads, file access, and grant events performed by the hospital.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT al.*, 
                   p.username as patient_name,
                   f.filename,
                   f.cid
            FROM audit_logs al
            LEFT JOIN users p ON al.patient_id = p.id
            LEFT JOIN files f ON al.file_id = f.id
            WHERE al.actor_id = ?
            ORDER BY al.created_at DESC
            """,
            (hospital_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_hospital_access_events(hospital_id: int) -> list[dict]:
    """
    Get all file access events for a hospital.
    Shows which patient files the hospital has accessed.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT al.*, 
                   p.username as patient_name,
                   f.filename,
                   f.cid
            FROM audit_logs al
            LEFT JOIN users p ON al.patient_id = p.id
            LEFT JOIN files f ON al.file_id = f.id
            WHERE al.actor_id = ? AND al.event_type = 'access'
            ORDER BY al.created_at DESC
            """,
            (hospital_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_hospital_upload_events(hospital_id: int) -> list[dict]:
    """
    Get all upload events for a hospital.
    Shows files the hospital has uploaded for patients.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT al.*, 
                   p.username as patient_name,
                   f.filename,
                   f.cid
            FROM audit_logs al
            LEFT JOIN users p ON al.patient_id = p.id
            LEFT JOIN files f ON al.file_id = f.id
            WHERE al.actor_id = ? AND al.event_type = 'upload'
            ORDER BY al.created_at DESC
            """,
            (hospital_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


# ============================================================================
# Database Operations - User Profiles
# ============================================================================


async def create_or_update_patient_profile(
    user_id: int,
    full_name: str,
    date_of_birth: str,
    gender: str,
    aadhar_encrypted: Optional[str] = None,
    blood_group: Optional[str] = None,
    phone: Optional[str] = None,
    emergency_contact: Optional[str] = None,
    address: Optional[str] = None,
) -> bool:
    """
    Create or update a patient's profile.
    
    Args:
        user_id: The user's ID
        full_name: Patient's full name
        date_of_birth: Date of birth (YYYY-MM-DD)
        gender: Gender (male/female/other)
        aadhar_encrypted: Encrypted Aadhar number
        blood_group: Blood group
        phone: Phone number
        emergency_contact: Emergency contact info
        address: Address
        
    Returns:
        True if successful
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Check if profile exists
        cursor = await db.execute(
            "SELECT id FROM user_profiles WHERE user_id = ?",
            (user_id,)
        )
        existing = await cursor.fetchone()
        
        if existing:
            # Update existing profile
            await db.execute(
                """
                UPDATE user_profiles SET
                    full_name = ?,
                    date_of_birth = ?,
                    gender = ?,
                    aadhar_encrypted = ?,
                    blood_group = ?,
                    phone = ?,
                    emergency_contact = ?,
                    address = ?,
                    profile_completed = 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
                """,
                (full_name, date_of_birth, gender, aadhar_encrypted,
                 blood_group, phone, emergency_contact, address, user_id)
            )
        else:
            # Create new profile
            await db.execute(
                """
                INSERT INTO user_profiles (
                    user_id, full_name, date_of_birth, gender,
                    aadhar_encrypted, blood_group, phone,
                    emergency_contact, address, profile_completed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (user_id, full_name, date_of_birth, gender,
                 aadhar_encrypted, blood_group, phone,
                 emergency_contact, address)
            )
        
        # Update needs_profile_upload flag
        await db.execute(
            "UPDATE users SET needs_profile_upload = 0 WHERE id = ?",
            (user_id,)
        )
        
        await db.commit()
        return True


async def create_or_update_hospital_profile(
    user_id: int,
    hospital_name: str,
    branch_name: str,
    location: str,
    registration_id_encrypted: Optional[str] = None,
    phone: Optional[str] = None,
    specializations: Optional[str] = None,
    accreditation: Optional[str] = None,
) -> bool:
    """
    Create or update a hospital's profile.
    
    Args:
        user_id: The user's ID
        hospital_name: Hospital name
        branch_name: Branch name
        location: Location/city
        registration_id_encrypted: Encrypted registration ID
        phone: Contact phone
        specializations: Comma-separated specializations
        accreditation: Accreditation (NABH, JCI, etc.)
        
    Returns:
        True if successful
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Check if profile exists
        cursor = await db.execute(
            "SELECT id FROM user_profiles WHERE user_id = ?",
            (user_id,)
        )
        existing = await cursor.fetchone()
        
        if existing:
            # Update existing profile
            await db.execute(
                """
                UPDATE user_profiles SET
                    hospital_name = ?,
                    branch_name = ?,
                    location = ?,
                    registration_id_encrypted = ?,
                    phone = ?,
                    specializations = ?,
                    accreditation = ?,
                    full_name = ?,
                    profile_completed = 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
                """,
                (hospital_name, branch_name, location, registration_id_encrypted,
                 phone, specializations, accreditation, hospital_name, user_id)
            )
        else:
            # Create new profile
            await db.execute(
                """
                INSERT INTO user_profiles (
                    user_id, hospital_name, branch_name, location,
                    registration_id_encrypted, phone, specializations,
                    accreditation, full_name, profile_completed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (user_id, hospital_name, branch_name, location,
                 registration_id_encrypted, phone, specializations,
                 accreditation, hospital_name)
            )
        
        await db.commit()
        return True


async def get_user_profile(user_id: int) -> Optional[dict]:
    """
    Get a user's full profile (for the owner).
    
    Returns all profile fields including encrypted sensitive data.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT up.*, u.role, u.username, u.email, u.uuid
            FROM user_profiles up
            JOIN users u ON up.user_id = u.id
            WHERE up.user_id = ?
            """,
            (user_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def get_user_profile_public(user_id: int) -> Optional[dict]:
    """
    Get a user's public profile (for other users to see).
    
    Returns only shareable fields, never sensitive data.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT 
                up.user_id,
                u.role,
                up.full_name,
                up.profile_completed,
                -- Patient shareable fields
                up.gender,
                up.blood_group,
                up.date_of_birth,
                -- Hospital shareable fields
                up.hospital_name,
                up.branch_name,
                up.location,
                up.specializations,
                up.accreditation
            FROM user_profiles up
            JOIN users u ON up.user_id = u.id
            WHERE up.user_id = ?
            """,
            (user_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def check_profile_completed(user_id: int) -> bool:
    """Check if a user has completed their profile."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "SELECT profile_completed FROM user_profiles WHERE user_id = ?",
            (user_id,)
        )
        row = await cursor.fetchone()
        return bool(row and row[0]) if row else False
