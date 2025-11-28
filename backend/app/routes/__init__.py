"""
Routes package initialization.

Available routers:
- auth: Authentication endpoints (seed-login, register)
- upload: File upload and encryption
- grants: Access grants and re-encryption
- audit: Audit trail from database and blockchain
"""

from app.routes import auth, grants, upload, audit

__all__ = ["auth", "grants", "upload", "audit"]
