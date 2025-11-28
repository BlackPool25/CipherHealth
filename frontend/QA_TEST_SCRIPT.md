# CipherHealth Frontend - QA Test Script

## Manual Testing Procedure (5 Steps)

This document provides a step-by-step manual QA script to verify the complete user flow.

### Prerequisites

1. **MetaMask Extension** installed in your browser
2. **Sepolia testnet ETH** (get from [Sepolia Faucet](https://sepoliafaucet.com/))
3. **Backend running** on `http://localhost:8000` with `DEV_MODE=true`
4. **Frontend running** on `http://localhost:3000`

---

## Step 1: Connect MetaMask

**Objective:** Verify MetaMask wallet connection works correctly.

1. Navigate to `http://localhost:3000/login`
2. Observe the 3-step connection flow UI:
   - ✅ Step 1 shows "MetaMask Detected" (green checkmark)
   - ⬜ Step 2 shows "Connect Wallet" with a button
   - ⬜ Step 3 shows "Switch to Sepolia" (grayed out)

3. Click the **"Connect"** button next to Step 2
4. MetaMask popup appears - approve the connection

**Expected Result:**
- ✅ Step 2 changes to show your truncated wallet address (e.g., `0x1234...5678`)
- The navbar shows a green dot with your wallet address
- Step 3 becomes active

**Pass Criteria:** Wallet address displayed in both Step 2 and navbar

---

## Step 2: Sepolia Network Check

**Objective:** Verify the app correctly detects and switches networks.

### If NOT on Sepolia:
1. After connecting wallet, Step 3 shows "Switch to Sepolia" with orange styling
2. A yellow warning banner appears: "Wrong network detected"
3. Click the **"Switch"** button in Step 3 (or the yellow warning banner)
4. MetaMask popup asks to switch network - approve it

### If already on Sepolia:
1. Step 3 automatically shows green checkmark with "Sepolia Network"
2. No yellow warning banner appears
3. Navbar shows a green "Sepolia" badge

**Expected Result:**
- ✅ All 3 steps show green checkmarks
- Navbar displays: green dot + address + "Sepolia" badge
- "Continue with Invite Code" button becomes active (blue)

**Pass Criteria:** App correctly identifies Sepolia (Chain ID: 11155111)

---

## Step 3: Login with Seeded Invite Code

**Objective:** Verify the invite-only authentication flow.

1. Click **"Continue with Invite Code"** button
2. The Seed Login Modal appears with two options:
   - Enter existing invite code
   - Generate new invite code

3. Click **"Generate New"** to seed a new invite code
   - This calls: `POST /auth/seed-invite`
   - A green box shows the generated code

4. Fill in the registration form:
   - Username: `testuser1`
   - Email: `test@example.com`

5. Click **"Register"**
   - This calls: `POST /auth/register`

**Expected Result:**
- ✅ Success animation appears
- Automatically redirects to `/dashboard`
- Navbar shows: Wallet address + "testuser1" + Logout link

**Pass Criteria:** User is registered and logged in

---

## Step 4: Upload File and Verify CID Display

**Objective:** Verify file upload shows the IPFS CID correctly.

1. Navigate to `/upload` (or click "Upload Record" on dashboard)
2. Verify the Upload button is **enabled** (blue, clickable)
   - Requires: wallet connected + Sepolia network + logged in

3. Click the drop zone or drag a file (e.g., a PDF or image)
4. Click **"Encrypt & Upload"**
   - This calls: `POST /upload/encrypt` then `POST /upload/pin`

5. Wait for upload to complete (progress bar fills)

**Expected Result:**
- ✅ "Upload Successful!" message appears
- CID Display component shows:
  - Label: "Content Identifier (CID)"
  - Full CID string (e.g., `bafybeigdyrzt5sfp7udm7hu76uh7...`)
  - "Copy" button works
  - "View on IPFS Gateway" link opens in new tab

**Pass Criteria:** CID is displayed with working copy button

---

## Step 5: Verify Transaction Hash with Etherscan Link

**Objective:** Verify txHash displays with working Sepolia Etherscan link.

1. After successful upload (Step 4), observe the Transaction section below CID

2. Verify TxHashDisplay component shows:
   - Label: "Blockchain Transaction"
   - Status badge: "Confirmed" (green)
   - Full transaction hash
   - "Copy" button
   - "View on Sepolia Etherscan" link

3. Click **"View on Sepolia Etherscan"**
   - Link format: `https://sepolia.etherscan.io/tx/{txHash}`

4. Navigate to `/audit` to see transaction history
5. Click on any log entry with a "View tx →" link
6. Verify it opens Sepolia Etherscan in new tab

**Expected Result:**
- ✅ Transaction hash displayed correctly
- ✅ Etherscan link opens to: `https://sepolia.etherscan.io/tx/0x...`
- ✅ Audit log shows all user actions with tx links

**Pass Criteria:** Etherscan link is correct and clickable

---

## Backend Endpoints Reference

| Page | Endpoint | Method | Description |
|------|----------|--------|-------------|
| Login | `/auth/seed-invite` | POST | Seeds new invite code (dev mode) |
| Login | `/auth/register` | POST | Registers user with invite code |
| Dashboard | `/upload/files/{userId}` | GET | Lists user's uploaded files |
| Dashboard | `/grant/list/{userId}` | GET | Lists user's grants |
| Upload | `/upload/encrypt` | POST | Encrypts file |
| Upload | `/upload/pin` | POST | Pins to IPFS, returns CID |
| Grant Access | `/grant/create` | POST | Creates access grant |
| Grant Access | `/grant/revoke` | POST | Revokes grant, returns txHash |
| Audit | `/audit/logs/{userId}` | GET | Gets audit logs |

---

## Troubleshooting

### MetaMask Not Detected
- Ensure MetaMask extension is installed and enabled
- Refresh the page after installing

### Network Switch Failed
- Manually add Sepolia in MetaMask:
  - Chain ID: 11155111
  - RPC: https://rpc.sepolia.org
  - Symbol: ETH
  - Explorer: https://sepolia.etherscan.io

### Invite Code Generation Failed
- Ensure backend is running with `DEV_MODE=true`
- Check backend logs for errors

### Upload Button Disabled
- Verify wallet is connected (Step 1)
- Verify on Sepolia network (Step 2)  
- Verify logged in (Step 3)

---

## Quick Smoke Test Commands

```bash
# Terminal 1: Start Backend
cd backend
DEV_MODE=true uvicorn app.main:app --reload

# Terminal 2: Start Frontend
cd frontend
pnpm dev

# Browser: Open http://localhost:3000/login
```

---

## Test Checklist

| # | Test | Status |
|---|------|--------|
| 1 | MetaMask connects and shows address | ⬜ |
| 2 | Detects wrong network, switches to Sepolia | ⬜ |
| 3 | Generates invite code and registers user | ⬜ |
| 4 | Uploads file, displays CID | ⬜ |
| 5 | Shows txHash with Etherscan link | ⬜ |

**All tests pass: ⬜ YES / ⬜ NO**
