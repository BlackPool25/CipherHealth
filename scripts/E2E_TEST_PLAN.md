# E2E Verification Test Plan

This document describes how to run the end-to-end verification script that proves the Decent-Hospital encryption and proxy re-encryption flow works correctly.

## What This Tests

The `verify_e2e.py` script validates:

1. **Ciphertext Storage**: Files uploaded via the backend are stored on Storacha as **encrypted ciphertext**, not plaintext
2. **Capsule Metadata**: Upload responses include Umbral capsule and encrypted CEK
3. **Re-encryption Flow**: Owner → Grantee proxy re-encryption works correctly
4. **Binary File Support**: PNG, DICOM-like binaries, and other file types work equally

## Prerequisites

### 1. Python Environment

```bash
# Activate the virtual environment
cd /home/lightdesk/Projects/Decent-Hospital
source .venv/bin/activate

# Ensure dependencies are installed
pip install pyumbral requests cryptography
```

### 2. Backend Running (for full E2E tests)

```bash
# Terminal 1: Start the backend
cd backend
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Environment Variables

Create or update `.env` in the project root:

```bash
# Required for full E2E tests (backend must be configured with these)
BACKEND_HOST=http://localhost:8000
STORACHA_GATEWAY_URL=https://storacha.link

# Backend-specific (see backend/.env.example)
# STORACHA_PRINCIPAL=<your-principal-key>
# STORACHA_PROOF=<your-delegation-proof>
```

**⚠️ STOP HERE if you don't have Storacha credentials configured in the backend!**

To get Storacha credentials:
1. Install CLI: `npm install -g @storacha/cli`
2. Login: `storacha login your-email@example.com`
3. Create space: `storacha space create decent-hospital`
4. Generate principal: `storacha key create --json`
5. Generate proof: `storacha delegation create <DID> -c space/blob/add -c space/index/add -c upload/add --base64`

Set `STORACHA_PRINCIPAL` and `STORACHA_PROOF` in `backend/.env` before continuing.

## Running the Verification

### Quick Test (Local Crypto Only)

This runs without the backend, testing only the local encryption/re-encryption logic:

```bash
cd /home/lightdesk/Projects/Decent-Hospital
source .venv/bin/activate
python scripts/verify_e2e.py
```

If the backend is not running, the script will automatically fall back to local-only tests.

### Full E2E Test (With Backend + Storacha)

```bash
# Terminal 1: Ensure backend is running
cd backend && python -m uvicorn app.main:app --reload

# Terminal 2: Run the verification
cd /home/lightdesk/Projects/Decent-Hospital
source .venv/bin/activate
export BACKEND_HOST=http://localhost:8000
export STORACHA_GATEWAY_URL=https://storacha.link
python scripts/verify_e2e.py
```

## Expected Output

### Success Case

```
======================================================================
DECENT-HOSPITAL E2E VERIFICATION SCRIPT
======================================================================
Backend Host: http://localhost:8000
Storacha Gateway: https://storacha.link

Creating sample test files if needed...

Checking backend connectivity...
  Backend responded with status 200

Generating test owner (Alice) keypair...
  Owner public key: 03abc123def456...

============================================================
STEP 1: Upload and verify ciphertext storage
============================================================
File: sample.bin
  Original size: 256 bytes
  Uploading sample.bin to http://localhost:8000/upload...
  Upload response:
    CID: bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
    Capsule: 03abc123def456789...
    Encrypted CEK: 04def789abc012345...
  ✓ Response contains required fields (cid, capsule, encrypted_cek)

  Fetching blob from Storacha gateway...
  Downloaded: 280 bytes
  ✓ Downloaded blob != original plaintext (file is encrypted)
  ✓ Encrypted blob size: 280 (plaintext: 256)

============================================================
STEP 2: Verify owner can decrypt their own data
============================================================
  Decrypting encapsulated CEK with owner's private key...
  ✓ Recovered CEK: 32 bytes
  Fetching encrypted blob from gateway to decrypt...
  ✓ Owner successfully decrypted data - matches original plaintext!

============================================================
STEP 3: Verify re-encryption flow (owner -> grantee)
============================================================
  Generating grantee (Bob) keypair...
    Grantee public key: 02xyz789...
  Owner generating re-encryption key (kfrag) for grantee...
    ✓ Re-encryption key generated: 193 bytes
  Proxy re-encrypting capsule for grantee...
    ✓ Re-encrypted capsule fragment (cfrag): 249 bytes
  Grantee decrypting with cfrag...
    Grantee recovered CEK: 32 bytes
  ✓ Grantee successfully recovered the same CEK as owner!

============================================================
STEP 4: Verify binary file handling (PNG, BIN)
============================================================

  Testing Binary/DICOM-like: sample.bin
    Original size: 256 bytes
    Encrypted size: 272 bytes
    ✓ Ciphertext != plaintext
    ✓ CEK encapsulated (capsule: 98 bytes)
    ✓ Owner decryption successful - matches original
    ✓ Grantee re-encryption successful - matches original

  Testing PNG image: sample.png
    Original size: 74 bytes
    Encrypted size: 90 bytes
    ✓ Ciphertext != plaintext
    ✓ CEK encapsulated (capsule: 98 bytes)
    ✓ Owner decryption successful - matches original
    ✓ Grantee re-encryption successful - matches original

======================================================================
PYUMBRAL + STORACHA E2E OK
======================================================================

All verification steps passed:
  ✓ Files stored as ciphertext (not plaintext)
  ✓ Upload returns capsule and encrypted CEK
  ✓ Owner can decrypt their own data
  ✓ Re-encryption flow works (owner -> grantee)
  ✓ Binary and image files handled correctly
```

### Failure Case: Encryption Failed

```
  ❌ ENCRYPTION FAILED: Downloaded blob equals original plaintext!
  The file was stored unencrypted on Storacha.
```

This indicates the backend is not encrypting files before upload. Check:
- Umbral is properly configured
- The `/upload` endpoint is using `encrypt_with_cek`

### Failure Case: Re-encryption Failed

```
  ❌ CEK MISMATCH: Grantee recovered different CEK than owner
```

This indicates a problem with the re-encryption key generation or capsule re-encryption. Check:
- pyUmbral is correctly installed
- Key serialization/deserialization is consistent

## Test Files

The script creates these test files in `scripts/`:

| File | Size | Purpose |
|------|------|---------|
| `sample.bin` | 256 bytes | Random binary data (simulates DICOM/medical files) |
| `sample.png` | 74 bytes | Valid 8x8 PNG image |

## Documentation References

The verification script and this test plan were created using official documentation:

- **pyUmbral Usage Guide**: https://pyumbral.readthedocs.io/en/latest/using_pyumbral.html
- **pyUmbral API Reference**: https://pyumbral.readthedocs.io/en/latest/api.html
- **Storacha Retrieval Docs**: https://docs.storacha.network/how-to/retrieve/
- **Storacha Upload Docs**: https://docs.storacha.network/how-to/upload/
- **Storacha CI/Backend Auth**: https://docs.storacha.network/how-to/ci/

## Troubleshooting

### Backend Not Running

```
  ⚠ Backend not reachable: Connection refused
  Continuing with local crypto verification only...
```

Start the backend with:
```bash
cd backend && python -m uvicorn app.main:app --reload
```

### Storacha Gateway Timeout

```
  ⚠ Could not verify from gateway: Gateway request timed out
```

The content may still be propagating through IPFS. Try:
1. Wait 1-2 minutes and re-run
2. Check if the CID exists: `curl https://storacha.link/ipfs/<CID>`

### Missing pyUmbral

```
ModuleNotFoundError: No module named 'umbral'
```

Install with:
```bash
pip install pyumbral
```

### Missing Storacha Credentials

If the backend returns "STORACHA_PRINCIPAL not set", you need to configure Storacha credentials. See the Prerequisites section above.

---

**Version**: 1.0  
**Last Updated**: November 2025  
**Author**: Integration Verifier
