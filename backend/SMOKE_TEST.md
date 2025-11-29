# Decent-Hospital Backend - Smoke Test Guide

## Prerequisites

Before running the smoke test, ensure:

1. **Backend is running** on `http://localhost:8000`
2. **Environment variables are set** in `.env`:
   - `STORACHA_PRINCIPAL` - Storacha signing key
   - `STORACHA_PROOF` - Storacha delegation proof  
   - `SEPOLIA_RPC_URL` - Ethereum Sepolia RPC endpoint
   - `HEALTH_RECORDS_CONTRACT_ADDRESS` - Deployed contract address
   - `SIGNER_PRIVATE_KEY` - Funded Sepolia wallet private key
   - `JWT_SECRET` - JWT signing secret

3. **Sepolia testnet ETH** in signer wallet (get from https://sepoliafaucet.com/)

## Manual 6-Step Smoke Test

### Step 1: Health Check

Verify the backend is running:

```bash
curl -X GET http://localhost:8000/health
```

**Expected output:**
```json
{"status": "healthy", "version": "0.1.0", "dev_mode": false}
```

---

### Step 2: Create Test Users and Get JWT Token

First, seed an invite code (dev mode):

```bash
curl -X POST http://localhost:8000/auth/seed-invite \
  -H "Content-Type: application/json"
```

Then register a patient (owner):

```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "patient_alice",
    "email": "alice@hospital.test",
    "invite_code": "<code_from_above>",
    "public_key": "04a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1"
  }'
```

Save the `access_token` from the response as `OWNER_TOKEN`.

Register a doctor (requester):

```bash
curl -X POST http://localhost:8000/auth/seed-invite \
  -H "Content-Type: application/json"

curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "doctor_bob",
    "email": "bob@hospital.test",
    "invite_code": "<new_code>",
    "public_key": "04fedcba9876543210fedcba9876543210fedcba9876543210fedcba987654321"
  }'
```

Save the `access_token` as `REQUESTER_TOKEN`.

---

### Step 3: Upload a File (Owner)

Upload a test file:

```bash
curl -X POST http://localhost:8000/upload \
  -F "file=@/path/to/test_file.pdf" \
  -F "patient_id=<owner_user_id>" \
  -F "owner_public_key=04a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1"
```

**Expected output:**
```json
{
  "cid": "bafybeig...",
  "file_id": 1,
  "filename": "test_file.pdf",
  "encrypted_cek": "<hex_string>",
  "capsule": "<hex_string>",
  "message": "File encrypted and uploaded successfully"
}
```

Save the `cid` for the next steps.

---

### Step 4: Request Access (Requester/Doctor)

The doctor requests access to the patient's file:

```bash
curl -X POST http://localhost:8000/access/request-access \
  -H "Content-Type: application/json" \
  -d '{
    "cid": "<cid_from_step_3>",
    "requester_pubkey": "04fedcba9876543210fedcba9876543210fedcba9876543210fedcba987654321",
    "purpose": "Medical consultation - reviewing patient history"
  }'
```

**Expected output:**
```json
{
  "request_id": 1,
  "status": "pending"
}
```

Save the `request_id`.

---

### Step 5: Approve Access (Owner/Patient)

The patient approves the doctor's request:

```bash
curl -X POST http://localhost:8000/access/approve-access \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": <request_id_from_step_4>,
    "expiry_seconds": 3600
  }'
```

**Expected output:**
```json
{
  "granted": true,
  "tx_hash": "0x1234abcd...",
  "etherscan_url": "https://sepolia.etherscan.io/tx/0x1234abcd..."
}
```

**Verify on-chain:** Open the `etherscan_url` to see the `GrantRecorded` event.

---

### Step 6: Redeem Access (Requester/Doctor)

The doctor redeems access to get the re-encrypted capsule:

```bash
curl -X POST http://localhost:8000/access/redeem \
  -H "Authorization: Bearer $REQUESTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cid": "<cid_from_step_3>"
  }'
```

**Expected output:**
```json
{
  "reenc_capsule": "<base64_encoded_cfrag>",
  "cid": "bafybeig...",
  "blob_url": "https://storacha.link/ipfs/bafybeig...",
  "capsule": "<original_capsule_hex>",
  "encrypted_cek": "<encrypted_cek_hex>",
  "owner_pubkey": "<owner_public_key>",
  "filename": "test_file.pdf"
}
```

---

## Bonus: View Patient Records

```bash
curl -X GET "http://localhost:8000/access/records/<patient_user_id>" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```

**Expected output:**
```json
{
  "records": [
    {
      "id": 1,
      "cid": "bafybeig...",
      "filename": "test_file.pdf",
      "capsule": "<hex>",
      "encrypted_cek": "<hex>",
      "tx_hash": null,
      "created_at": "2025-11-29T..."
    }
  ],
  "count": 1
}
```

---

## Troubleshooting

### "Chain not configured"
- Verify `SEPOLIA_RPC_URL`, `HEALTH_RECORDS_CONTRACT_ADDRESS`, and `SIGNER_PRIVATE_KEY` are set in `.env`

### "Key file not found"
- Run `python -c "from app.utils.umbral_utils import ensure_keys_exist; ensure_keys_exist()"` to generate keys

### "Address already in use"
- Kill the existing process: `lsof -ti:8000 | xargs kill -9`

### On-chain tx fails
- Ensure signer wallet has Sepolia ETH (get from faucet)
- Check `SEPOLIA_RPC_URL` is valid

---

## References

- **Storacha docs**: https://docs.storacha.network/
- **pyUmbral docs**: https://pyumbral.readthedocs.io/
- **Sepolia explorer**: https://sepolia.etherscan.io/
- **web3.py docs**: https://web3py.readthedocs.io/
- **Hardhat docs**: https://hardhat.org/docs

---

## Quick Test Script

Save and run this script for a quick automated check:

```bash
#!/bin/bash
set -e

BASE_URL="http://localhost:8000"

echo "1. Health check..."
curl -s "$BASE_URL/health" | jq .

echo "2. Check chain status..."
curl -s "$BASE_URL/debug/chain-status" | jq . 2>/dev/null || echo "Chain debug endpoint not available"

echo "Smoke test completed!"
```
