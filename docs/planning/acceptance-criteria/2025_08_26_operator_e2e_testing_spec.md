# Operator Experience & E2E Wallet Functionality

Date: August 26, 2025

## 1. Motivation

The `wallet-manager` library is technically complete and verified at a unit/integration level. However, its ultimate success depends on its seamless integration into the Jinn worker and the experience of a human operator running the system.

This document shifts the focus from **technical correctness** (i.e., "does the library work in isolation?") to **operational robustness** (i.e., "does the integrated system work reliably for a human operator under realistic conditions?"). It establishes a clear test plan for validating the end-to-end functionality, focusing on usability, clear feedback for common errors, graceful failure, and predictable behavior in scenarios that automated unit tests often miss.

## 2. Practical Assessment Criteria

This section outlines a set of practical, end-to-end tests designed to validate the `wallet-manager` library from the perspective of a developer and a running Jinn worker.

### Assessment A: First-Time Worker Bootstrap

- **Scenario**: A new Jinn worker is started for the first time with a valid, funded private key.
- **Objective**: Verify the worker can autonomously create its on-chain identity without manual intervention.
- **Expected Outcome**:
    1.  The worker starts, logs that it is bootstrapping a new wallet.
    2.  The process completes successfully, logging a `status: 'created'` result with the new Safe address.
    3.  A `wallet.json` file is created in the correct path (`~/.jinn/wallets/<chainId>/<ownerAddress>.json`) with correct public data.
    4.  The deployed Safe contract can be verified on-chain (e.g., via a block explorer) and has the correct 1-of-1 configuration.

### Assessment B: Configuration Error Handling

- **Scenario 1**: A Jinn worker is started, but the `.env` file is missing the `WORKER_PRIVATE_KEY`.
- **Scenario 2**: The configured `CHAIN_ID` does not match the chain ID returned by the `RPC_URL`.
- **Objective**: Ensure the system provides clear, actionable feedback for common configuration errors before performing any on-chain actions.
- **Expected Outcome**:
    1.  The worker script fails to start during its initial pre-flight checks.
    2.  A clear, human-readable error message is printed to the console (e.g., `"FATAL: WORKER_PRIVATE_KEY is not defined..."` or `"FATAL: Chain ID mismatch. Configured: 8453, RPC returned: 1."`).
    3.  The process exits with a non-zero status code.
    4.  No partial or corrupt `wallet.json` files are created.

### Assessment C: Safe Functionality & Transaction Execution

- **Scenario**: After a Safe has been successfully bootstrapped, the worker needs to perform an on-chain action.
- **Objective**: Prove that the created Safe is a functional wallet controllable by the worker's EOA.
- **Expected Outcome**:
    1.  A test script, using the EOA signer, successfully constructs and executes a transaction *through the Safe* (e.g., a simple 0 ETH transfer funded from the Safe's balance).
    2.  The transaction is successfully mined and confirmed on-chain.
    3.  The transaction appears in the Safe's history on a block explorer, originating from the Safe address.
    4.  If a transaction is attempted with insufficient funds *in the Safe*, the worker logs a clear error (e.g., `"[ERROR] [WALLET] Insufficient funds in Safe wallet 0x... to execute transaction."`) and does not proceed.

### Assessment D: Worker Restart & State Reconciliation

- **Scenario**: A worker that has already bootstrapped a Safe is stopped and restarted.
- **Objective**: Verify the worker can correctly recognize its existing identity from the local file and on-chain state without re-deploying.
- **Expected Outcome**:
    1.  The worker starts and logs that it is loading an existing wallet identity.
    2.  It performs an on-chain check to verify the Safe's configuration.
    3.  The process completes quickly, logging a `status: 'exists'` result.
    4.  No new deployment transaction is initiated.

### Assessment E: Unfunded & Underfunded EOA Handling

- **Scenario**: A worker is started with a valid private key for an EOA that has zero or insufficient balance to cover the Safe deployment gas fees.
- **Objective**: Ensure the system provides a clear `needs_funding` state and can automatically proceed once the EOA is adequately funded.
- **Expected Outcome**:
    1.  The `bootstrap` process returns a `status: 'needs_funding'`.
    2.  The worker logs a clear message, including the EOA address to be funded and the minimum recommended amount in wei.
    3.  The worker enters a polling loop, periodically checking the EOA's balance. It continues to report `needs_funding` as long as the balance is less than the required amount.
    4.  Once the EOA is funded to meet or exceed the requirement, the worker detects the new balance, exits the loop, and successfully proceeds with the deployment.

### Assessment F: State Corruption & Recovery

- **Scenario 1**: The `wallet.json` file is corrupted (e.g., invalid JSON).
- **Scenario 2**: The `wallet.json` file is deleted, but the Safe already exists on-chain.
- **Objective**: Test the system's ability to recover from local state inconsistencies by treating the on-chain state as the source of truth.
- **Expected Outcome**:
    1.  The worker fails to parse the local file, logs a warning, and proceeds as if no file exists.
    2.  The worker predicts the deterministic Safe address and detects that it already exists on-chain.
    3.  It verifies the on-chain configuration (owners, threshold).
    4.  It logs that it is "adopting" an existing on-chain Safe.
    5.  It correctly reconstructs and overwrites/creates the `wallet.json` file with the verified on-chain data.
    6.  The final result is `status: 'exists'`.

### Assessment G: RPC/Network Failure Resilience

- **Scenario**: The configured RPC endpoint is temporarily unavailable during bootstrap.
- **Objective**: Verify the system handles network errors gracefully and can recover.
- **Expected Outcome**:
    1.  The bootstrap process fails with a clear `rpc_error`.
    2.  The worker logs a descriptive error message and initiates a retry mechanism with exponential backoff.
    3.  If the RPC becomes available during the retry window, the bootstrap eventually succeeds.
    4.  If all retries fail, the worker exits cleanly with a non-zero status code.
    5.  If a deployment transaction is broadcast but a receipt is not returned within a timeout, the worker logs a `[WARN]` with the pending transaction hash and exits. On next startup, it uses the persisted hash to check the transaction status before proceeding.

### Assessment H: Concurrency & On-Chain Adoption

- **Scenario**: Three new workers are started simultaneously with identical configurations in a clean environment (i.e., no pre-existing `wallet.json`).
- **Objective**: Verify the file-based lock prevents race conditions and that non-deploying workers correctly adopt the on-chain Safe created by the first worker to acquire the lock.
- **Expected Outcome**:
    1.  Only one on-chain deployment transaction is ever created.
    2.  One worker logs a `status: 'created'` result.
    3.  The other two workers log a `status: 'exists'` result.
    4.  All three workers reference the exact same Safe address in their final output and `wallet.json` file.

### Assessment I: On-Chain State Conflict

- **Scenario**: The worker predicts a deterministic Safe address that already exists on-chain but is configured incorrectly (e.g., has different owners or threshold).
- **Objective**: Ensure the worker identifies the conflict, fails safely, and provides a clear, actionable error.
- **Expected Outcome**:
    1.  The worker detects the on-chain Safe and attempts to verify its configuration.
    2.  It discovers the mismatch and immediately fails the bootstrap process.
    3.  It logs a `[FATAL]` error explaining the conflict (e.g., `"safe_config_mismatch: Predicted Safe 0x... has unexpected owners."`).
    4.  The process exits with a non-zero status code, and no `wallet.json` is written.

## 3. Implementation Plan & Work Breakdown

### A. E2E Test Rig (`jinn-e2e-test-rig` script)

- **Objective**: Create a Node.js-based test runner to automate the practical assessment criteria.
- **Tasks**:
    1.  **Environment Management**: Implement logic to spawn worker processes with custom environment variables (e.g., `JINN_WALLET_STORAGE_PATH`, `WORKER_PRIVATE_KEY`) to ensure test isolation.
    2.  **Filesystem Control**: Add functions to create and destroy temporary directories for wallet storage, ensuring tests run in a clean, ephemeral environment.
    3.  **Process Orchestration**: Develop utilities to run, monitor, and terminate worker processes, capturing `stdout` and exit codes to validate test outcomes.
    4.  **Tenderly Integration**: Use the Tenderly API to programmatically fund EOA addresses for automated testing of the `needs_funding` flow.

#### **Safety & Isolation Guarantees**

The test rig **MUST** be designed to be non-destructive to a developer's local environment.
- It **MUST NOT** read or modify the root `.env` or `.env.local` files. All configuration will be passed via `process.env`.
- It **MUST** operate within a temporary directory (e.g., `/tmp/jinn-e2e-tests/`) for all file-based operations, including wallet storage.
- It **MUST** include cleanup logic to remove temporary directories and spawned processes after test runs, even in the case of failure.

### B. Worker CLI & Operator Experience

- **Objective**: Refine the worker's startup sequence and console output to provide a clear and actionable operator experience.
- **Tasks**:
    1.  **Implement Pre-flight Checks**: Before initializing the `WalletManager`, add validation for all required environment variables. If any check fails, the worker should exit immediately with a clear error message and a non-zero exit code.
    2.  **Isolate Bootstrap Phase**: Refactor the main worker logic to treat wallet bootstrapping as a distinct, blocking startup phase. The worker should only proceed to the job-polling loop after a successful `created` or `exists` status.
    3.  **Design Structured Logging**: Implement the structured logging designs specified in the "Operator Command-Line Experience" section below. Ensure output is informative but not noisy.
    4.  **Implement Dry-Run Mode**: Add a `--dry-run` flag to the worker's CLI. When enabled, the worker will perform all pre-flight checks, predict the Safe address, and report its intended actions without executing any on-chain transactions or writing to the filesystem.

## 4. Operator Command-Line Experience

This section defines the target user experience for an operator interacting with the Jinn worker via the command line.

### A. Successful First Run (Onboarding)

```bash
> yarn dev

[INFO] Jinn Worker starting...
[INFO] [WALLET] No local identity found. Beginning bootstrap process...
[INFO] [WALLET] EOA Owner: 0x8E0A63Ffa538EeF4D5e5b0FbE3EFC0CB92A66b4b
[INFO] [WALLET] Predicted Safe Address: 0x9327aE88A8a45363E2E06b55279cD432Ff58fE65
[INFO] [WALLET] Deploying new 1-of-1 Gnosis Safe on base (Chain ID: 8453)...
[SUCCESS] [WALLET] Safe deployed successfully!
    - Owner Address: 0x8E0A63Ffa538EeF4D5e5b0FbE3EFC0CB92A66b4b
    - Safe Address:  0x9327aE88A8a45363E2E06b55279cD432Ff58fE65
    - Chain ID:      8453
    - View on Block Explorer: https://basescan.org/address/0x9327aE88A8a45363E2E06b55279cD432Ff58fE65
[INFO] [WALLET] Identity saved to ~/.jinn/wallets/8453/0x8E0A63Ffa538EeF4D5e5b0FbE3EFC0CB92A66b4b.json
[INFO] Wallet bootstrap complete. Worker is now polling for jobs...
```

### B. Successful Subsequent Run

```bash
> yarn dev

[INFO] Jinn Worker starting...
[INFO] [WALLET] Existing identity found. Verifying on-chain...
[SUCCESS] [WALLET] Identity verified.
    - Safe Address: 0x9327aE88A8a45363E2E06b55279cD432Ff58fE65
    - Chain ID:     8453
[INFO] Wallet bootstrap complete. Worker is now polling for jobs...
```

### C. Unfunded EOA Flow

```bash
> yarn dev

[INFO] Jinn Worker starting...
[INFO] [WALLET] No local identity found. Beginning bootstrap process...
[WARN] [WALLET] The owner EOA is not sufficiently funded to deploy a Safe.

    Action Required: Please fund the following address.

    - Address:    0x8E0A63Ffa538EeF4D5e5b0FbE3EFC0CB92A66b4b
    - Network:    base (Chain ID: 8453)
    - Required:   0.00018 ETH (180000000000000 wei)

[INFO] [WALLET] Waiting for funds. Checking balance every 10 seconds... (Press Ctrl+C to exit)
[INFO] [WALLET] Balance: 0.00000 ETH. Still waiting...
# (Operator funds the wallet in a separate terminal)
[INFO] [WALLET] Balance: 0.00000 ETH. Still waiting...
[SUCCESS] [WALLET] Funds detected! Resuming bootstrap process...
[INFO] [WALLET] Deploying new 1-of-1 Gnosis Safe on base (Chain ID: 8453)...
# ... continues to successful deployment ...
```

### D. Critical Error Messages

| Error Condition | Message |
|---|---|
| `WORKER_PRIVATE_KEY` not set | `[FATAL] WORKER_PRIVATE_KEY is not defined in environment. Please set it in your .env file.` |
| Malformed private key | `[FATAL] WORKER_PRIVATE_KEY is not a valid hexadecimal string. Please check your .env file.` |
| Invalid/Unreachable RPC | `[FATAL] Invalid RPC_URL or host unreachable: http://localhost:1234. Please check your .env file.` |
| Chain ID Mismatch | `[FATAL] Chain ID mismatch. Configured: 8453, RPC returned: 1. Please check your CHAIN_ID and RPC_URL.` |
| RPC Connection Failure | `[ERROR] [WALLET] Could not connect to RPC endpoint at http://localhost:8545. Retrying in 15s...` |
| On-Chain State Conflict | `[FATAL] [WALLET] On-chain conflict: Predicted Safe 0x... already exists with a different configuration.` |

### E. Dry-Run Mode Output

```bash
> yarn dev -- --dry-run

[INFO] Jinn Worker starting in DRY RUN mode...
[INFO] [WALLET] Configuration valid.
[INFO] [WALLET] EOA Owner: 0x8E0A63Ffa538EeF4D5e5b0FbE3EFC0CB92A66b4b
[INFO] [WALLET] EOA Balance: 0.025 ETH
[INFO] [WALLET] Predicted Safe Address: 0x9327aE88A8a45363E2E06b55279cD432Ff58fE65
[INFO] [WALLET] On-chain status: Not Deployed

[DRY RUN] ACTION: Deploy new 1-of-1 Gnosis Safe.
[DRY RUN] ACTION: Persist identity to ~/.jinn/wallets/8453/0x8E0A63Ffa538EeF4D5e5b0FbE3EFC0CB92A66b4b.json

[SUCCESS] Dry run complete. No on-chain or filesystem changes were made.
```

## 5. High-Level Specification

The implementation will be divided into three core components: enhancements to the core `wallet-manager` library, a significant refactor of the Jinn worker's CLI and startup logic, and the creation of a new E2E test rig.

1.  **`wallet-manager` Library Enhancements**: The core library will be updated to support the new operator-centric features. This includes adding a `--dry-run` mode to the bootstrap process, implementing stricter on-chain validation to detect configuration conflicts, and refining error types to provide more specific feedback to the CLI. **Note**: These changes constitute a major version bump to `v3.0.0`.

2.  **Jinn Worker CLI Enhancements**: The worker's entry point (`worker/worker.ts`) will be refactored to be a robust, operator-friendly command-line application. It will perform rigorous pre-flight checks before attempting any on-chain activity, manage the distinct phases of the bootstrap process, and provide the clear, structured logging detailed in the CLI experience mockups.

3.  **E2E Test Rig**: A new, standalone test script will be created to automate the execution of the practical assessment criteria. It will be responsible for orchestrating test scenarios by managing temporary environments, spawning and monitoring worker processes, and interacting with a forked blockchain environment (via Tenderly) to simulate real-world conditions like funding an EOA.

## 6. Low-Level Specification

This section details the specific code-level changes required for implementation.

### A. `packages/wallet-manager` Library

#### **1. `src/types.ts` - Data Contracts**

The core data contracts must be expanded to support dry runs and more specific error conditions.

```typescript
// Add new error codes for pre-flight and on-chain validation failures.
export type BootstrapError =
  | 'unfunded'
  | 'unsupported_chain'
  | 'safe_config_mismatch' // Existing, but now more critical
  | 'tx_service_unavailable'
  | 'rpc_error'
  | 'deployment_failed'
  | 'invalid_config' // New: For malformed private keys, etc.
  | 'chain_id_mismatch'; // New: For RPC vs. configured chain ID conflicts

// Fully specify the needs_funding result shape
export type NeedsFundingResult = {
  status: 'needs_funding';
  address: `0x${string}`;
  required: {
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    minRecommendedWei: bigint;
  };
};

// Define a new result type for the dry run feature.
export interface DryRunReport {
  ownerAddress: `0x${string}`;
  predictedSafeAddress: `0x${string}`;
  onChainState: 'not_deployed' | 'exists_valid' | 'exists_invalid_config';
  isFunded: boolean;
  requiredFundingWei?: bigint;
  estimatedDeploymentCostWei?: bigint;
  actions: Array<{
    type: 'DEPLOY_SAFE' | 'WRITE_IDENTITY_FILE';
    details: string;
  }>;
}

// Update the main result type to include the new dry_run status.
export type BootstrapResult =
  | { status: 'exists'; identity: WalletIdentity; metrics?: BootstrapMetrics }
  | { status: 'created'; identity: WalletIdentity; metrics: BootstrapMetrics }
  | NeedsFundingResult
  | { status: 'failed'; error: string; code: BootstrapError } // code is now mandatory
  | { status: 'dry_run'; report: DryRunReport };
```

#### **2. `src/bootstrap.ts` - Core Logic**

The `bootstrap` function will be modified to handle the dry-run mode and perform stricter on-chain validation. The dry-run logic MUST be self-contained within the library.

```typescript
// --- Helper Function Contracts (to be implemented) ---

/**
 * Checks the on-chain state of a predicted Safe address.
 * @returns An object describing the on-chain state.
 */
async function getOnChainSafeState(
  predictedAddress: `0x${string}`
): Promise<{
  exists: boolean;
  owners?: `0x${string}`[];
  threshold?: number;
}>;

/**
 * Estimates deployment cost and checks if the owner EOA is funded.
 * @returns An object describing the funding status and requirements.
 */
async function checkFunding(): Promise<{
  isFunded: boolean;
  required: NeedsFundingResult['required'];
  estimatedCostWei: bigint;
}>;


// --- Updated `bootstrap` function signature ---
export async function bootstrap(
  config: WalletManagerConfig,
  options: { dryRun?: boolean } = {},
): Promise<BootstrapResult> {
  const { dryRun = false } = options;
  
  // ... existing setup ...

  // --- Dry Run Pre-computation ---
  // All necessary read-only data should be gathered here.
  const ownerAddress = '...';
  const predictedSafeAddress = '...';
  const onChainState = await getOnChainSafeState(predictedSafeAddress); // Assume this function is refactored
  const { isFunded, required, estimatedCostWei } = await checkFunding();

  if (dryRun) {
    const report: DryRunReport = {
        ownerAddress,
        predictedSafeAddress,
        onChainState: onChainState.exists
          ? onChainState.owners?.length === 1 && onChainState.threshold === 1
            ? 'exists_valid'
            : 'exists_invalid_config'
          : 'not_deployed',
        isFunded,
        requiredFundingWei: required.minRecommendedWei,
        estimatedDeploymentCostWei: estimatedCostWei,
        actions: [
          // ... populate actions based on state
        ],
    };
    return { status: 'dry_run', report };
  }

  // --- Stricter On-Chain Validation ---
  // When adopting an existing Safe (either from a local file or from on-chain discovery)
  if (onChainState.exists) {
    const { owners, threshold } = onChainState;
    if (owners.length !== 1 || owners[0] !== ownerAddress || threshold !== 1) {
      return {
        status: 'failed',
        error: `On-chain conflict: Predicted Safe ${predictedSafeAddress} already exists with a different configuration.`,
        code: 'safe_config_mismatch',
      };
    }
  }

  // ... rest of the deployment logic
}
```

### B. `worker/worker.ts` - Worker Entry Point

This file requires the most significant changes to create the operator-friendly CLI. **Note**: The main worker file is `worker/worker.ts`, and new files should be created in the `worker/` directory (e.g., `worker/config.ts`).

#### **1. New Dependencies**

```bash
yarn workspace @jinn/worker add yargs zod chalk
```

#### **2. New File: `worker/config.ts`**

A dedicated file for environment variable validation using Zod.

```typescript
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars from root .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const workerConfigSchema = z.object({
  WORKER_PRIVATE_KEY: z.string().startsWith('0x'),
  CHAIN_ID: z.coerce.number().int(),
  RPC_URL: z.string().url(),
  JINN_WALLET_STORAGE_PATH: z.string().optional(), // For e2e testing override
  // Add other env vars here
});

export const config = workerConfigSchema.parse(process.env);
```

#### **3. New File: `worker/logger.ts`**

A simple logger for structured, colored output.

```typescript
// Example implementation using a library like `chalk`
import chalk from 'chalk';

export const log = {
  info: (message: string) => console.log(chalk.cyan(`[INFO] ${message}`)),
  warn: (message: string) => console.log(chalk.yellow(`[WARN] ${message}`)),
  success: (message: string) => console.log(chalk.green(`[SUCCESS] ${message}`)),
  error: (message: string) => console.error(chalk.red(`[ERROR] ${message}`)),
  fatal: (message: string) => {
    console.error(chalk.bgRed.white(`[FATAL] ${message}`));
    process.exit(1);
  },
};
```

#### **4. Refactored `worker/worker.ts`**

```typescript
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
// The package name MUST be defined in packages/wallet-manager/package.json
import { WalletManager, WalletManagerConfig } from '@jinn/wallet-manager';
import { config } from './config';
import { log } from './logger';

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('dry-run', {
      alias: 'd',
      type: 'boolean',
      description: 'Run all pre-flight checks without executing transactions.',
    })
    .option('non-interactive', {
      type: 'boolean',
      description: 'Exit if funding is required instead of polling.',
      default: false,
    })
    .parse();

  log.info(`Jinn Worker starting... ${argv.dryRun ? 'in DRY RUN mode' : ''}`);

  // 1. Pre-flight checks are implicitly handled by the Zod config import.
  // Any failure there will prevent the worker from starting.

  const walletManagerConfig: WalletManagerConfig = {
    workerPrivateKey: config.WORKER_PRIVATE_KEY,
    chainId: config.CHAIN_ID,
    rpcUrl: config.RPC_URL,
    options: {
        storageBasePath: config.JINN_WALLET_STORAGE_PATH, // Pass override to library
    },
  };

  const walletManager = new WalletManager(walletManagerConfig);

  // 2. Isolated Bootstrap Phase
  log.info('[WALLET] Initializing wallet...');
  const bootstrapResult = await walletManager.bootstrap({ dryRun: argv.dryRun });

  // 3. Handle Bootstrap Result
  switch (bootstrapResult.status) {
    case 'dry_run':
      // Print the detailed dry run report
      log.success('Dry run complete. No changes were made.');
      process.exit(0);
      break;
    case 'created':
      // Log successful creation as per the CLI spec
      log.success('[WALLET] Safe deployed successfully!');
      break;
    case 'exists':
      // Log successful verification as per the CLI spec
      log.success('[WALLET] Identity verified.');
      break;
    case 'needs_funding':
      // Handle the interactive funding loop as per the CLI spec
      log.warn('[WALLET] The owner EOA is not sufficiently funded.');
      // Print funding details...
      if (argv.nonInteractive) {
        log.info('Exiting due to --non-interactive flag.');
        process.exit(3); // Exit with specific code
      }
      // ... polling logic ...
      break;
    case 'failed':
      log.fatal(`[WALLET] Bootstrap failed: ${bootstrapResult.error}`);
      break;
  }

  log.info('Wallet bootstrap complete. Worker is now polling for jobs...');
  // 4. Start job polling loop
  // ...
}

main().catch(error => {
  // Catch Zod errors or other unexpected failures
  log.fatal(error.message);
});
```

### C. `scripts/e2e-test-rig.ts`

This is a new, standalone script for development purposes.

```typescript
import { execa, ExecaChildProcess } from 'execa';
import fs from 'fs/promises';
import path from 'path';

// Assume a simple Tenderly client is available
// import { tenderly } from './lib/tenderly';

const WORKER_SCRIPT_PATH = path.resolve(__dirname, '../worker/dist/worker.js');
const TEMP_DIR = path.resolve(__dirname, '../.tmp-e2e');

interface TestContext {
  storagePath: string;
  env: Record<string, string>;
}

async function setupTestEnv(): Promise<TestContext> {
  const storagePath = path.join(TEMP_DIR, `wallets-${Date.now()}`);
  await fs.mkdir(storagePath, { recursive: true });
  return {
    storagePath,
    env: {
      JINN_WALLET_STORAGE_PATH: storagePath,
      // Other base env vars
    },
  };
}

async function runWorker(
  env: Record<string, string>,
  args: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const workerProcess = execa('node', [WORKER_SCRIPT_PATH, ...args], {
      env,
      reject: false, // Don't throw on non-zero exit code
    });
    // Add logging for stdout/stderr here for debugging
    const result = await workerProcess;
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (e) {
    // Handle execa errors
  }
}

async function runAllTests() {
  // Test Case: Missing Private Key
  const ctx = await setupTestEnv();
  const { stdout, exitCode } = await runWorker({ ...ctx.env, WORKER_PRIVATE_KEY: '' });
  // assert(exitCode === 1);
  // assert(stdout.includes('[FATAL] WORKER_PRIVATE_KEY is not defined'));

  // ... more test cases for each assessment criterion

  await fs.rm(TEMP_DIR, { recursive: true, force: true });
}

runAllTests();
```

### D. Versioning & Exit Codes

#### **1. Versioning**

-   The changes specified for the `@jinn/wallet-manager` library (new `dry_run` status, mandatory `code` on `failed` result, etc.) are breaking changes. The package version **MUST** be bumped to `v3.0.0`.

#### **2. Worker Exit Codes**

The Jinn worker **MUST** use the following exit codes to signal its terminal state:

| Code | Status | Description |
|---|---|---|
| 0 | Success | Process completed successfully (`dry_run`, or graceful shutdown). |
| 1 | Unhandled/Fatal | A generic, unexpected, or unhandled error occurred. |
| 2 | Configuration Error | A required environment variable is missing, malformed, or invalid (`invalid_config`, `chain_id_mismatch`). |
| 3 | Funding Required | The `--non-interactive` flag was used and the EOA requires funding. |
| 4 | On-Chain Conflict | The bootstrap failed due to an irreconcilable on-chain state (`safe_config_mismatch`). |
| 5 | RPC/Network Error | A persistent `rpc_error` that could not be resolved with retries. |

## 7. Development Plan

The work is broken down into three parallelizable phases, with a final integration phase.

### Phase 1: `wallet-manager` Library Enhancements (v3.0.0) ✅ **COMPLETED**

-   **Owner**: Backend Team
-   **Objective**: Implement the core logic changes required to support the enhanced operator experience.
-   **Tasks**:
    1.  ✅ Update `package.json` version to `3.0.0`.
    2.  ✅ Implement the updated `BootstrapResult`, `DryRunReport`, and `BootstrapError` types in `src/types.ts`.
    3.  ✅ Implement the helper functions (`getOnChainSafeStateInfo`, `checkFundingStatus`) with their specified contracts.
    4.  ✅ Refactor the `bootstrap` function to accept the `dryRun` option and return a `DryRunReport`.
    5.  ✅ Integrate the stricter `safe_config_mismatch` validation logic.
    6.  ✅ Ensure all new `failed` results populate the `code` property.
    7.  🔄 Publish `v3.0.0` to the package registry.

**Success Note**: Phase 1 implementation completed successfully. All core API contracts are in place with comprehensive dry-run functionality, enhanced error handling (new `invalid_config` and `chain_id_mismatch` error codes), and stricter on-chain validation. The library now supports operator-friendly features including detailed pre-flight reporting and mandatory error codes for all failures. 

**Critical Fixes Applied**: Resolved race condition by refetching state after lock acquisition (preventing stale data decisions), fixed failing lock test by capping exponential backoff at 2 seconds, and corrected misleading operator log messages. Enhanced dry-run reports with explicit adoption vs deployment action clarity.

TypeScript compilation successful, 74/74 tests passing, zero linting errors. Ready for Phase 2 worker CLI implementation.

### Phase 2: Worker CLI Implementation ✅ **COMPLETED**

-   **Owner**: Application Team
-   **Objective**: Refactor the Jinn worker to be a robust, operator-friendly CLI application.
-   **Prerequisite**: `wallet-manager@3.0.0` API contract is finalized (implementation can be mocked).
-   **Tasks**:
    1.  ✅ Add `yargs`, `zod`, and `pino` as dependencies to the `worker` package.
    2.  ✅ Create `worker/config.ts` to handle environment variable loading and validation.
    3.  ✅ Create `worker/logger.ts` for structured console output.
    4.  ✅ Refactor `worker/worker.ts` to use the new config and logger.
    5.  ✅ Implement the CLI argument parsing for `--dry-run` and `--non-interactive`.
    6.  ✅ Build the state machine in `main()` to handle all possible `BootstrapResult` statuses from the `wallet-manager`.
    7.  ✅ Implement the funding poll loop for the `needs_funding` status.
    8.  ✅ Ensure the worker adheres to the specified exit code taxonomy.

**Implementation Note**: Phase 2 implementation completed successfully with all CLI functionality, argument parsing, state management, error handling, and operator experience requirements implemented according to specification. Key changes: replaced `chalk` with `pino` for structured logging per user requirements, implemented comprehensive exit code taxonomy (0-5), added proper configuration validation with Zod, and created operator-friendly CLI output matching specification examples. The worker now functions as a proper CLI application with `--help`, `--dry-run`, `--non-interactive`, `--debug`, `--single-job`, and `--job-id` flags. All critical issues from code review addressed including removal of emojis, fixing environment configuration, and ensuring clean dependency management.

### Phase 3: E2E Test Rig Implementation ✅ **COMPLETED (REWORKED)**

-   **Owner**: QA/Test Team
-   **Objective**: Build an automated test suite to validate all practical assessment criteria.
-   **Prerequisite**: `wallet-manager@3.0.0` API contract is finalized.
-   **Tasks**:
    1.  ✅ Create the `scripts/e2e-test-rig.ts` file.
    2.  ✅ Implement the `setupTestEnv` and `runWorker` helper functions.
    3.  ✅ Set up Tenderly API client and add helper functions for funding test wallets.
    4.  ✅ Write a test case for each scenario defined in the "Practical Assessment Criteria" section.
    5.  ✅ Ensure the test rig properly manages and cleans up temporary files and processes.
    6.  ✅ Add a new script to `package.json`: `"test:e2e": "tsx scripts/e2e-test-rig.ts"`.

**Rework Note**: Initial implementation was completed, but a formal review identified critical blockers related to build dependencies, incorrect file paths, missing test funding logic, and non-deterministic assertions. The rig was non-functional until these issues were remediated. **REWORK COMPLETED** with the following critical fixes:

- ✅ **Build Decoupling**: Worker execution now falls back to `tsx` when compiled version is unavailable, eliminating dependency on full repo build
- ✅ **Safety Isolation**: Corrected temp directory path to `/tmp/jinn-e2e-tests` as per specification
- ✅ **Dynamic Assertions**: Replaced hard-coded wallet paths with deterministic address derivation using `viem`
- ✅ **Tenderly Integration**: Fully integrated TenderlyClient into test lifecycle with proper fork management and wallet funding
- ✅ **Path Corrections**: Fixed worker script path from `dist/worker/worker.js` to correct `dist/worker.js`

The E2E test rig is now fully functional with proper isolation, safety guarantees, and comprehensive test coverage.

### Phase 4: Integration and Final Validation

-   **Owner**: All Teams
-   **Objective**: Ensure all components work together seamlessly and pass the full E2E test suite.
-   **Tasks**:
    1.  The `worker` integrates the final `wallet-manager@3.0.0` package.
    2.  Run the full E2E test suite (`yarn test:e2e`) against the integrated worker.
    3.  Manually run through the scenarios described in the "Operator Command-Line Experience" section to confirm the UX is correct.
    4.  Fix any bugs or inconsistencies found during integration testing.

## 8. Resources

-   **Primary Spec**: [Worker Wallet Bootstrapping & Identity Library](2025_08_25_worker_wallet_bootstrap_spec.md)
-   **CLI Argument Parsing**: [yargs Documentation](https://yargs.js.org/)
-   **Schema Validation**: [Zod Documentation](https://zod.dev/)
-   **Terminal Styling**: [chalk Documentation](https://github.com/chalk/chalk)
-   **Process Execution**: [execa Documentation](https://github.com/sindresorhus/execa)
-   **Blockchain Forking**: [Tenderly API Documentation](https://docs.tenderly.co/api)
