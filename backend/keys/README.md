# Umbral Keys Directory

This directory stores Umbral cryptographic keys.

**SECURITY WARNING:**
- These files contain sensitive private keys
- NEVER commit these files to version control
- In production, use proper key management (HSM, Vault, etc.)

## Files

- `signing_key.bin` - Umbral signing key (for kfrag signatures)
- `secret_key.bin` - Umbral secret key (for encryption/decryption)

## Generation

Run the following Python code to generate keys:

```python
from umbral import SecretKey
import os

os.makedirs("keys", exist_ok=True)

# Generate signing key
signing_key = SecretKey.random()
with open("keys/signing_key.bin", "wb") as f:
    f.write(bytes(signing_key))

# Generate secret key
secret_key = SecretKey.random()
with open("keys/secret_key.bin", "wb") as f:
    f.write(bytes(secret_key))

# Print public key (safe to share)
print(f"Public key: {bytes(secret_key.public_key()).hex()}")
```
