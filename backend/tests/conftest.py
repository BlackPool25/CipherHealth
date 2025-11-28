"""
Pytest configuration and fixtures.
"""

import asyncio
import os
import sys
from pathlib import Path

import pytest

# Add backend to path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

# Set test environment
os.environ.setdefault("DEV_MODE", "true")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_decent_hospital.db")
os.environ.setdefault("JWT_SECRET", "test-secret-for-testing-only")


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session", autouse=True)
async def setup_database():
    """Initialize test database."""
    from app.db import init_db
    await init_db()
    yield
    # Cleanup: remove test database
    test_db = Path("test_decent_hospital.db")
    if test_db.exists():
        test_db.unlink()
