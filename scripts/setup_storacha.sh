#!/bin/bash
# ============================================================================
# Storacha Setup Script for Decent-Hospital
# ============================================================================
# 
# This script helps you set up Storacha (IPFS storage) for the backend.
# 
# Prerequisites:
# 1. Node.js and npm installed
# 2. Storacha CLI installed: npm install -g @storacha/cli
#
# Reference: https://docs.storacha.network/how-to/ci/
# ============================================================================

set -e

echo "========================================"
echo "  Storacha Setup for Decent-Hospital"
echo "========================================"
echo ""

# Check if storacha CLI is installed
if ! command -v storacha &> /dev/null; then
    echo "ERROR: storacha CLI is not installed."
    echo "Install it with: npm install -g @storacha/cli"
    exit 1
fi

echo "Storacha CLI version: $(storacha --version)"
echo ""

# Step 1: Check login status
echo "Step 1: Checking login status..."
if storacha account ls 2>&1 | grep -q "Agent has not been authorized"; then
    echo ""
    echo "⚠️  You need to log in to Storacha first."
    echo ""
    echo "Run one of the following commands:"
    echo "  1. Email login: storacha login your-email@example.com"
    echo "  2. GitHub login: storacha login --github"
    echo ""
    echo "After running the login command, check your email or GitHub for verification."
    echo "Then re-run this script."
    exit 1
fi

echo "✅ Already logged in."
echo ""

# Step 2: Check/Create space
echo "Step 2: Checking spaces..."
SPACES=$(storacha space ls 2>&1)
if [ -z "$SPACES" ] || ! echo "$SPACES" | grep -q "did:"; then
    echo ""
    echo "⚠️  No space found. Creating a new space..."
    storacha space create Decent-Hospital-Storage
    echo "✅ Space created."
else
    echo "Available spaces:"
    echo "$SPACES"
fi

# Get current space
CURRENT_SPACE=$(storacha space ls 2>&1 | grep '^\*' | awk '{print $2}')
if [ -z "$CURRENT_SPACE" ]; then
    # No current space, select one
    echo ""
    echo "⚠️  No space selected. Selecting the first available space..."
    FIRST_SPACE=$(storacha space ls 2>&1 | grep 'did:' | head -1 | awk '{print $1}')
    if [ -n "$FIRST_SPACE" ]; then
        storacha space use "$FIRST_SPACE"
        CURRENT_SPACE="$FIRST_SPACE"
    fi
fi
echo ""
echo "Current space: $CURRENT_SPACE"
echo ""

# Step 3: Generate signing key for backend
echo "Step 3: Generating signing key for backend..."
KEY_JSON=$(storacha key create --json)
KEY_DID=$(echo "$KEY_JSON" | grep -oP '"did"\s*:\s*"\K[^"]+')
KEY_SECRET=$(echo "$KEY_JSON" | grep -oP '"key"\s*:\s*"\K[^"]+' | tr -d '\n ')

echo "Generated DID: $KEY_DID"
echo ""

# Step 4: Create delegation proof
echo "Step 4: Creating delegation proof..."
PROOF=$(storacha delegation create "$KEY_DID" \
    -c space/blob/add \
    -c space/index/add \
    -c upload/add \
    -c filecoin/offer \
    --base64)

echo ""
echo "========================================"
echo "  Setup Complete! "
echo "========================================"
echo ""
echo "Add these values to your backend/.env file:"
echo ""
echo "STORACHA_PRINCIPAL=$KEY_SECRET"
echo ""
echo "STORACHA_PROOF=$PROOF"
echo ""
echo "========================================"
echo ""

# Optionally update the .env file
read -p "Would you like to update backend/.env automatically? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    ENV_FILE="$(dirname "$0")/../backend/.env"
    if [ -f "$ENV_FILE" ]; then
        # Update STORACHA_PRINCIPAL
        sed -i "s|^STORACHA_PRINCIPAL=.*|STORACHA_PRINCIPAL=$KEY_SECRET|" "$ENV_FILE"
        # Update STORACHA_PROOF
        sed -i "s|^STORACHA_PROOF=.*|STORACHA_PROOF=$PROOF|" "$ENV_FILE"
        echo "✅ backend/.env updated successfully!"
    else
        echo "ERROR: $ENV_FILE not found."
        exit 1
    fi
fi

echo ""
echo "Next steps:"
echo "1. Restart the backend server: cd backend && python -m uvicorn app.main:app --reload"
echo "2. Test upload: python scripts/test_storage.py"
echo ""
