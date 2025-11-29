#!/usr/bin/env bash
# ============================================================================
# test_revoke.sh - Revocation Demo Script
# ============================================================================
#
# This script demonstrates the revocation workflow for Decent-Hospital.
# It tests both the recommended client-side path and the server-assisted path.
#
# ⚠️  SECURITY WARNING ⚠️
# ═══════════════════════════════════════════════════════════════════════════
# The server-assisted revocation mode (Option 2) is for DEMO PURPOSES ONLY.
# It temporarily exposes plaintext data on the server, which violates the
# zero-knowledge principle of the system.
#
# In production, ALWAYS use client-side rotation (Option 1):
# - Patient downloads encrypted file
# - Decrypts locally in browser
# - Re-encrypts with new CEK
# - Uploads new ciphertext
# ═══════════════════════════════════════════════════════════════════════════
#
# Prerequisites:
# - Backend running at http://localhost:8000
# - User registered and authenticated (JWT token)
# - At least one file uploaded
#
# Environment Variables:
# - API_URL: Backend URL (default: http://localhost:8000)
# - JWT_TOKEN: User's JWT token for authentication
# - FILE_CID: CID of file to revoke (or will prompt)
#
# Usage:
#   ./scripts/test_revoke.sh
#
# References:
# - pyUmbral docs: https://pyumbral.readthedocs.io/
# - Storacha docs: https://docs.storacha.network/
# - Sepolia docs: https://sepolia.etherscan.io/
#
# ============================================================================

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

API_URL="${API_URL:-http://localhost:8000}"
JWT_TOKEN="${JWT_TOKEN:-}"
FILE_CID="${FILE_CID:-}"
OPERATOR_PASSPHRASE="${OPERATOR_PASSPHRASE:-I_UNDERSTAND_THE_RISKS}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}\n"
}

print_warning() {
    echo -e "${YELLOW}⚠️  WARNING: $1${NC}"
}

print_error() {
    echo -e "${RED}❌ ERROR: $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

check_prerequisites() {
    print_header "Checking Prerequisites"
    
    # Check if curl is installed
    if ! command -v curl &> /dev/null; then
        print_error "curl is required but not installed"
        exit 1
    fi
    print_success "curl is installed"
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed - output will not be formatted"
    else
        print_success "jq is installed"
    fi
    
    # Check backend is running
    if ! curl -s "$API_URL/health" > /dev/null 2>&1; then
        print_error "Backend not reachable at $API_URL"
        echo "Please start the backend with: cd backend && ./run.sh"
        exit 1
    fi
    print_success "Backend is running at $API_URL"
    
    # Check JWT token
    if [ -z "$JWT_TOKEN" ]; then
        echo ""
        echo "JWT_TOKEN not set. Please provide your authentication token."
        echo "You can get this from the browser after logging in (localStorage -> jwt_token)"
        echo ""
        read -p "Enter JWT token: " JWT_TOKEN
        if [ -z "$JWT_TOKEN" ]; then
            print_error "JWT token is required"
            exit 1
        fi
    fi
    print_success "JWT token provided"
}

get_user_files() {
    print_header "Getting User's Files"
    
    response=$(curl -s -X GET "$API_URL/auth/me" \
        -H "Authorization: Bearer $JWT_TOKEN" \
        -H "Content-Type: application/json")
    
    user_id=$(echo "$response" | jq -r '.id // empty')
    if [ -z "$user_id" ]; then
        print_error "Failed to get user info. Is the token valid?"
        echo "$response"
        exit 1
    fi
    print_success "User ID: $user_id"
    
    files_response=$(curl -s -X GET "$API_URL/access/records/$user_id" \
        -H "Authorization: Bearer $JWT_TOKEN")
    
    echo "$files_response" | jq '.records[] | {id, cid, filename}' 2>/dev/null || echo "$files_response"
}

# ============================================================================
# Option 1: Client-Side Revocation (Recommended)
# ============================================================================

test_client_side_revoke() {
    print_header "Option 1: Client-Side Revocation (RECOMMENDED)"
    
    echo "This is the recommended approach:"
    echo "1. Revoke grants in database and on-chain"
    echo "2. Client downloads encrypted file"
    echo "3. Client decrypts locally with private key"
    echo "4. Client generates new CEK and re-encrypts"
    echo "5. Client uploads new ciphertext"
    echo ""
    
    if [ -z "$FILE_CID" ]; then
        echo "Enter the CID of the file to revoke:"
        read -p "CID: " FILE_CID
    fi
    
    if [ -z "$FILE_CID" ]; then
        print_error "CID is required"
        return 1
    fi
    
    echo ""
    echo "Step 1: Revoking access grants..."
    
    revoke_response=$(curl -s -X POST "$API_URL/revoke" \
        -H "Authorization: Bearer $JWT_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"cid\": \"$FILE_CID\"}")
    
    echo "$revoke_response" | jq '.' 2>/dev/null || echo "$revoke_response"
    
    revoked=$(echo "$revoke_response" | jq -r '.revoked // false')
    revoke_tx=$(echo "$revoke_response" | jq -r '.revoke_tx // "none"')
    
    if [ "$revoked" = "true" ]; then
        print_success "Grants revoked successfully!"
        if [ "$revoke_tx" != "none" ] && [ "$revoke_tx" != "null" ]; then
            echo "  On-chain tx: https://sepolia.etherscan.io/tx/$revoke_tx"
        fi
    else
        print_error "Failed to revoke grants"
        return 1
    fi
    
    echo ""
    echo "Step 2: Preparing for rotation..."
    
    prepare_response=$(curl -s -X POST "$API_URL/revoke/rotate-prepare" \
        -H "Authorization: Bearer $JWT_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"cid\": \"$FILE_CID\"}")
    
    echo "$prepare_response" | jq '.' 2>/dev/null || echo "$prepare_response"
    
    echo ""
    print_warning "Next steps would be done in the browser:"
    echo "  1. Download encrypted blob from Storacha using the CID"
    echo "  2. Decrypt using your Umbral private key"
    echo "  3. Generate new CEK (AES-256 key)"
    echo "  4. Re-encrypt with new CEK"
    echo "  5. Encapsulate new CEK with your Umbral public key"
    echo "  6. Call /revoke/rotate-complete with new ciphertext"
    echo ""
    echo "Use the UI at http://localhost:3000/revoke for a guided experience."
}

# ============================================================================
# Option 2: Server-Assisted Revocation (DEMO ONLY)
# ============================================================================

test_server_assisted_revoke() {
    print_header "Option 2: Server-Assisted Revocation (DEMO ONLY)"
    
    echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${RED}⚠️  DANGER: SERVER-ASSISTED MODE ⚠️${NC}"
    echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "This mode is DANGEROUS and should ONLY be used for demos."
    echo ""
    echo "Risks:"
    echo "  - Server temporarily holds plaintext in memory"
    echo "  - Violates zero-knowledge principle"
    echo "  - Operator must explicitly consent"
    echo "  - Not suitable for production"
    echo ""
    echo "In production, ALWAYS use Option 1 (client-side rotation)."
    echo ""
    echo -e "${RED}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    read -p "Do you understand the risks and wish to proceed? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Aborted. Use Option 1 (client-side) instead."
        return 0
    fi
    
    echo ""
    echo "To proceed with server-assisted revocation, you must enter the"
    echo "operator passphrase. The default passphrase is:"
    echo "  I_UNDERSTAND_THE_RISKS"
    echo ""
    echo "This can be changed by setting REVOKE_SERVER_PASSPHRASE env var."
    echo ""
    
    read -p "Enter operator passphrase: " input_passphrase
    
    if [ -z "$FILE_CID" ]; then
        echo "Enter the CID of the file to revoke:"
        read -p "CID: " FILE_CID
    fi
    
    echo ""
    echo "Attempting server-assisted revocation..."
    
    response=$(curl -s -X POST "$API_URL/revoke/server-assisted" \
        -H "Authorization: Bearer $JWT_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"cid\": \"$FILE_CID\",
            \"operator_passphrase\": \"$input_passphrase\"
        }")
    
    echo "$response" | jq '.' 2>/dev/null || echo "$response"
    
    warning=$(echo "$response" | jq -r '.warning // empty')
    if [ -n "$warning" ]; then
        echo ""
        print_warning "$warning"
    fi
}

# ============================================================================
# Main Menu
# ============================================================================

main() {
    print_header "Decent-Hospital Revocation Test Script"
    
    echo "This script demonstrates the revocation and CEK rotation workflow."
    echo ""
    
    check_prerequisites
    
    echo ""
    get_user_files
    
    echo ""
    echo "Choose revocation mode:"
    echo "  1) Client-Side Rotation (RECOMMENDED)"
    echo "  2) Server-Assisted Rotation (DEMO ONLY - DANGEROUS)"
    echo "  3) Exit"
    echo ""
    
    read -p "Enter choice (1-3): " choice
    
    case $choice in
        1)
            test_client_side_revoke
            ;;
        2)
            test_server_assisted_revoke
            ;;
        3)
            echo "Exiting."
            exit 0
            ;;
        *)
            print_error "Invalid choice"
            exit 1
            ;;
    esac
    
    echo ""
    print_success "Test complete!"
}

# Run main
main "$@"
