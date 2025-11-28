"""
Authentication Routes for Decent-Hospital Backend

Handles invite-only signup flow:
- POST /auth/seed-invite: Seeds a single invite code (dev only)
- POST /auth/register: Register using invite code
"""

import os
import secrets
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr

from app.db import (
    UserCreate,
    UserResponse,
    create_invite_code,
    create_user,
    get_invite_code,
    get_user_by_username,
    use_invite_code,
)

router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class SeedInviteRequest(BaseModel):
    """Request to seed an invite code (dev only)."""

    code: Optional[str] = None  # If not provided, generates random code


class SeedInviteResponse(BaseModel):
    """Response after seeding invite code."""

    code: str
    message: str


class RegisterRequest(BaseModel):
    """Request to register a new user."""

    username: str
    email: EmailStr
    invite_code: str
    public_key: Optional[str] = None  # Umbral public key (hex encoded)


class RegisterResponse(BaseModel):
    """Response after successful registration."""

    user: UserResponse
    message: str


class LoginRequest(BaseModel):
    """Request to login (placeholder for future auth)."""

    username: str
    # TODO: Add signature-based authentication with Umbral keys


class LoginResponse(BaseModel):
    """Response after successful login."""

    user: UserResponse
    token: str  # TODO: Implement JWT or session token


# ============================================================================
# Routes
# ============================================================================


@router.post("/seed-invite", response_model=SeedInviteResponse)
async def seed_invite(request: SeedInviteRequest):
    """
    Seed a single invite code (development only).

    This endpoint is only available when DEV_MODE=true in environment.
    In production, invite codes should be generated through admin interface
    or on-chain mechanisms.

    Args:
        request: Optional invite code. If not provided, generates random code.

    Returns:
        The created invite code.

    Raises:
        HTTPException 403: If not in dev mode.
        HTTPException 409: If invite code already exists.
    """
    # Check if we're in dev mode
    dev_mode = os.getenv("DEV_MODE", "false").lower() == "true"
    if not dev_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is only available in development mode",
        )

    # Generate or use provided code
    code = request.code or secrets.token_urlsafe(16)

    # Check if code already exists
    existing = await get_invite_code(code)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invite code already exists",
        )

    # Create the invite code
    try:
        await create_invite_code(code)
        return SeedInviteResponse(
            code=code,
            message="Invite code created successfully",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create invite code: {str(e)}",
        )


@router.post("/register", response_model=RegisterResponse)
async def register(request: RegisterRequest):
    """
    Register a new user with an invite code.

    The invite code must be valid and unused. After registration,
    the invite code is marked as used.

    Args:
        request: Registration details including invite code.

    Returns:
        The created user information.

    Raises:
        HTTPException 400: If invite code is invalid or already used.
        HTTPException 409: If username or email already exists.
    """
    # Validate invite code
    invite = await get_invite_code(request.invite_code)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid invite code",
        )

    if invite.get("used_by") is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite code has already been used",
        )

    # Check if username already exists
    existing_user = await get_user_by_username(request.username)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )

    # Create the user
    try:
        user_data = UserCreate(
            username=request.username,
            email=request.email,
            invite_code=request.invite_code,
            public_key=request.public_key,
        )
        user_id = await create_user(user_data)

        # Mark invite code as used
        await use_invite_code(request.invite_code, user_id)

        # Return the created user
        user_response = UserResponse(
            id=user_id,
            username=request.username,
            email=request.email,
            public_key=request.public_key,
            created_at="",  # TODO: Return actual timestamp
        )

        return RegisterResponse(
            user=user_response,
            message="User registered successfully",
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register user: {str(e)}",
        )


@router.post("/login", response_model=LoginResponse)
async def login(request: LoginRequest):
    """
    Login placeholder endpoint.

    TODO: Implement signature-based authentication:
    1. Client signs a challenge with their Umbral signing key
    2. Server verifies signature against stored public key
    3. Server issues JWT or session token

    Raises:
        HTTPException 501: Not implemented.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Login not yet implemented. TODO: Add signature-based auth with Umbral keys",
    )


@router.get("/me")
async def get_current_user():
    """
    Get current authenticated user.

    TODO: Implement after login is working.

    Raises:
        HTTPException 501: Not implemented.
    """
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Authentication not yet implemented",
    )
