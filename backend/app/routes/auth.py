"""
Authentication Routes for Decent-Hospital Backend

Handles invite-only authentication flow:
- POST /auth/seed-login: Login with invite code and receive JWT
- POST /auth/seed-invite: Seeds a single invite code (dev only)
- POST /auth/register: Register using invite code
- POST /auth/register-v2: Register with role-based logic (hospital/patient)
- POST /auth/hospital/generate-invite: Hospital generates single-use invite tokens
- POST /auth/use-invite: Validate single-use invite tokens
- GET /auth/me: Get current user from JWT

JWT tokens are used for stateless authentication.
"""

import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Ensure .env is loaded - check multiple locations
for env_path in [
    Path(__file__).parent.parent.parent.parent / ".env",  # workspace root
    Path(__file__).parent.parent.parent / ".env",  # backend root
    Path(".env"),
]:
    if env_path.exists():
        load_dotenv(env_path, override=True)
        break

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr

from app.db import (
    UserCreate,
    UserResponse,
    UserRole,
    create_hospital_invite_token,
    create_invite_code,
    create_user,
    create_user_with_password,
    get_hospital_invite_token,
    get_hospital_invite_tokens,
    get_invite_code,
    get_user_by_email,
    get_user_by_id,
    get_user_by_username,
    get_user_by_uuid,
    update_user_public_key,
    use_hospital_invite_token,
    use_invite_code,
    validate_hospital_invite_token,
)

router = APIRouter()
security = HTTPBearer(auto_error=False)

# ============================================================================
# Password Hasher (Argon2)
# ============================================================================

ph = PasswordHasher()

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
# New Registration Models (Role-based)
# ============================================================================


class RegisterV2Request(BaseModel):
    """Request for role-based registration (hospital or patient)."""

    role: str  # "patient" or "hospital"
    username: str
    password: str
    email: Optional[EmailStr] = None
    invite_token: Optional[str] = None  # For patient registration via hospital invite


class RegisterV2Response(BaseModel):
    """Response for role-based registration."""

    user_id: int
    role: str
    patient_id: Optional[str] = None  # UUID for patients
    hospital_id: Optional[str] = None  # UUID for hospitals
    access_token: str
    token_type: str = "bearer"
    message: str


class GenerateInviteRequest(BaseModel):
    """Request to generate a hospital invite token."""

    expires_seconds: Optional[int] = None  # Defaults to INVITE_TOKEN_EXPIRY_SECONDS


class GenerateInviteResponse(BaseModel):
    """Response with generated invite token."""

    invite_token: str
    expires_at: str
    message: str


class UseInviteRequest(BaseModel):
    """Request to validate a hospital invite token."""

    invite_token: str


class UseInviteResponse(BaseModel):
    """Response for validating invite token."""

    valid: bool
    hospital_id: Optional[int] = None
    expires_at: Optional[str] = None
    message: str


class LoginRequest(BaseModel):
    """Request for password-based login."""

    username: str
    password: str


class PublicInviteGenerateRequest(BaseModel):
    """Request to generate invite token with admin password (no auth required)."""

    admin_password: str
    expires_seconds: Optional[int] = None


class LoginResponse(BaseModel):
    """Response for password-based login."""

    access_token: str
    token_type: str = "bearer"
    user_id: int
    role: str
    message: str


# ============================================================================
# JWT Utilities
# ============================================================================


def create_access_token(user_id: int, username: str, role: str = "patient") -> str:
    """
    Create a JWT access token for a user.
    
    Args:
        user_id: User's database ID
        username: User's username
        role: User's role (patient or hospital)
        
    Returns:
        Encoded JWT token string
    """
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
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
        Current user's information including UUID.
    """
    return {
        "id": current_user["id"],
        "uuid": current_user.get("uuid"),
        "username": current_user["username"],
        "email": current_user.get("email", ""),
        "role": current_user.get("role", "patient"),
        "public_key": current_user.get("public_key"),
        "created_at": str(current_user.get("created_at", "")),
    }


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


# ============================================================================
# New Role-Based Registration Routes
# ============================================================================


@router.post("/register-v2", response_model=RegisterV2Response)
async def register_v2(
    request: RegisterV2Request,
    x_master_secret: Optional[str] = Header(None, alias="X-MASTER-SECRET"),
):
    """
    Register a new user with role-based logic.
    
    For hospitals:
        - Requires X-MASTER-SECRET header matching MASTER_HOSPITAL_SECRET env var
        - Creates hospital account with hashed password
        - Returns hospital_id (UUID)
    
    For patients:
        - Can register with or without invite_token
        - If invite_token provided, validates it first
        - Creates patient account with hashed password
        - Returns patient_id (UUID) and marks needs_profile_upload=True
    
    Args:
        request: Registration request with role, username, password
        x_master_secret: Master secret header for hospital registration
        
    Returns:
        User ID, role, and JWT token
        
    Raises:
        HTTPException 400: Invalid input
        HTTPException 403: Invalid master secret for hospital
        HTTPException 409: Username/email already exists
    """
    # Validate role
    if request.role not in ["patient", "hospital"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be 'patient' or 'hospital'",
        )
    
    # Password strength validation
    password = request.password
    password_errors = []
    
    if len(password) < 8:
        password_errors.append("Password must be at least 8 characters long")
    if not any(c.isupper() for c in password):
        password_errors.append("Password must contain at least one uppercase letter")
    if not any(c.islower() for c in password):
        password_errors.append("Password must contain at least one lowercase letter")
    if not any(c.isdigit() for c in password):
        password_errors.append("Password must contain at least one number")
    if not any(c in "!@#$%^&*()_+-=[]{}|;':\",./<>?" for c in password):
        password_errors.append("Password must contain at least one special character (!@#$%^&*...)")
    
    if password_errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="; ".join(password_errors),
        )
    
    # Check if username already exists
    existing_user = await get_user_by_username(request.username)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )
    
    # Check if email already exists (if provided)
    if request.email:
        existing_email = await get_user_by_email(request.email)
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already exists",
            )
    
    # Hospital registration - requires BOTH invite token AND master secret
    if request.role == "hospital":
        # Verify invite token first
        if not request.invite_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invite token is required for hospital registration",
            )
        
        token_record = await validate_hospital_invite_token(request.invite_token)
        if not token_record:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired invite token",
            )
        
        # Verify master secret
        master_secret = os.getenv("MASTER_HOSPITAL_SECRET")
        if not master_secret:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="MASTER_HOSPITAL_SECRET not configured on server",
            )
        
        if not x_master_secret or x_master_secret != master_secret:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid master secret for hospital registration",
            )
        
        # Hash password with Argon2
        password_hash = ph.hash(request.password)
        
        # Generate hospital UUID
        hospital_uuid = str(uuid.uuid4())
        
        email = request.email or f"{request.username}@hospital.cipherhealth.local"
        
        try:
            user_id = await create_user_with_password(
                username=request.username,
                email=email,
                password_hash=password_hash,
                role="hospital",
                needs_profile_upload=False,
            )
            
            # Mark invite token as used
            await use_hospital_invite_token(request.invite_token, user_id)
            
            access_token = create_access_token(user_id, request.username, "hospital")
            
            return RegisterV2Response(
                user_id=user_id,
                role="hospital",
                hospital_id=hospital_uuid,
                access_token=access_token,
                message="Hospital registered successfully",
            )
            
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to register hospital: {str(e)}",
            )
    
    # Patient registration
    else:
        # Invite token is REQUIRED for patient registration
        if not request.invite_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invite token is required for patient registration",
            )
        
        token_record = await validate_hospital_invite_token(request.invite_token)
        if not token_record:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired invite token",
            )
        
        # Hash password with Argon2
        password_hash = ph.hash(request.password)
        
        # Generate patient UUID
        patient_uuid = str(uuid.uuid4())
        
        email = request.email or f"{request.username}@patient.cipherhealth.local"
        
        try:
            user_id = await create_user_with_password(
                username=request.username,
                email=email,
                password_hash=password_hash,
                role="patient",
                public_key=None,  # Placeholder until patient registers key
                needs_profile_upload=True,
            )
            
            # Mark invite token as used (always required now)
            await use_hospital_invite_token(request.invite_token, user_id)
            
            access_token = create_access_token(user_id, request.username, "patient")
            
            return RegisterV2Response(
                user_id=user_id,
                role="patient",
                patient_id=patient_uuid,
                access_token=access_token,
                message="Patient registered successfully. Profile upload required.",
            )
            
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to register patient: {str(e)}",
            )


@router.post("/login-v2", response_model=LoginResponse)
async def login_v2(request: LoginRequest):
    """
    Login with username/UUID and password.
    
    Supports login with either:
    - Username + password
    - UUID + password (for patients sharing their UUID)
    
    Args:
        request: Login request with username (or UUID) and password
        
    Returns:
        JWT token and user info
        
    Raises:
        HTTPException 401: Invalid credentials
    """
    # Try to find user by username first
    user = await get_user_by_username(request.username)
    
    # If not found by username, try by UUID
    if not user:
        user = await get_user_by_uuid(request.username)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username/UUID or password",
        )
    
    # Check if user has a password (legacy users may not)
    if not user.get("password_hash"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password login not available for this account. Use invite code login.",
        )
    
    # Verify password with Argon2
    try:
        ph.verify(user["password_hash"], request.password)
    except VerifyMismatchError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username/UUID or password",
        )
    
    role = user.get("role", "patient")
    access_token = create_access_token(user["id"], user["username"], role)
    
    return LoginResponse(
        access_token=access_token,
        user_id=user["id"],
        role=role,
        message="Login successful",
    )


class VerifyPasswordRequest(BaseModel):
    """Request to verify the current user's password."""
    password: str


class VerifyPasswordResponse(BaseModel):
    """Response for password verification."""
    verified: bool
    message: str


@router.post("/verify-password", response_model=VerifyPasswordResponse)
async def verify_password(
    request: VerifyPasswordRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Verify the current user's password.
    
    This is used for sensitive operations like viewing the encryption passphrase.
    
    Args:
        request: The password to verify
        current_user: Authenticated user
        
    Returns:
        Whether the password is correct
        
    Raises:
        HTTPException 401: No password set for this account
    """
    # Check if user has a password
    if not current_user.get("password_hash"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No password set for this account",
        )
    
    # Verify password with Argon2
    try:
        ph.verify(current_user["password_hash"], request.password)
        return VerifyPasswordResponse(
            verified=True,
            message="Password verified successfully",
        )
    except VerifyMismatchError:
        return VerifyPasswordResponse(
            verified=False,
            message="Incorrect password",
        )


@router.post("/hospital/generate-invite", response_model=GenerateInviteResponse)
async def generate_hospital_invite(
    request: GenerateInviteRequest,
    current_user: dict = Depends(require_current_user),
):
    """
    Generate a single-use invite token for patient registration.
    
    Only hospitals can generate invite tokens.
    
    Args:
        request: Optional expires_seconds
        current_user: Authenticated hospital user
        
    Returns:
        Generated invite token and expiry
        
    Raises:
        HTTPException 403: User is not a hospital
    """
    # Check if user is a hospital
    if current_user.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hospitals can generate invite tokens",
        )
    
    # Generate token
    token = await create_hospital_invite_token(
        hospital_id=current_user["id"],
        expires_seconds=request.expires_seconds,
    )
    
    # Calculate expiry time for response
    default_expiry = int(os.getenv("INVITE_TOKEN_EXPIRY_SECONDS", "3600"))
    expiry_seconds = request.expires_seconds if request.expires_seconds is not None else default_expiry
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expiry_seconds)
    
    return GenerateInviteResponse(
        invite_token=token,
        expires_at=expires_at.isoformat(),
        message="Invite token generated successfully",
    )


@router.get("/hospital/invite-tokens")
async def list_hospital_invite_tokens(
    current_user: dict = Depends(require_current_user),
):
    """
    List all invite tokens created by the current hospital.
    
    Args:
        current_user: Authenticated hospital user
        
    Returns:
        List of invite tokens with their status
        
    Raises:
        HTTPException 403: User is not a hospital
    """
    # Check if user is a hospital
    if current_user.get("role") != "hospital":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only hospitals can view invite tokens",
        )
    
    tokens = await get_hospital_invite_tokens(current_user["id"])
    
    # Add status info to each token
    result = []
    now = datetime.now(timezone.utc)
    for token in tokens:
        token_info = {
            "token": token["token"],
            "created_at": token["created_at"],
            "expires_at": token.get("expires_at"),
            "used": token.get("used_by") is not None,
            "used_at": token.get("used_at"),
        }
        
        # Check if expired
        if token.get("expires_at"):
            try:
                expires_at = datetime.fromisoformat(
                    token["expires_at"].replace("Z", "+00:00")
                )
                token_info["expired"] = expires_at < now
            except (ValueError, TypeError):
                token_info["expired"] = False
        else:
            token_info["expired"] = False
        
        result.append(token_info)
    
    return {"tokens": result}


@router.post("/use-invite", response_model=UseInviteResponse)
async def use_invite(request: UseInviteRequest):
    """
    Validate a hospital invite token for patient signup.
    
    This endpoint checks if an invite token is valid (unused and not expired)
    without marking it as used. The token is marked as used during registration.
    
    Args:
        request: Invite token to validate
        
    Returns:
        Validation result with hospital info if valid
    """
    token_record = await validate_hospital_invite_token(request.invite_token)
    
    if not token_record:
        return UseInviteResponse(
            valid=False,
            message="Invalid, expired, or already used invite token",
        )
    
    return UseInviteResponse(
        valid=True,
        hospital_id=token_record["hospital_id"],
        expires_at=token_record.get("expires_at"),
        message="Invite token is valid. Proceed with patient registration.",
    )


# Public invite generation - no auth, just admin password


@router.post("/public/generate-invite", response_model=GenerateInviteResponse)
async def generate_invite_public(request: PublicInviteGenerateRequest):
    """
    Generate an invite token without authentication - requires admin password.
    
    This endpoint allows generating invite tokens for a "system" hospital account
    without requiring login. Useful for initial setup or admin-level token generation.
    
    Args:
        request: Contains admin_password and optional expires_seconds
        
    Returns:
        Generated invite token and expiry
        
    Raises:
        HTTPException 403: Invalid admin password
    """
    # Read password at runtime to pick up .env changes
    admin_invite_password = os.getenv("ADMIN_INVITE_PASSWORD")
    if not admin_invite_password:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ADMIN_INVITE_PASSWORD not configured on server",
        )
    
    if request.admin_password != admin_invite_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin password",
        )
    
    # Use a "system" hospital ID (0) for public invites
    SYSTEM_HOSPITAL_ID = 0
    
    # Generate token
    token = await create_hospital_invite_token(
        hospital_id=SYSTEM_HOSPITAL_ID,
        expires_seconds=request.expires_seconds,
    )
    
    # Calculate expiry time for response
    default_expiry = int(os.getenv("INVITE_TOKEN_EXPIRY_SECONDS", "3600"))
    expiry_seconds = request.expires_seconds if request.expires_seconds is not None else default_expiry
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expiry_seconds)
    
    return GenerateInviteResponse(
        invite_token=token,
        expires_at=expires_at.isoformat(),
        message="Invite token generated successfully",
    )


# ============================================================================
# Self-Test (run with: python -m app.routes.auth)
# ============================================================================

if __name__ == "__main__":
    """
    Unit tests for authentication routes.
    
    Run with:
        cd backend
        python -m app.routes.auth
    
    Requires MASTER_HOSPITAL_SECRET to be set in environment or .env file.
    """
    import asyncio
    import sys
    
    from dotenv import load_dotenv
    
    # Load environment variables
    load_dotenv()
    
    async def run_tests():
        """Run authentication unit tests."""
        print("=" * 60)
        print("Authentication Routes - Unit Tests")
        print("=" * 60)
        
        # Import db functions
        from app.db import init_db
        
        # Initialize database
        await init_db()
        
        test_passed = True
        
        # Test 1: Check MASTER_HOSPITAL_SECRET is set
        print("\n[Test 1] Checking MASTER_HOSPITAL_SECRET...")
        master_secret = os.getenv("MASTER_HOSPITAL_SECRET")
        if not master_secret:
            print("  ERROR: MASTER_HOSPITAL_SECRET not set in environment")
            print("  Please add MASTER_HOSPITAL_SECRET to your .env file")
            test_passed = False
        else:
            print(f"  OK: MASTER_HOSPITAL_SECRET is configured (length: {len(master_secret)})")
        
        # Test 2: Test password hashing
        print("\n[Test 2] Testing Argon2 password hashing...")
        try:
            test_password = "test-password-123"
            hashed = ph.hash(test_password)
            ph.verify(hashed, test_password)
            print("  OK: Password hashing and verification works")
        except Exception as e:
            print(f"  ERROR: Password hashing failed: {e}")
            test_passed = False
        
        # Test 3: Test JWT token creation
        print("\n[Test 3] Testing JWT token creation...")
        try:
            token = create_access_token(1, "test_hospital", "hospital")
            decoded = decode_token(token)
            assert decoded.sub == "1"
            assert decoded.username == "test_hospital"
            print("  OK: JWT token creation and decoding works")
        except Exception as e:
            print(f"  ERROR: JWT token test failed: {e}")
            test_passed = False
        
        # Test 4: Test hospital invite token creation
        print("\n[Test 4] Testing hospital invite token creation...")
        try:
            # Create a test hospital user first
            test_hospital_username = f"test_hospital_{secrets.token_hex(4)}"
            test_hospital_email = f"{test_hospital_username}@test.local"
            test_password_hash = ph.hash("test-password")
            
            hospital_id = await create_user_with_password(
                username=test_hospital_username,
                email=test_hospital_email,
                password_hash=test_password_hash,
                role="hospital",
            )
            print(f"  Created test hospital user ID: {hospital_id}")
            
            # Generate invite token
            invite_token = await create_hospital_invite_token(hospital_id)
            if invite_token and len(invite_token) > 0:
                print(f"  OK: Generated invite token (length: {len(invite_token)})")
            else:
                print("  ERROR: Invite token is empty")
                test_passed = False
            
            # Validate token
            token_record = await validate_hospital_invite_token(invite_token)
            if token_record:
                print("  OK: Invite token validated successfully")
            else:
                print("  ERROR: Failed to validate invite token")
                test_passed = False
            
        except Exception as e:
            print(f"  ERROR: Invite token test failed: {e}")
            test_passed = False
        
        # Print final result
        print("\n" + "=" * 60)
        if test_passed:
            print("AUTH OK")
            print("All tests passed!")
        else:
            print("AUTH FAILED")
            print("Some tests failed. Check the output above.")
        print("=" * 60)
        
        return test_passed
    
    # Run tests
    success = asyncio.run(run_tests())
    sys.exit(0 if success else 1)
