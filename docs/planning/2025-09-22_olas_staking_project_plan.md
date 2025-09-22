# Olas Staking Implementation Plan

**Date:** September 22, 2025
**Linear Project:** [Implement Olas Staking](https://linear.app/jinn-lads/project/implement-olas-staking-147a0523b807)

---

## 1. High-Level Goal

The primary objective is to enable the worker agent to automatically and programmatically stake OLAS tokens into a staking contract on the Base network. The system should operate autonomously, earning OLAS rewards for our node through this staking mechanism.

## 2. Core Requirements

### 2.1. Staking Operations
- The worker agent must be able to perform two primary actions with the staking contract:
    - **Deposit (Stake):** Send OLAS tokens to the contract to begin staking.
    - **Claim:** Claim accrued OLAS rewards from the contract.
- These operations must be fully automated within the worker-agent's existing operational loop and require no manual intervention.

### 2.2. Dual-Track Contract Strategy
This project will proceed on two parallel tracks:
- **Track 1: Integration with Existing Contract (Practical Testing)**
    - The agent will first be integrated with an existing, live staking contract on the Base blockchain. This will serve as the primary environment for development, testing, and initial deployment.
- **Track 2: Deployment of Proprietary Contract (Production Goal)**
    - In parallel, we will deploy our own proprietary staking contract. This contract should be launched, funded, and ready for our agent to use in the subsequent epoch.
    - The ABI for our proprietary contract will be identical to the existing staking contracts we integrate with.

### 2.3. Network Specificity
- All automated staking and claiming operations performed by the agent will occur exclusively on the **Base network**.
- The setup and funding of our proprietary staking contract will involve some OLAS token activity on **Ethereum Mainnet**.

### 2.4. Reward Accrual
- The end-to-end system must successfully generate OLAS staking rewards for our node.

## 3. Technical Implementation Details

### 3.1. Wallet and Transaction Execution
- All on-chain transactions (stake, claim) **must** be executed through the project's existing **Safe**, utilizing the `SafeExecutor`.
- The `EoaExecutor` should not be used for any staking-related operations.

### 3.2. Contract ABIs
- We must source the ABIs for the target staking contracts on the Base network.

### 3.3. Staking Logic
- The initial staking logic can be hard-coded. A dynamic or complex decision-making process is not required for the first iteration.
- The logic should be simple, such as staking all available OLAS in the Safe's wallet when triggered.

### 3.4. System Configuration & Monitoring
- **Transaction Monitoring:** The agent must monitor its staking and claiming transactions to confirm they are successfully mined on the Base network.
- **Environment Configuration:** The application's configuration must be updated to include:
    - The address of the target staking contract on Base.
    - RPC endpoints for the Base network.

## 4. Acceptance Criteria

### AC1: Successful Staking Operation
- **Given** the agent's Safe wallet holds a balance of OLAS on the Base network,
- **When** the staking logic is triggered,
- **Then** the agent successfully signs and dispatches a `stake` transaction via the `SafeExecutor` to the target staking contract,
- **And** the transaction is confirmed on-chain,
- **And** the staking contract's records are updated to reflect the new staked amount for the Safe.

### AC2: Successful Reward Claim Operation
- **Given** the agent's Safe has a staked position and has accrued OLAS rewards,
- **When** the reward claiming logic is triggered,
- **Then** the agent successfully signs and dispatches a `claim` transaction via the `SafeExecutor`,
- **And** the transaction is confirmed on-chain,
- **And** the OLAS balance of the Safe wallet on Base increases by the claimed amount.

### AC3: Automation within Worker Loop
- **Given** the worker agent is running its main operational loop,
- **When** conditions for staking or claiming are met,
- **Then** the corresponding operations are executed automatically without any manual user intervention.

### AC4: Exclusive Use of Safe Executor
- **Given** any staking or claiming transaction is initiated,
- **Then** the transaction is executed through the `SafeExecutor`,
- **And** logs confirm that the `EoaExecutor` was not used for the operation.

### AC5: Externalized Configuration
- **Given** the agent is initialized,
- **Then** the staking contract address and Base network RPC endpoint are loaded from a configuration file or environment variables,
- **And** these values are not hard-coded within the application's source code.

### AC6: End-to-End Test with Existing Contract (Track 1)
- **Given** a test suite is executed against a live, existing staking contract on a testnet or mainnet fork,
- **Then** an end-to-end test successfully demonstrates the agent staking OLAS and later claiming the accrued rewards.

### AC7: Proprietary Contract Deployed and Ready (Track 2)
- **Given** the project is nearing completion,
- **Then** a new proprietary staking contract is successfully deployed to the Base network,
- **And** this new contract has been funded with OLAS tokens to ensure it is operational for rewards distribution.

## 6. Implementation Specification (Revised)

This section details the technical approach to meet the acceptance criteria, incorporating critical feedback.

### 6.1. Configuration and Environment

All new configuration variables will be added to and loaded from `.env` via `env/index.ts`.

-   **Required Environment Variables**:
    -   `RPC_URL`, `CHAIN_ID`: For Base network.
    -   `OLAS_TOKEN_ADDRESS_BASE`: The OLAS ERC20 token contract address on Base.
    -   `OLAS_STAKING_PROXY_ADDRESS_BASE`: The target staking contract address on Base.
    -   `OLAS_MAINNET_RPC_URL`, `OLAS_MAINNET_CHAIN_ID`: For Ethereum Mainnet.
    -   `OLAS_DISPENSER_ADDRESS_MAINNET`: The L1 `Dispenser` contract address.
    -   `OLAS_DEPOSIT_PROCESSOR_L1_ADDRESS`: The L1 deposit processor for Base.
    -   `OLAS_CLAIM_NUM_EPOCHS`, `OLAS_BRIDGE_PAYLOAD`: Parameters for the incentive claim.
-   **Validation**: The application must validate the checksums of all provided addresses on startup to prevent configuration errors.

### 6.2. Staking and Claiming Logic (`OlasStakingManager`)

A new class, `OlasStakingManager`, will be created in `worker/OlasStakingManager.ts` to encapsulate all staking logic.

-   **Dependencies**: The class must be initialized with `SafeExecutor` instances and will reject any other executor type.

#### 6.2.1. `stakeOlas()` Method

This method orchestrates the staking of all available OLAS tokens from the Safe wallet on Base.

1.  **Idempotency Check**: Before executing, check the current OLAS balance and the current allowance granted to the `OLAS_STAKING_PROXY_ADDRESS_BASE`. If the balance is zero or the allowance is already sufficient, log and terminate.
2.  **Build MultiSend Transaction**:
    -   **Transaction 1 (Approve)**: Encode `approve(spender, amount)` for the OLAS token.
    -   **Transaction 2 (Deposit)**: Encode `deposit(amount)` for the staking proxy.
    -   These two transactions **must** be batched into a single MultiSend transaction to ensure atomicity.
3.  **Execute via Safe**: Execute the batched transaction via the Base `SafeExecutor` and wait for confirmation. Log the success, including the transaction hash.

#### 6.2.2. `claimIncentives()` Method

This method triggers the cross-chain incentive distribution from L1 Mainnet.

1.  **Encode L1 Call**:
    -   Encode `claimStakingIncentives(numClaimedEpochs, chainId, stakingTarget, bridgePayload)`.
    -   Ensure `stakingTarget` is correctly encoded as a left-padded `bytes32` from the `OLAS_STAKING_PROXY_ADDRESS_BASE`.
2.  **Execute L1 Transaction**: Execute via the **Mainnet** `SafeExecutor` and wait for confirmation.

### 6.3. Worker Integration

The `OlasStakingManager` will be integrated into the main worker process (`worker/worker.ts`), instantiated with dedicated `SafeExecutor`s for Base and Mainnet, and triggered periodically.

### 6.4. Contract ABIs

A new `/abis` directory will be created to store pinned, version-controlled copies of the required ABIs (ERC20, Staking Proxy, L1 Dispenser). ABIs must not be fetched at runtime.

### 6.5. End-to-End Testing

A new test script (`scripts/e2e-stake-test.ts`) will validate the flow.

-   **Prerequisites**: The test setup must include steps to seed the test Safe with both OLAS tokens and native gas (ETH) on Base.
-   **Verification**: Test success will be determined by listening for on-chain events (`Approval`, `Transfer`, `Deposit`) and verifying final contract/wallet balances, not just by transaction confirmation.

### 6.6. Transaction and Error Handling

-   **Lifecycle Management**: The system must robustly manage the transaction lifecycle, including submission, confirmation, and replacement logic (speed-up/cancel). It should handle transient RPC errors with a backoff-and-retry mechanism.
-   **Logging**: All staking-related operations must generate structured logs using Pino, including key details like chain, Safe address, method, amounts, and transaction hash to ensure observability.

## 7. Development Plan (Vertically Sliced)

The project will be implemented in the following slices to deliver end-to-end functionality incrementally.

### Slice 1: Configuration & ABI Setup

-   **Goal**: Prepare the environment and contract interfaces.
-   **Tasks**:
    1.  Add all required `OLAS_*` variables to the `.env` file and `env/index.ts` and validate checksummed addresses on boot.
    2.  Create a new top-level `/abis` directory.
    3.  Copy the required ABIs (ERC20, L1 Dispenser, Staking Proxy) into the `/abis` directory. Pin versions and do not fetch at runtime.

### Slice 2: Implement Core Staking Logic

-   **Goal**: Create the `OlasStakingManager` and implement the primary `stakeOlas` functionality.
-   **Tasks**:
    1.  Create `worker/OlasStakingManager.ts`.
    2.  Implement the class constructor to accept `SafeExecutor` instances, rejecting any other executor type.
    3.  Implement the `stakeOlas()` method, including idempotency checks (balance, allowance). It must batch `approve` and `deposit` into a single MultiSend transaction via the Base `SafeExecutor`.

### Slice 3: Worker Integration

-   **Goal**: Automate the staking logic within the main worker loop.
-   **Tasks**:
    1.  In `worker/worker.ts`, initialize the Base and Mainnet `SafeExecutor`s.
    2.  Instantiate `OlasStakingManager`.
    3.  Add a timed trigger in the `JobProcessor` loop to call `stakeOlas()` periodically.

### Slice 4: End-to-End Staking Test

-   **Goal**: Verify the complete staking flow on a live network.
-   **Tasks**:
    1.  Create the `scripts/e2e-stake-test.ts` script.
    2.  Add test prerequisites: seeding the Safe wallet with OLAS and gas tokens.
    3.  Implement the test logic to initialize, execute `stakeOlas()`, and verify success by listening for the relevant on-chain events and confirming balance changes.
    4.  Execute the test against a configured testnet/fork to satisfy AC6.

### Slice 5: Incentive Claiming

-   **Goal**: Implement the L1 incentive claiming mechanism.
-   **Tasks**:
    1.  Implement the `claimIncentives()` method in `OlasStakingManager`, ensuring correct parameter encoding (`stakingTarget` as left-padded `bytes32`) and executing the transaction via the Mainnet `SafeExecutor`.
    2.  Add a separate timed trigger in the `JobProcessor` to call `claimIncentives()` periodically.
    3.  Manually test the L1 transaction and observe the `StakingIncentivesClaimed` and `StakingTargetDeposited` events to satisfy AC2.

### Slice 6: Proprietary Contract Deployment (Track 2)

-   **Goal**: Deploy and prepare the project's own staking contract.
-   **Tasks**:
    1.  Deploy the proprietary staking contract to the Base network.
    2.  Fund the new contract with OLAS tokens.
    3.  Update the `.env` configuration to point `OLAS_STAKING_PROXY_ADDRESS_BASE` to the new contract address to complete AC7.

## 5. Context from Code Resources (Revised)

### 5.1. Autonolas Tokenomics (code-resources/autonolas-tokenomics)

-   **Core Staking-Related Contracts**:
    -   `contracts/Dispenser.sol`: The L1 contract responsible for distributing incentives. The key function is `claimStakingIncentives`, which triggers the cross-chain deposit flow.
    -   `contracts/staking/*`: A suite of cross-chain contracts for routing deposits from L1 to L2. `DefaultDepositProcessorL1.sol` and `DefaultTargetDispenserL2.sol` provide the generic mechanism for bridging incentives to an L2 staking target.
    -   `contracts/Treasury.sol` and `contracts/Tokenomics.sol`: Central to the OLAS economy but not directly interacted with for staking operations.
-   **ABIs**: The `abis/` directory, particularly version `0.8.25`, contains the necessary `Dispenser.json`, `DefaultDepositProcessorL1.json`, and `DefaultTargetDispenserL2.json` ABIs. An ERC20 ABI for OLAS is also available.

### 5.2. Olas Operate Middleware (code-resources/olas-operate-middleware)

-   **Execution Primitives**:
    -   The middleware provides a `SafeTxBuilder` (`operate/services/protocol.py`) which is the foundation for creating and executing transactions through a Gnosis Safe. This aligns with the project's `SafeExecutor`-only requirement. The existing `olas-operate-middleware` demonstrates patterns for interacting with contracts via a Safe, which should be adapted.
-   **Base Network Coverage** (`operate/ledger/profiles.py`):
    -   This file serves as a canonical source for on-chain constants. It provides the **OLAS token address on Base** (`0x54330d28ca3357F294334BDC454a032e7f353416`) and a list of known staking program addresses on Base which can be used as targets for `OLAS_STAKING_PROXY_ADDRESS_BASE`.

### 5.3. Practical Implications for this Implementation

-   **Staking Model**: The implementation must focus exclusively on the **OLAS token staking** flow: `ERC20.approve(stakingProxy, amount)` followed by `stakingProxy.deposit(amount)`. All context related to service staking (`stake(serviceId)`) from the middleware is irrelevant and must be ignored.
-   **Execution**: The `SafeExecutor` is the correct tool for this task, and its transactions should be constructed to be compatible with the Gnosis Safe contracts. The use of **MultiSend** for batching `approve` and `deposit` is critical.
-   **Configuration**: The on-chain addresses for the OLAS token and known staking proxies can be sourced from the middleware's profile definitions, providing a reliable starting point.
