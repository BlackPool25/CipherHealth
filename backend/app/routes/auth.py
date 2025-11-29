"""
Authentication Routes for Decent-Hospital Backend

Handles invite-only authentication flow:
- POST /auth/seed-login: Login with invite code and receive JWT
- POST /auth/seed-invite: Seeds a single invite code (dev only)
- POST /auth/register: Register using invite code
- GET /auth/me: Get current user from JWT

JWT tokens are used for stateless authentication.
"""

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr

from app.db import (
    UserCreate,
    UserResponse,
    create_invite_code,
    create_user,
    get_invite_code,
    get_user_by_id,
    get_user_by_username,
    update_user_public_key,
    use_invite_code,
)

router = APIRouter()
security = HTTPBearer(auto_error=False)

# ============================================================================
# JWT Configuration
# ============================================================================

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))


# ============================================================================
# Request/Response Models
# ============================================================================


class SeedLoginRequest(BaseModel):
    """Request to login with an invite code."""

    invite_code: str


class SeedLoginResponse(BaseModel):
    """Response after successful seed login."""

    access_token: str
    token_type: str = "bearer"
    user: UserResponse
    message: str


class SeedInviteRequest(BaseModel):
    """Request to seed an invite code (dev only or with admin password)."""

    code: Optional[str] = None
    admin_password: Optional[str] = None  # Required in production mode


class SeedInviteResponse(BaseModel):
    """Response after seeding invite code."""

    code: str
    message: str


class RegisterRequest(BaseModel):
    """Request to register a new user."""

    username: str
    email: EmailStr
    invite_code: str
    public_key: Optional[str] = None


class RegisterResponse(BaseModel):
    """Response after successful registration."""

    user: UserResponse
    access_token: str
    token_type: str = "bearer"
    message: str


class TokenPayload(BaseModel):
    """JWT token payload."""

    sub: str  # user_id as string
    username: str
    exp: datetime


# ============================================================================
# JWT Utilities
# ============================================================================


def create_access_token(user_id: int, username: str) -> str:
    """
    Create a JWT access token for a user.
    
    Args:
        user_id: User's database ID
        username: User's username
        
    Returns:
        Encoded JWT token string
    """
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> TokenPayload:
    """
    Decode and validate a JWT token.
    
    Args:
        token: JWT token string
        
    Returns:
        Decoded token payload
        
    Raises:
        JWTError: If token is invalid or expired
    """
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    return TokenPayload(
        sub=payload["sub"],
        username=payload["username"],
        exp=datetime.fromtimestamp(payload["exp"], tz=timezone.utc),
    )


async def get_current_user_from_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    """
    Dependency to get the current user from JWT token.
    
    Returns None if no token provided (for optional auth endpoints).
    """
    if not credentials:
        return None
    
    try:
        token = credentials.credentials
        payload = decode_token(token)
        user_id = int(payload.sub)
        user = await get_user_by_id(user_id)
        return user
    except (JWTError, ValueError):
        return None


async def require_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    """
    Dependency to require authenticated user.
    
    Raises HTTPException 401 if not authenticated.
    """
    user = await get_current_user_from_token(credentials)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# ============================================================================
# Routes
# ============================================================================


@router.post("/seed-login", response_model=SeedLoginResponse)
async def seed_login(request: SeedLoginRequest):
    """
    Login with an invite code.
    
    This is the primary authentication endpoint. Users provide their
    invite code to receive a JWT token.
    
    For new users, this creates an account with a generated username.
    For existing users (code already used), validates and returns token.
    
    Args:
        request: Login request with invite_code
        
    Returns:
        JWT token and user information
        
    Raises:
        HTTPException 400: If invite code is invalid
    """
    # Validate invite code exists
    invite = await get_invite_code(request.invite_code)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid invite code",
        )
    
    # Check if code was already used (returning user)
    if invite.get("used_by") is not None:
        # Get the user who used this code
        user = await get_user_by_id(invite["used_by"])
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User not found",
            )
        
        # Generate token for existing user
        access_token = create_access_token(user["id"], user["username"])
        
        return SeedLoginResponse(
            access_token=access_token,
            token_type="bearer",
            user=UserResponse(
                id=user["id"],
                username=user["username"],
                email=user.get("email", ""),
                public_key=user.get("public_key"),
                created_at=str(user.get("created_at", "")),
            ),
            message="Login successful",
        )
    
    # New user - create account
    # Generate a unique username based on invite code
    username = f"user_{secrets.token_hex(4)}"
    email = f"{username}@cipherhealth.local"
    
    try:
        user_data = UserCreate(
            username=username,
            email=email,
            invite_code=request.invite_code,
            public_key=None,
        )
        user_id = await create_user(user_data)
        
        # Mark invite code as used
        await use_invite_code(request.invite_code, user_id)
        
        # Generate token
        access_token = create_access_token(user_id, username)
        
        return SeedLoginResponse(
            access_token=access_token,
            token_type="bearer",
            user=UserResponse(
                id=user_id,
                username=username,
                email=email,
                public_key=None,
                created_at="",
            ),
            message="Account created and logged in",
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create user: {str(e)}",
        )


@router.post("/seed-invite", response_model=SeedInviteResponse)
async def seed_invite(request: SeedInviteRequest):
    """
    Seed a single invite code.
    
    In development mode (DEV_MODE=true), no password required.
    In production mode, requires admin_password to generate codes.
    
    Args:
        request: Optional invite code and admin password.
        
    Returns:
        The created invite code.
        
    Raises:
        HTTPException 403: If not in dev mode and password incorrect.
        HTTPException 409: If invite code already exists.
    """
    dev_mode = os.getenv("DEV_MODE", "false").lower() == "true"
    
    # Admin password for production invite generation
    ADMIN_PASSWORD = os.getenv("ADMIN_INVITE_PASSWORD", "%bWvcjE5X66dZuyTUtQt")
    
    if not dev_mode:
        # In production, require admin password
        if not request.admin_password or request.admin_password != ADMIN_PASSWORD:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin password required to generate invite codes in production",
            )
    
    code = request.code or secrets.token_urlsafe(16)
    
    existing = await get_invite_code(code)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invite code already exists",
        )
    
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
    the invite code is marked as used and a JWT is returned.
    
    Args:
        request: Registration details including invite code.
        
    Returns:
        The created user information and JWT token.
        
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
    
    try:
        user_data = UserCreate(
            username=request.username,
            email=request.email,
            invite_code=request.invite_code,
            public_key=request.public_key,
        )
        user_id = await create_user(user_data)
        
        await use_invite_code(request.invite_code, user_id)
        
        access_token = create_access_token(user_id, request.username)
        
        user_response = UserResponse(
            id=user_id,
            username=request.username,
            email=request.email,
            public_key=request.public_key,
            created_at="",
        )
        
        return RegisterResponse(
            user=user_response,
            access_token=access_token,
            token_type="bearer",
            message="User registered successfully",
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register user: {str(e)}",
        )


@router.get("/me")
async def get_me(current_user: dict = Depends(require_current_user)):
    """
    Get the current authenticated user.
    
    Requires valid JWT token in Authorization header.
    
    Returns:
        Current user's information.
    """
    return UserResponse(
        id=current_user["id"],
        username=current_user["username"],
        email=current_user.get("email", ""),
        public_key=current_user.get("public_key"),
        created_at=str(current_user.get("created_at", "")),
    )


@router.post("/refresh")
async def refresh_token(current_user: dict = Depends(require_current_user)):
    """
    Refresh the JWT token.
    
    Returns a new token with extended expiration.
    
    Returns:
        New access token.
    """
    access_token = create_access_token(
        current_user["id"],
        current_user["username"],
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
    }


@router.post("/logout")
async def logout():
    """
    Logout endpoint (client-side token deletion).
    
    JWT tokens are stateless, so logout is handled client-side
    by deleting the stored token.
    
    Returns:
        Success message.
    """
    return {"message": "Logged out successfully. Please delete the token client-side."}


class UpdatePublicKeyRequest(BaseModel):
    """Request to update user's Umbral public key."""
    public_key: str


@router.post("/update-public-key")
async def update_public_key(
    request: UpdatePublicKeyRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Update the current user's Umbral public key.
    
    This allows users to register or update their public key for
    proxy re-encryption operations.
    
    Args:
        request: New public key (hex encoded)
        current_user: Authenticated user
        
    Returns:
        Success message with the registered key
    """
    # Basic validation - Umbral public keys are 33 bytes (66 hex chars)
    if not request.public_key or len(request.public_key) < 64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid public key format. Expected hex-encoded Umbral public key.",
        )
    
    # Try to validate it's valid hex
    try:
        bytes.fromhex(request.public_key)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid public key format. Must be hex-encoded.",
        )
    
    success = await update_user_public_key(
        user_id=current_user["id"],
        public_key=request.public_key,
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update public key",
        )
    
    return {
        "message": "Public key updated successfully",
        "public_key": request.public_key,
    }
