"""
Decent-Hospital Backend - FastAPI Application Entry Point

This module initializes the FastAPI application with CORS middleware
and includes all route modules.
"""

import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.routes import auth, grants, upload

# Load environment variables from .env file
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
