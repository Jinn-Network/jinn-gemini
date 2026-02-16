# Phase 0: Infrastructure

**Prerequisites**: None (first phase)
**Abort on failure**: Abort entire run

## Steps

### 1. Clean up stale VNets

```bash
yarn test:e2e:vnet cleanup --max-age-hours=0
```

### 2. Create fresh VNet

```bash
yarn test:e2e:vnet create
```

This creates a Base chain fork on Tenderly, writes RPC_URL and VNET_ID to `.env.e2e`.

### 3. Start local stack

```bash
yarn test:e2e:stack
```

Leave running in background. The script automatically:
- Kills existing processes on ports 42069 and 4001
- Cleans stale `.ponder` cache
- Sets `PONDER_START_BLOCK` near VNet head
- Reads RPC_URL from `.env.e2e`

Wait for `Local stack ready` message.

## Expected Output

- VNet creation: JSON with `vnetId`, `adminRpcUrl`, `blockNumber`
- Stack startup: `Ponder ready at :42069`, `Control API ready at :4001`, `Local stack ready`

## On Failure

- **VNet creation fails**: Capture Tenderly API error. Check `.env.test` has valid `TENDERLY_ACCESS_KEY`, `TENDERLY_ACCOUNT_SLUG`, `TENDERLY_PROJECT_SLUG`.
- **Ponder fails to start**: Capture Ponder stderr. Check if port 42069 is in use. Check if `.ponder` cache was cleaned.
- **Control API fails to start**: Capture stderr. Check `.env` has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## CHECKPOINT: Phase 0 — Infrastructure

- [PASS|FAIL] VNet created (RPC_URL written to `.env.e2e`)
- [PASS|FAIL] Ponder healthy (`http://localhost:42069/graphql` responds)
- [PASS|FAIL] Control API healthy (`http://localhost:4001/graphql` responds)
