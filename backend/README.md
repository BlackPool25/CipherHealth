# Decent-Hospital Backend

Decentralized hospital data management backend with Umbral Proxy Re-Encryption.

## Features

- **JWT Authentication**: Secure token-based authentication with invite codes
- **File Encryption**: AES-256-GCM symmetric encryption with Content Encryption Keys (CEK)
- **IPFS Storage**: Encrypted files are pinned to IPFS via Storacha (web3.storage)
- **Umbral PRE**: Proxy Re-Encryption allows secure data sharing without revealing plaintext
- **On-Chain Audit**: Read audit records from Ethereum smart contract events

## Quick Start

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

**Required:**
- `JWT_SECRET`: Secret key for JWT tokens (generate with `python -c "import secrets; print(secrets.token_urlsafe(32))"`)
- `STORACHA_API_KEY`: Get from https://web3.storage
- `DEV_MODE=true`: Enable development features

### 3. Run the Server

```bash
# Using the run script
./run.sh dev

# Or with uvicorn directly
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Seed Invite Codes (Optional)

```bash
python ../scripts/seed.py --count 10
```

## API Endpoints

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/seed-login` | POST | Login with invite code, returns JWT |
| `/auth/seed-invite` | POST | Create invite code (dev only) |
| `/auth/register` | POST | Register with invite code |
| `/auth/me` | GET | Get current user (requires JWT) |

### Upload

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/upload` | POST | Encrypt file and upload to Storacha |
| `/upload/encrypt` | POST | Encrypt file (returns temp ID) |
| `/upload/pin` | POST | Pin encrypted file to IPFS |
| `/upload/files/{user_id}` | GET | List files for user |

### Grants

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/grant` | POST | Create access grant (requires JWT) |
| `/grant/create` | POST | Create grant (legacy) |
| `/grant/revoke` | POST | Revoke a grant |
| `/grant/redeem` | POST | Redeem grant (re-encrypt) |
| `/grant/list/{user_id}` | GET | List grants by user |

### Audit

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/audit` | GET | Get all audit logs |
| `/audit/logs/{user_id}` | GET | Get audit logs for user |
| `/audit/chain` | GET | Get on-chain audit events |

---

## Manual Smoke Tests (curl commands)

### 1. Health Check

```bash
curl http://localhost:8000/health
# Expected: {"status":"healthy","version":"0.1.0","dev_mode":true}
```

### 2. Seed an Invite Code (Dev Mode)

```bash
curl -X POST http://localhost:8000/auth/seed-invite \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: {"code":"<random_code>","message":"Invite code created successfully"}
```

### 3. Login with Invite Code

```bash
# Use the code from step 2
curl -X POST http://localhost:8000/auth/seed-login \
  -H "Content-Type: application/json" \
  -d '{"invite_code": "YOUR_CODE_HERE"}'
# Expected: {"access_token":"...","token_type":"bearer","user":{...},"message":"..."}
```

Save the `access_token` for authenticated requests:
```bash
export TOKEN="your_access_token_here"
```

### 4. Get Current User

```bash
curl http://localhost:8000/auth/me \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"id":1,"username":"...","email":"...","public_key":null,"created_at":"..."}
```

### 5. Upload a File

```bash
# Create a test file
echo "Hello, this is a test medical record." > sample.txt

# Upload it
curl -X POST http://localhost:8000/upload \
  -F "file=@sample.txt" \
  -F "patient_id=1"
# Expected: {"cid":"bafy...","file_id":1,"filename":"sample.txt","encrypted_cek":"...","capsule":"","message":"..."}
```

**Verify CID format:**
```bash
# CIDv1 starts with 'bafy' or 'baf'
# CIDv0 starts with 'Qm'
```

### 6. List User's Files

```bash
curl http://localhost:8000/upload/files/1
# Expected: {"files":[{"id":1,"cid":"...","owner_id":1,"filename":"sample.txt",...}],"count":1}
```

### 7. Create a Grant

```bash
curl -X POST http://localhost:8000/grant \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"grantee_pubkey": "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234", "file_id": 1, "expiry_seconds": 3600}'
# Expected: {"grant_id":1,"reencryption_key":"...","message":"Grant created successfully"}
```

### 8. Redeem a Grant

```bash
curl -X POST http://localhost:8000/grant/redeem \
  -H "Content-Type: application/json" \
  -d '{"grant_id": 1, "capsule": "placeholder_capsule_hex"}'
# Expected: {"cfrag":"...","capsule":"...","delegating_pk":"...","message":"Re-encryption successful"}
```

### 9. Revoke a Grant

```bash
curl -X POST http://localhost:8000/grant/revoke \
  -H "Content-Type: application/json" \
  -d '{"grant_id": 1, "granter_id": 1, "emit_onchain": false}'
# Expected: {"grant_id":1,"status":"revoked","tx_hash":null,"message":"Grant revoked successfully"}
```

### 10. Get Audit Logs

```bash
curl http://localhost:8000/audit/logs/1
# Expected: {"logs":[...],"count":...,"source":"database"}
```

### 11. Get Chain Audit

```bash
curl http://localhost:8000/audit/chain
# Expected: {"events":[],"count":0,"from_block":0,"to_block":0,"contract_address":null}
```

---

## Docker

### Build

```bash
docker build -t decent-hospital-backend:latest .
```

### Run

```bash
docker run -p 8000:8000 \
  -e DEV_MODE=true \
  -e JWT_SECRET=your-secret-key \
  -e STORACHA_API_KEY=your-api-key \
  decent-hospital-backend:latest
```

---

## Testing

### Run Tests

```bash
pytest tests/ -v
```

### Run with Coverage

```bash
pytest tests/ -v --cov=app --cov-report=html
```

### Integration Test (requires STORACHA_API_KEY)

```bash
STORACHA_API_KEY=your_key pytest tests/test_upload.py::TestUploadIntegration -v
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | - | Secret for JWT signing |
| `JWT_ALGORITHM` | No | HS256 | JWT algorithm |
| `JWT_EXPIRATION_HOURS` | No | 24 | Token expiry |
| `STORACHA_API_KEY` | Yes* | - | Storacha/web3.storage API key |
| `STORACHA_API_URL` | No | https://api.web3.storage | Storacha API URL |
| `DEV_MODE` | No | false | Enable dev features |
| `DATABASE_URL` | No | sqlite:///./decent_hospital.db | SQLite path |
| `SEPOLIA_RPC_URL` | No | https://rpc.sepolia.org | Ethereum RPC |
| `HEALTH_RECORDS_CONTRACT_ADDRESS` | No | - | Contract address |
| `UMBRAL_SIGNING_KEY_FILE` | No | ./keys/signing_key.bin | Signing key path |
| `UMBRAL_SECRET_KEY_FILE` | No | ./keys/secret_key.bin | Secret key path |

*Required for upload functionality

---

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app entry point
│   ├── db.py                # Database models and operations
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── auth.py          # Authentication endpoints
│   │   ├── upload.py        # File upload endpoints
│   │   ├── grants.py        # Grant management endpoints
│   │   └── audit.py         # Audit trail endpoints
│   └── utils/
│       ├── __init__.py
│       ├── storage.py       # Storacha/IPFS utilities
│       └── umbral_utils.py  # Umbral PRE utilities
├── keys/                    # Cryptographic keys (gitignored)
├── tests/
│   ├── __init__.py
│   └── test_upload.py       # Upload tests
├── .env.example
├── Dockerfile
├── pyproject.toml
├── requirements.txt
├── run.sh
└── README.md
```

---

## Security Notes

- **Never commit `.env` files** with real credentials
- **Never commit `keys/` directory** with private keys
- Keys are generated with 0600 permissions (owner read/write only)
- JWT tokens expire after 24 hours by default
- Use strong, unique `JWT_SECRET` in production
