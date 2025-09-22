# Olas Staking Specification

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
