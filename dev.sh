#!/usr/bin/env bash

set -e

echo "============================================"
echo "  Decent-Hospital Development Server"
echo "============================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo ""
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo ""
    echo "============================================"
    echo "  ACTION REQUIRED: Edit .env file"
    echo "============================================"
    echo ""
    echo "Please open .env and replace the following placeholders with your real values:"
    echo ""
    echo "  SEPOLIA_RPC_URL        → Your Sepolia RPC endpoint (Infura/Alchemy)"
    echo "  DEPLOYER_PRIVATE_KEY   → Your wallet private key (0x...)"
    echo "  WEB3_STORAGE_TOKEN     → Your web3.storage or Storacha API token"
    echo "  FASTAPI_SECRET_KEY     → Generate with: openssl rand -hex 32"
    echo ""
    echo "For Umbral keys, create PEM files in ./secrets/ directory."
    echo ""
    echo "After editing .env, run this script again: ./dev.sh"
    exit 1
fi

# Export environment variables from .env
echo "Loading environment variables from .env..."
set -a
source .env
set +a

echo "Starting development servers..."
echo "  → Backend:  http://localhost:8000"
echo "  → Frontend: http://localhost:3000"
echo ""

npm run dev
