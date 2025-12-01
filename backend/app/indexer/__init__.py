"""
Indexer module for blockchain event processing.

This module provides:
- Alchemy webhook handler for real-time event indexing
- Event parsing and audit log writing
"""

from app.indexer.alchemy_webhook_handler import router as webhook_router

__all__ = ["webhook_router"]
