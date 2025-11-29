#!/bin/bash
# Test script to verify Storacha upload integration

set -e

API_BASE="http://localhost:8000"

echo "=== Testing Decent-Hospital Upload Flow ==="
echo ""

# Step 1: Seed an invite code
echo "1. Creating invite code..."
INVITE_RESPONSE=$(curl -s -X POST "$API_BASE/auth/seed-invite" \
  -H "Content-Type: application/json" \
  -d '{}')
echo "   Response: $INVITE_RESPONSE"
INVITE_CODE=$(echo "$INVITE_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['code'])")
echo "   Invite code: $INVITE_CODE"
echo ""

# Step 2: Register a test user with an Umbral public key
# Generate a proper Umbral key pair first
echo "2. Generating Umbral key pair..."
KEY_PAIR=$(python3 -c "
from umbral import SecretKey
sk = SecretKey.random()
pk = sk.public_key()
print(f'{sk.to_be_bytes().hex()}|{pk.to_compressed_bytes().hex()}')
")
SECRET_KEY=$(echo "$KEY_PAIR" | cut -d'|' -f1)
PUBLIC_KEY=$(echo "$KEY_PAIR" | cut -d'|' -f2)
echo "   Secret key: $SECRET_KEY (SAVE THIS FOR DECRYPTION)"
echo "   Public key: $PUBLIC_KEY"
echo ""

echo "3. Registering user..."
REGISTER_RESPONSE=$(curl -s -X POST "$API_BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"testuser_$(date +%s)\",
    \"email\": \"test_$(date +%s)@example.com\",
    \"invite_code\": \"$INVITE_CODE\",
    \"public_key\": \"$PUBLIC_KEY\"
  }")
echo "   Response: $REGISTER_RESPONSE"
USER_ID=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['user']['id'])")
TOKEN=$(echo "$REGISTER_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
echo "   User ID: $USER_ID"
echo "   Token: ${TOKEN:0:50}..."
echo ""

# Step 3: Create a test file
echo "4. Creating test file..."
TEST_FILE="/tmp/test_medical_record_$(date +%s).txt"
echo "Patient Name: Test Patient" > "$TEST_FILE"
echo "Diagnosis: Healthy" >> "$TEST_FILE"
echo "Date: $(date)" >> "$TEST_FILE"
echo "This is confidential medical data that should be encrypted." >> "$TEST_FILE"
echo "   Created: $TEST_FILE"
echo "   Content: $(cat $TEST_FILE)"
echo ""

# Step 4: Upload the file
echo "5. Uploading file to Storacha..."
UPLOAD_RESPONSE=$(curl -s -X POST "$API_BASE/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$TEST_FILE" \
  -F "patient_id=$USER_ID" \
  -F "owner_public_key=$PUBLIC_KEY")
echo "   Response: $UPLOAD_RESPONSE"
echo ""

# Parse the response
CID=$(echo "$UPLOAD_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('cid', 'N/A'))" 2>/dev/null || echo "N/A")
FILE_ID=$(echo "$UPLOAD_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('file_id', 'N/A'))" 2>/dev/null || echo "N/A")
CAPSULE=$(echo "$UPLOAD_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('capsule', 'N/A'))" 2>/dev/null || echo "N/A")

echo "   CID: $CID"
echo "   File ID: $FILE_ID"
echo "   Capsule: ${CAPSULE:0:100}..."
echo ""

if [ "$CID" = "N/A" ] || [ "$CID" = "" ]; then
    echo "ERROR: Upload failed!"
    exit 1
fi

# Step 5: Verify ciphertext (download from Storacha gateway)
echo "6. Verifying ciphertext on Storacha..."
GATEWAY_URL="https://${CID}.ipfs.storacha.link"
echo "   Gateway URL: $GATEWAY_URL"

# Download the raw content
RAW_CONTENT=$(curl -s "$GATEWAY_URL" 2>/dev/null | head -c 200)
echo "   Raw content (first 200 bytes): $RAW_CONTENT"

# Check if content is NOT plaintext (should be binary/encrypted)
if echo "$RAW_CONTENT" | grep -q "Patient Name"; then
    echo "   WARNING: Content appears to be PLAINTEXT! Encryption may have failed."
else
    echo "   SUCCESS: Content appears to be encrypted (binary data)"
fi
echo ""

# Step 6: Try to download and decrypt via the API
echo "7. Downloading and decrypting via API..."
DOWNLOAD_RESPONSE=$(curl -s -X POST "$API_BASE/upload/download" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"cid\": \"$CID\",
    \"user_private_key\": \"$SECRET_KEY\"
  }")
echo "   Response: $DOWNLOAD_RESPONSE"
echo ""

echo "=== Summary ==="
echo "Secret Key (save for decryption): $SECRET_KEY"
echo "Public Key: $PUBLIC_KEY"
echo "User ID: $USER_ID"
echo "File ID: $FILE_ID"
echo "CID: $CID"
echo "Capsule: ${CAPSULE:0:100}..."
echo ""
echo "To view on gateway: $GATEWAY_URL"
echo ""

# Cleanup
rm -f "$TEST_FILE"
