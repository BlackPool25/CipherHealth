"""
Decent-Hospital Backend - FastAPI Application Entry Point

This module initializes the FastAPI application with CORS middleware
and includes all route modules.
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.routes import auth, grants, upload, audit, access, revoke, patients

# Load environment variables from .env file
# Check multiple locations: current dir, parent dir, workspace root
env_locations = [
    Path(".env"),
    Path("../.env"),
    Path(__file__).parent.parent.parent / ".env",  # workspace root
]

for env_path in env_locations:
    if env_path.exists():
        load_dotenv(env_path)
        break
else:
    # Try default load_dotenv which checks CWD
    load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler.
    Initializes database on startup.
    """
    # Startup: Initialize the database
    await init_db()
    yield
    # Shutdown: Cleanup if needed
    pass


# Create FastAPI application instance
app = FastAPI(
    title="Decent-Hospital API",
    description="Decentralized hospital data management with Umbral Proxy Re-Encryption",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure CORS middleware
# Allow frontend running on localhost:3000
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include route modules
app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(upload.router, prefix="/upload", tags=["Upload"])
app.include_router(grants.router, prefix="/grant", tags=["Grants"])
app.include_router(revoke.router, prefix="/revoke", tags=["Revocation"])
app.include_router(audit.router, prefix="/audit", tags=["Audit"])
app.include_router(access.router, prefix="/access", tags=["Access Management"])
app.include_router(patients.router, prefix="/patients", tags=["Patient Management"])


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "decent-hospital-backend"}


@app.get("/health")
async def health_check():
    """Detailed health check endpoint."""
    return {
        "status": "healthy",
        "version": "0.1.0",
        "dev_mode": os.getenv("DEV_MODE", "false").lower() == "true",
    }


@app.get("/debug/storacha")
async def debug_storacha():
    """Debug endpoint to check Storacha CLI status."""
    import subprocess
    
    results = {}
    
    # Check PATH
    results["path"] = os.environ.get("PATH", "not set")[:200] + "..."
    results["home"] = os.environ.get("HOME", "not set")
    
    # Create clean environment without STORACHA_PRINCIPAL
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith("STORACHA_PRINCIPAL")}
    results["storacha_principal_filtered"] = "STORACHA_PRINCIPAL" not in clean_env
    
    # Check which storacha
    try:
        which = subprocess.run(["which", "storacha"], capture_output=True, text=True, timeout=5, env=clean_env)
        results["which_storacha"] = which.stdout.strip() if which.returncode == 0 else f"not found: {which.stderr}"
    except Exception as e:
        results["which_storacha"] = f"error: {e}"
    
    # Check whoami
    try:
        whoami = subprocess.run(["storacha", "whoami"], capture_output=True, text=True, timeout=10, env=clean_env)
        results["whoami_returncode"] = whoami.returncode
        results["whoami_stdout"] = whoami.stdout.strip()
        results["whoami_stderr"] = whoami.stderr.strip()[:200] if whoami.stderr else ""
    except Exception as e:
        results["whoami_error"] = str(e)
    
    # Check space ls
    try:
        space_ls = subprocess.run(["storacha", "space", "ls"], capture_output=True, text=True, timeout=10, env=clean_env)
        results["space_ls_returncode"] = space_ls.returncode
        results["space_ls_stdout"] = space_ls.stdout.strip()
        results["space_ls_stderr"] = space_ls.stderr.strip()[:200] if space_ls.stderr else ""
    except Exception as e:
        results["space_ls_error"] = str(e)
    
    # Check config file
    config_path = os.path.expanduser("~/.config/w3access/storacha-cli.json")
    results["config_exists"] = os.path.exists(config_path)
    
    return results


@app.get("/debug/chain-status")
async def debug_chain_status():
    """Debug endpoint to check chain configuration status."""
    try:
        from app.utils.chain import get_chain_status
        return get_chain_status()
    except Exception as e:
        return {"error": str(e), "fully_configured": False}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
