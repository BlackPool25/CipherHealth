# Decent-Hospital Backend

Decentralized hospital data management backend with Umbral Proxy Re-Encryption.

## Features

- **Invite-Only Registration**: Users can only register with valid invite codes
- **File Encryption**: AES-256-GCM symmetric encryption with Content Encryption Keys (CEK)
- **IPFS Storage**: Encrypted files are pinned to IPFS via web3.storage
- **Umbral PRE**: Proxy Re-Encryption allows secure data sharing without revealing plaintext
- **On-Chain Grants**: Grant revocations can be emitted on-chain for auditability

## Setup

### 1. Install Dependencies

```bash
cd backend
pip install -r requirements.txt
```

Or using pip with pyproject.toml:

```bash
cd backend
pip install -e .
```

**Full pip install command:**
```bash
pip install fastapi uvicorn cryptography pyumbral requests python-dotenv web3 eth-account pydantic python-multipart aiosqlite
```

### 2. Configure Environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:
- `WEB3_STORAGE_TOKEN`: Get from https://web3.storage
- `DEV_MODE`: Set to `true` for development (enables seed-invite endpoint)

Optional (for on-chain features):
- `ETH_RPC_URL`: Ethereum RPC endpoint
- `ETH_PRIVATE_KEY`: Private key for signing transactions
- `GRANT_CONTRACT_ADDRESS`: Address of the grant contract

### 3. Generate Umbral Keys

TODO: Create a key generation script:

```python
from umbral import SecretKey

# Generate signing key
signing_key = SecretKey.random()
with open("keys/signing_key.bin", "wb") as f:
    f.write(bytes(signing_key))

# Generate secret key
secret_key = SecretKey.random()
with open("keys/secret_key.bin", "wb") as f:
    f.write(bytes(secret_key))

print(f"Public key: {bytes(secret_key.public_key()).hex()}")
```

### 4. Run the Server

```bash
# Development mode with auto-reload
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Or using Python directly
python -m app.main
```

## API Endpoints

### Authentication

- `POST /auth/seed-invite` - Create an invite code (dev only)
- `POST /auth/register` - Register with invite code

### File Upload

- `POST /upload/encrypt` - Encrypt a file
- `POST /upload/pin` - Pin encrypted file to IPFS
- `POST /upload/encrypt-and-pin` - Encrypt and pin in one request

### Grants

- `POST /grant/create` - Create a re-encryption grant
- `POST /grant/revoke` - Revoke a grant
- `GET /grant/list/grantee/{id}` - List grants for a grantee
- `GET /grant/list/granter/{id}` - List grants by a granter

### Health

- `GET /` - Basic health check
- `GET /health` - Detailed health check

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app entry point
│   ├── db.py                # SQLite database & models
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── auth.py          # Authentication endpoints
│   │   ├── upload.py        # File encryption & upload
│   │   └── grants.py        # Grant management
│   └── utils/
│       ├── __init__.py
│       ├── umbral_utils.py  # Umbral PRE operations
│       └── storage.py       # web3.storage integration
├── keys/                    # Umbral key files (gitignored)
├── requirements.txt
├── pyproject.toml
├── .env.example
└── README.md
```

## TODO

- [ ] Implement Umbral functions in `umbral_utils.py`
- [ ] Add JWT/session authentication
- [ ] Implement on-chain grant revocation
- [ ] Add file retrieval/decryption endpoints
- [ ] Add proper logging
- [ ] Add rate limiting
- [ ] Add comprehensive tests
- [ ] Add Docker support

## Security Notes

- **Never log or expose private keys**
- Keys should be stored in secure files, not in environment variables
- In production, use HSM or secure key management (e.g., AWS KMS, HashiCorp Vault)
- All file encryption uses AES-256-GCM
- CORS is configured to only allow localhost:3000 by default

## License

MIT
