# Decent-Hospital

Decentralized healthcare prototype monorepo.

## Structure

- **frontend/** — Next.js + Tailwind
- **backend/** — Python FastAPI
- **contracts/** — Hardhat (Solidity)

## Setup

```bash
cp .env.example .env
pnpm install
```

## Development

```bash
# Run frontend
pnpm --filter frontend dev

# Run backend
pnpm --filter backend dev
```

## Deploy Contract

```bash
cd contracts && pnpm install && pnpm hardhat deploy --network sepolia
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SEPOLIA_RPC_URL` | Sepolia RPC URL for frontend |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Deployed contract address |
| `STORACHA_API_URL` | Storacha API endpoint |
| `STORACHA_API_KEY` | Storacha API key |
| `BACKEND_HOST` | Backend server host |
| `SEPOLIA_RPC_URL` | Sepolia RPC URL for contracts |
| `DEPLOYER_PRIVATE_KEY` | Private key for deployment |
| `INVITE_SEED_COUNT` | Invite seed count |
