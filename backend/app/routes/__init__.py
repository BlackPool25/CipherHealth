"""
Routes package initialization.

Available routers:
- auth: Authentication endpoints (seed-login, register)
- upload: File upload and encryption
- grants: Access grants and re-encryption
- revoke: Revocation and CEK rotation
- audit: Audit trail from database and blockchain
- access: Access management
"""

from app.routes import auth, grants, upload, audit, access, revoke

__all__ = ["auth", "grants", "upload", "audit", "access", "revoke"]
