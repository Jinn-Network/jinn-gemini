# Olas Staking Implementation Plan (Revised)

**Date:** September 23, 2025
**Linear Project:** [Implement Olas Staking](https://linear.app/jinn-lads/project/implement-olas-staking-147a0523b807)

---

## 1. High-Level Goal

The primary objective is to enable the worker agent to automatically and programmatically create, register, and stake an **Olas service** on the Base network. The system must manage the entire service lifecycle to earn OLAS rewards for our node through the protocol's service staking mechanism.

## 2. Core Requirements

### 2.1. Service Lifecycle and Staking Operations
- The worker agent must be able to perform the full lifecycle of service management:
    - **Agent Registration:** Ensure an agent is registered in the `AgentRegistry`.
    - **Service Creation & Registration:** Create and register a new service in the `ServiceRegistry`, receiving a service NFT.
    - **Service Activation:** Provide the necessary security deposit (bond) to activate the service.
    - **Staking:** Stake the service NFT in a designated staking contract.
    - **Claiming:** Claim accrued OLAS rewards from the staking contract.
- These operations must be fully automated within the worker-agent's existing operational loop.

### 2.2. Dual-Track Contract Strategy
This project will proceed on two parallel tracks:
- **Track 1: Integration with Existing Contract (Practical Testing)**
    - The agent will first be integrated with an existing, live staking contract on the Base blockchain. This will serve as the primary environment for development and testing.
- **Track 2: Deployment of Proprietary Contract (Production Goal)**
    - In parallel, we will deploy our own proprietary staking contract. This contract should be launched, funded, and ready for our agent to use in the subsequent epoch.
    - The ABI for our proprietary contract will be identical to the existing staking contracts we integrate with.

### 2.3. Network Specificity
- All automated service management and staking operations will occur exclusively on the **Base network**.
- The setup and funding of our proprietary staking contract will involve some OLAS token activity on **Ethereum Mainnet**.

### 2.4. Reward Accrual
- The end-to-end system must successfully generate OLAS staking rewards for our node by maintaining an active, staked service.

## 3. Technical Implementation Details

### 3.1. Wallet and Transaction Execution
- The `olas-operate-middleware` will create and manage a **Safe** during the service creation process, which is controlled by our worker's EOA.
- All service-related on-chain transactions (agent registration, service creation, staking) will be executed through this middleware-managed Safe.
- The existing marketplace interaction system can continue to use the Safe created by the middleware for its transactions.

### 3.2. Leverage `olas-operate-middleware` via Git Submodule
- To ensure version stability and a clear upgrade path, the `olas-operate-middleware` repository will be integrated as a **Git submodule**.
- This approach pins our project to a specific commit of the middleware, preventing unexpected breakages from upstream changes.
- The worker will execute the middleware's CLI (`operate`) as a **child process** from within the submodule directory.

### 3.3. Service and Staking Logic
- The worker will follow a stateful, sequential process:
    1.  **Compatibility Check**: Before any action, determine the required `agent_id` for the target staking contract.
    2.  **Service Management**:
        - Check for the existence of a managed, compatible service NFT in the Safe's wallet.
        - If no service exists, create one:
            - Ensure the required agent is registered in the `AgentRegistry`.
            - Create and register the service in the `ServiceRegistry`, receiving the service NFT.
    3.  **Activation**: Once the service NFT is owned, activate it by providing the required **minimum staking deposit**.
    4.  **Staking**: Stake the active service NFT into the target staking contract using the middleware's `stake` command.
- **Note on Proprietary Contract**: When the proprietary staking contract is deployed (Track 2), a corresponding proprietary agent will need to be created and registered first.

### 3.4. System Configuration & Monitoring
- **Transaction Monitoring:** The agent must monitor all its transactions (agent/service registration, activation, staking, claiming) to confirm they are successfully mined on the Base network.
- **Environment Configuration:** The application's configuration must be updated to include addresses for:
    - `AgentRegistry` on Base.
    - `ServiceRegistry` on Base.
    - The target staking contract on Base.
    - RPC endpoints for the Base network.

## 4. Acceptance Criteria

### AC1: Successful Service Creation and Registration
- **Given** the agent's Safe wallet has an OLAS balance,
- **When** the service management logic is triggered,
- **Then** the agent ensures an agent is registered, creates a new service, and registers it with the `ServiceRegistry`,
- **And** the Safe wallet receives the corresponding service NFT.

### AC2: Successful Service Staking Operation
- **Given** the agent's Safe owns an active service NFT,
- **When** the staking logic is triggered,
- **Then** the agent successfully signs and dispatches a `stake` transaction via the `SafeExecutor` to the target staking contract, referencing the `service_id`,
- **And** the transaction is confirmed on-chain.

### AC3: Successful Reward Claim Operation
- **Given** the agent has a staked service that has accrued rewards,
- **When** the reward claiming logic is triggered,
- **Then** the agent successfully dispatches a `claim` transaction via the `SafeExecutor`,
- **And** the OLAS balance of the Safe wallet on Base increases.

### AC4: Automation within Worker Loop
- **Given** the worker agent is running its main operational loop,
- **When** conditions for any lifecycle step (create, register, activate, stake, claim) are met,
- **Then** the corresponding operations are executed automatically without manual intervention.

### AC5: Safe Management via Middleware
- **Given** any service or staking transaction is initiated,
- **Then** it is executed through the Safe created and managed by the `olas-operate-middleware`.

### AC6: Externalized Configuration
- **Given** the agent is initialized,
- **Then** all required contract addresses and the Base network RPC endpoint are loaded from configuration, not hard-coded.

---

## 6. Implementation Specification (Revised)

This section details the technical approach, now centered on using the `olas-operate-middleware`.

### 6.1. Configuration and Environment
- All new configuration variables will be added to and loaded from `.env` via `env/index.ts`.
- **Required Environment Variables**:
    - `RPC_URL`, `CHAIN_ID`: For Base network.
    - `OLAS_AGENT_REGISTRY_ADDRESS_BASE`: The `AgentRegistry` contract address.
    - `OLAS_SERVICE_REGISTRY_ADDRESS_BASE`: The `ServiceRegistry` contract address.
    - `OLAS_STAKING_CONTRACT_ADDRESS_BASE`: The target staking contract address.

### 6.2. Service & Staking Logic (`OlasServiceManager`)
A new class, `OlasServiceManager`, will be created in `worker/OlasServiceManager.ts` to encapsulate all service lifecycle and staking logic. This class will act as a TypeScript wrapper around the Python-based `olas-operate-middleware`.

- **Dependencies**: The class will be initialized with the worker's EOA private key and will use the `OlasOperateWrapper` for middleware interactions.
- **Core Logic**: It will orchestrate calls to the middleware's CLI to perform:
    1.  `setup_user_account()` - Set up operate middleware user account
    2.  `create_wallet()` - Create wallet in middleware  
    3.  `create_safe()` - Deploy Safe controlled by worker's EOA
    4.  `agent.register()` - Register agent in AgentRegistry
    5.  `service.create()` - Create and register service, receiving service NFT
    6.  `service.activate()` - Activate service with required deposit
    7.  `service.stake()` - Stake service NFT in staking contract
    8.  `service.claim()` - Claim accrued rewards

### 6.3. Worker Integration
- The `OlasServiceManager` will be integrated into the main worker process (`worker/worker.ts`), instantiated with a dedicated `SafeExecutor` for Base, and triggered periodically to check and advance the service's state.

### 6.4. End-to-End Testing
- A new test script (`scripts/e2e-service-stake-test.ts`) will validate the entire flow from service creation to staking and claiming.
- **Verification**: Test success will be determined by querying the on-chain state of the registries and staking contract, not just by transaction confirmation.

## 7. Development Plan

### Slice 1: Middleware Integration & Configuration
- **Goal**: Integrate the `olas-operate-middleware` as a version-controlled submodule.
- **Tasks**:
    1.  Add the `valory-xyz/olas-operate-middleware` repository as a Git submodule to the project.
    2.  Create a TypeScript wrapper/utility to reliably execute the `operate` CLI from the submodule path as a child process and parse its output.
    3.  Add required `OLAS_*` registry and staking contract addresses to `.env` and `env/index.ts`.

### Slice 2: Implement Service Creation and Registration
- **Goal**: Create the `OlasServiceManager` and implement the initial service setup logic.
- **Tasks**:
    1.  Create `worker/OlasServiceManager.ts`.
    2.  Implement methods that use the CLI wrapper to handle agent registration and service creation/registration, ensuring the correct `agent_id` is used based on the staking contract.
    3.  Implement logic to check if a compatible service already exists for the Safe.

### Slice 3: Implement Service Activation and Staking
- **Goal**: Add staking capabilities to the manager.
- **Tasks**:
    1.  Implement methods in `OlasServiceManager` that call the middleware to handle service activation (providing the minimum staking deposit) and staking.
    2.  Ensure the logic correctly passes the `service_id` to the staking function.

### Slice 4: Worker Integration and Automation
- **Goal**: Automate the entire service lifecycle in the worker.
- **Tasks**:
    1.  In `worker/worker.ts`, instantiate the `OlasServiceManager`.
    2.  Add a timed trigger in the main loop that calls the manager. The manager should contain the state machine logic to progress the service from creation to staking.

### Slice 5: Mech Contract Deployment
- **Goal**: Deploy the Mech contract via the marketplace to enable requests and deliveries.
- **Tasks**:
    1.  Implement a `deployMech()` method in `OlasServiceManager` that calls the middleware's logic for mech creation.
    2.  Ensure the method captures and stores the resulting mech contract address and agent ID.
    3.  Update the worker's state machine to call this method after a service is successfully staked.

### Slice 6: Incentive Claiming & E2E Test
- **Goal**: Implement reward claiming and verify the complete flow.
- **Tasks**:
    1.  Implement a `claimIncentives()` method in `OlasServiceManager`.
    2.  Create the `scripts/e2e-service-stake-test.ts` script to test the full lifecycle: create -> register -> activate -> stake -> **deploy-mech** -> claim.
    3.  Execute the test against a configured testnet/fork.

## 5. Context from Code Resources (Revised)

### 5.1. Autonolas Tokenomics (`autonolas-tokenomics`)
- **Core Contracts**: The key contracts are now understood to be `ServiceRegistry.sol`, `AgentRegistry.sol`, and `Tokenomics.sol`, which governs the incentive and bonding mechanisms. The staking process is intrinsically linked to the lifecycle of a service registered in these contracts.
- **Staking Model**: The staking model is "service staking," not "token staking." It involves depositing a service NFT and providing a **minimum staking deposit** to activate, not just bonding ERC20 tokens.

### 5.2. Olas Operate Middleware (`olas-operate-middleware`)
- **The Correct Tool for the Job**: This middleware is the canonical client for interacting with the Olas protocol. It is an application that must be executed as a child process.
- **Key Primitives**:
    - `operate/services/protocol.py`: Contains the `StakingManager`, which is the central class for all staking operations. Its methods, like `stake(service_id: int, ...)` and `unstake(service_id: int, ...)` are service-centric and must be used.
    - `operate/quickstart/`: This directory contains example scripts (`run_service.py`, `reset_staking.py`) that demonstrate the correct, end-to-end user workflows for service management and staking. These should be used as a reference for our implementation.
- **Conclusion**: The implementation must be a wrapper around this middleware's CLI. A custom implementation of the staking logic is unnecessary and would likely be incorrect.
