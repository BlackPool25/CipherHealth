"""
Database module for Decent-Hospital Backend

Uses SQLite with aiosqlite for async operations.
Defines models for users, files, and grants.
"""

import os
import sqlite3
from datetime import datetime
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


class InviteCode(BaseModel):
    """Schema for invite code."""

    code: str
    created_by: Optional[int] = None
    used_by: Optional[int] = None
    created_at: Optional[str] = None
    used_at: Optional[str] = None


# ============================================================================
# Database Initialization
# ============================================================================


async def init_db():
    """
    Initialize the SQLite database with required tables.
    Creates tables if they don't exist.
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Users table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                public_key TEXT,
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
            INSERT INTO files (cid, owner_id, filename, encrypted_cek)
            VALUES (?, ?, ?, ?)
            """,
            (file.cid, file.owner_id, file.filename, file.encrypted_cek),
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
    """Get all active grants for a grantee."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT * FROM grants
            WHERE grantee_id = ? AND status = 'active'
            """,
            (grantee_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_grants_by_granter(granter_id: int) -> list[dict]:
    """Get all grants created by a granter."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM grants WHERE granter_id = ?", (granter_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
