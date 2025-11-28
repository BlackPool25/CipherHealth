#!/usr/bin/env python3
"""
Seed Script for Decent-Hospital Backend

Creates N seeded users with invite codes and generates their Umbral keypairs.
Only PUBLIC KEYS are printed to stdout. Private keys are saved to files.

Usage:
    python scripts/seed.py [--count N]
    
    Or set INVITE_SEED_COUNT environment variable.

Environment Variables:
    INVITE_SEED_COUNT: Number of invite codes to create (default: 10)
    DATABASE_URL: Database path (default: sqlite:///./decent_hospital.db)

Output:
    - Prints invite codes and public keys to stdout
    - Saves summary to backend/seed_output.json
    - Keys stored in backend/keys/user_<n>/ directories
    
SECURITY NOTE:
    - Private keys are NEVER printed to stdout
    - Private keys are saved with 0600 permissions
    - Do NOT commit seed_output.json or keys/ directories
"""

import argparse
import asyncio
import json
import os
import secrets
import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_path))

from dotenv import load_dotenv

# Load environment from backend
load_dotenv(backend_path / ".env")

# Now import backend modules
from app.db import init_db, create_invite_code


def generate_user_keys(user_dir: Path) -> str:
    """
    Generate Umbral keypair for a user.
    
    Args:
        user_dir: Directory to store keys
        
    Returns:
        Public key as hex string
        
    Note:
        Private key is saved to file, NOT returned.
    """
    try:
        from app.utils.umbral_utils import generate_keys, generate_signing_key
        
        # Create user key directory
        user_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate main keypair
        secret_key_path, public_key_hex = generate_keys(str(user_dir))
        
        # Generate signing keypair
        signing_key_path, verifying_key_hex = generate_signing_key(str(user_dir))
        
        return public_key_hex
        
    except ImportError:
        # pyUmbral not installed, generate placeholder
        import hashlib
        placeholder = hashlib.sha256(str(user_dir).encode()).hexdigest()
        return f"placeholder_pk_{placeholder[:32]}"


async def seed_invite_codes(count: int) -> list[dict]:
    """
    Create N invite codes in the database.
    
    Args:
        count: Number of invite codes to create
        
    Returns:
        List of dicts with code and public key info
    """
    # Initialize database
    await init_db()
    
    users = []
    keys_base_dir = backend_path / "keys"
    
    for i in range(count):
        # Generate unique invite code
        code = secrets.token_urlsafe(16)
        
        # Create invite code in database
        await create_invite_code(code)
        
        # Generate keys for this user
        user_key_dir = keys_base_dir / f"user_{i + 1}"
        public_key = generate_user_keys(user_key_dir)
        
        user_info = {
            "user_number": i + 1,
            "invite_code": code,
            "public_key": public_key,
            "key_directory": str(user_key_dir),
        }
        users.append(user_info)
        
        # Print to stdout (NO private keys!)
        print(f"User {i + 1}:")
        print(f"  Invite Code: {code}")
        print(f"  Public Key:  {public_key}")
        print(f"  Keys Dir:    {user_key_dir}")
        print()
    
    return users


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Seed invite codes and generate user keypairs"
    )
    parser.add_argument(
        "--count",
        "-n",
        type=int,
        default=int(os.getenv("INVITE_SEED_COUNT", "10")),
        help="Number of invite codes to create (default: from INVITE_SEED_COUNT or 10)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=str(backend_path / "seed_output.json"),
        help="Output file for seed data (default: backend/seed_output.json)",
    )
    args = parser.parse_args()
    
    print("=" * 60)
    print("Decent-Hospital Seed Script")
    print("=" * 60)
    print(f"Creating {args.count} invite codes and keypairs...")
    print()
    
    # Run async seed function
    users = asyncio.run(seed_invite_codes(args.count))
    
    # Save summary to file (without private keys)
    output_data = {
        "created_at": __import__("datetime").datetime.now().isoformat(),
        "count": len(users),
        "users": users,
        "note": "Private keys are stored in key_directory, NOT in this file",
    }
    
    with open(args.output, "w") as f:
        json.dump(output_data, f, indent=2)
    
    print("=" * 60)
    print(f"Created {len(users)} invite codes")
    print(f"Summary saved to: {args.output}")
    print()
    print("SECURITY REMINDER:")
    print("  - Private keys are in backend/keys/user_N/")
    print("  - Do NOT commit keys or seed_output.json to git")
    print("  - Keys are set with 0600 permissions")
    print("=" * 60)


if __name__ == "__main__":
    main()
