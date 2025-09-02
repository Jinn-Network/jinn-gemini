# Project Jinn: Zora Protocol Integration Specification

- **Date**: 2025-09-05
- **Status**: Final (Revised)

## 1. Overview

This document provides the final implementation plan for integrating the Zora Protocol with the Jinn agent system. The goal is to extend the agent's capabilities into the on-chain creator economy by enabling it to create and query Zora content coins securely and reliably.

## 2. Core Requirements

1.  **Create Content Coins**: The agent must be able to programmatically create new Zora content coins.
2.  **Query Protocol Data**: The agent must be able to query the Zora network for information.
3.  **Leverage Existing Identity**: The integration must use the agent's existing Gnosis Safe wallet.
4.  **Preserve Autonomy**: The tools provided are capabilities; the agent's autonomous logic decides on their use.
5.  **Maintain Security**: The worker's private key must remain isolated and secure.

## 3. Final Architecture: Database-Mediated Transaction Execution

The architecture uses a database queue to decouple transaction preparation from the secure signing process, addressing the core challenge of executing Zora SDK transactions (designed for EOAs) through the agent's Gnosis Safe.

### 3.1. Secure Transaction Flow

1.  **Tool Prepares**: A tool prepares the raw transaction data.
2.  **Tool Enqueues**: `enqueue_transaction` validates the payload against an allowlist, calculates a hash for idempotency, and inserts it into the `transaction_requests` queue.
3.  **Worker Polls & Claims**: The worker uses an atomic `UPDATE ... RETURNING` query with `FOR UPDATE SKIP LOCKED` to claim a pending request.
4.  **Worker Signs & Executes**: The worker performs final security checks, uses `@safe-global/protocol-kit` to wrap, sign, and broadcast the transaction.
5.  **Worker Updates**: The worker updates the database record with the outcome, transaction hashes, and any errors.
6.  **Agent Monitors**: The agent uses `get_transaction_status` to check the outcome.

## 4. Low-Level Implementation Specification

### 4.1. Database Schema (`transaction_requests`)

-   **File**: `supabase/migrations/<TIMESTAMP>_create_transaction_requests.sql`
-   **Content**: A robust table for managing the transaction lifecycle, including idempotency, leasing, and structured error tracking.

    ```sql
    CREATE TYPE transaction_status AS ENUM ('PENDING', 'CLAIMED', 'CONFIRMED', 'FAILED');
    CREATE TYPE transaction_error_code AS ENUM (
        'ALLOWLIST_VIOLATION',
        'CHAIN_MISMATCH',
        'INVALID_PAYLOAD',
        'INSUFFICIENT_FUNDS',
        'RPC_FAILURE',
        'SAFE_TX_REVERT',
        'UNKNOWN'
    );

    CREATE TABLE public.transaction_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status transaction_status NOT NULL DEFAULT 'PENDING',
        attempt_count INT NOT NULL DEFAULT 0,
        payload_hash TEXT NOT NULL,
        
        -- Execution Tracking & Leasing
        worker_id TEXT,
        claimed_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        
        -- Transaction Data
        payload JSONB NOT NULL,
        chain_id BIGINT NOT NULL,
        
        -- Result Data
        safe_tx_hash TEXT,
        tx_hash TEXT,
        error_code transaction_error_code,
        error_message TEXT,
        
        -- Auditing
        source_job_id UUID REFERENCES public.job_board(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE public.transaction_requests ADD CONSTRAINT uq_payload_hash UNIQUE (payload_hash);
    CREATE INDEX idx_tx_requests_poll ON public.transaction_requests(status, created_at) WHERE status = 'PENDING';
    COMMENT ON TABLE public.transaction_requests IS 'A queue for on-chain transactions to be executed by a worker via Gnosis Safe.';
    CREATE TRIGGER set_timestamp BEFORE UPDATE ON public.transaction_requests FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
    ```

### 4.2. Agent Identity (`WalletIdentity`)

-   **File**: `packages/wallet-manager/src/types.ts`
-   **Change**: Extend `WalletIdentity`. A CLI admin tool (`yarn wallet:set-creator-coin --address 0x...`) will be created to set this value securely.
    ```typescript
    export interface WalletIdentity {
      // ... existing fields
      creator_coin_address?: `0x${string}`;
    }
    ```

### 4.3. Worker Enhancement (Safe Transaction Executor)

-   **Dependencies**: Pin specific versions for `@safe-global/protocol-kit` and `ethers@5`.
-   **New Module**: `worker/transaction-executor.ts`.
-   **Logic**:
    -   **Atomic Claim**: Implement the `UPDATE ... FOR UPDATE SKIP LOCKED` polling mechanism.
    -   **Lease Timeout**: A maintenance process will run periodically to requeue requests `WHERE status = 'CLAIMED' AND claimed_at < now() - INTERVAL '5 minutes'`.
    -   **Execution**: Use `protocol-kit` to sign and execute. Wait for a configurable number of block confirmations (e.g., `WORKER_TX_CONFIRMATIONS=3`). Persist both `safe_tx_hash` and the final L1 `tx_hash`.

### 4.4. Security Guardrails & Configuration

-   **Allowlist Config**: The worker will load a checked-in JSON config file (`worker/config/allowlists.json`) with the following structure:
    ```json
    {
      "8453": { // Base Mainnet
        "contracts": {
          "0xZoraFactoryAddress": {
            "name": "Zora Content Coin Factory",
            "allowedSelectors": ["0xcreateCoin"]
          }
        }
      }
    }
    ```
-   **Validation**: Before signing, the executor MUST:
    1.  Verify the request's `chain_id` is in the allowlist config and matches the worker's `CHAIN_ID`.
    2.  Verify the `payload.to` address is a key in the `contracts` object for that chain.
    3.  Verify the first 4 bytes of `payload.data` match a selector in `allowedSelectors`.
    4.  Verify `payload.value` is '0'.
    -   Failure of any check results in a `FAILED` status with the appropriate `error_code`.

### 4.5. New MCP Tools

-   **`zora_prepare_create_coin_tx(...)`**: Prepares transaction payload, ensuring metadata complies with EIP-7572. Returns unsigned transaction JSON.
-   **`enqueue_transaction(payload, chain_id)`**: Calculates a SHA256 hash of the canonicalized payload JSON to use as `payload_hash` for idempotency. Inserts the transaction into the queue.
-   **`get_transaction_status(request_id)`**: Queries the queue and constructs explorer URLs for any resulting hashes from a configured base URL.
-   **Zora Query Tools**: Will use the shared `context-management.ts` module to enforce pagination (default: 10 items) and token budgets (default: 50k tokens).

## 5. Development Plan & Testing

**Phase 1: Foundational Setup**
1.  Create and apply the `transaction_requests` migration and its rollback script. Just apply it using the Supabase MCP tools.
2.  Update `package.json`, `WalletIdentity`, and create the allowlist config.
3.  Implement and test the `wallet:set-creator-coin` CLI tool.

**Phase 2: Worker Enhancement**
1.  Implement `transaction-executor.ts` with atomic claiming, lease timeouts, and all security guardrails.
2.  Implement the Safe SDK signing and execution logic.
3.  Integrate the executor into `worker.ts` under a feature flag.

**Phase 3: MCP Tool Implementation**
1.  Implement and test the transaction and query tools.
2.  Add a dry-run mode to `zora_prepare_...` that returns calldata without enqueuing.

**Phase 4: E2E Testing & Validation**
1.  Write unit tests for payload validation, allowlists, and idempotency (duplicate hash).
2.  Write an integration test on a Tenderly VNet for the full happy path and for failure cases (allowlist violation, chain mismatch).
3.  Write an integration test to verify the lease timeout and requeue mechanism.

## 6. Resources

-   **Zora Contracts & SDK**: `https://docs.zora.co/coins`
-   **Safe Protocol Kit**: `https://docs.safe.global/safe-core-aa-sdk/protocol-kit`
-   **EIP-7572 Metadata**: Search for the EIP specification for metadata structure.

## 7. Acceptance Criteria

1.  [ ] **Successful Coin Creation**: The agent can successfully create a Zora content coin on a Tenderly VNet.
2.  [ ] **Secure & Correct Execution**: The transaction is executed by the Gnosis Safe. Both `safeTxHash` and `tx_hash` are persisted with explorer URLs.
3.  [ ] **Full Traceability & Idempotency**: Enqueuing an identical payload hash is rejected by the database's unique constraint, ensuring single on-chain execution.
4.  [ ] **Successful Data Query**: The agent can query for the coin it just created, with results correctly paginated.
5.  [ ] **Robust Error Handling**: The system correctly handles and logs failures with specific error codes (`ALLOWLIST_VIOLATION`, `CHAIN_MISMATCH`).
6.  [ ] **Fault Tolerance**: A transaction claimed by a "dead" worker is requeued and processed after a 5-minute lease timeout.
7.  [ ] **Documentation Updated**: All setup steps (env variables, allowlist config, CLI for creator coin setup) are documented.
8.  [ ] **Metadata Compliance**: Created coin metadata adheres to the EIP-7572 standard.