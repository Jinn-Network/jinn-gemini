# Decentralisation Exploration

Date: August 21, 2025

## Context

We want to be decentralising the cost and operations of large scale agent organisations to 1000s of nodes. Nodes make up the current worker, some database operations, wallet management etc.

It's important to recognise the shift in regulation around crypto tokens. The GENIUS act was recently put in place. CLARITY act looking strong. Extremely pro-crypto SEC.

## Implementation Sketch

- operators run workers
- operators run workers because they can earn OLAS rewards through staking
- workers are effectively packaged into nodes. Nodes contain the worker, the agent CLI, a set of MCP tools, a wallet with some funds, 
- an Olas staking contract rewards workers for fulfilling a certain number of jobs
- for individual nodes, much of the existing data and functionality still persists via a Supabase/Postgres setup
- there should be some way for agents to take collective action – i.e. making proposals and voting on on-chain actions like disbursing the treasury, updating DAO parameters etc.

### Tokenomics
- worker stakes on Base
- staking rewards accumulate
- worker claims rewards once a month
    - voting
        - bridges a % to Ethereum
        - locks OLAS for 3 months
        - votes for its staking contract
    - ops
        - sells enough to OLAS into stablecoin to cover costs from previous month

### Wallet Mangement
- tempting to just use an EOA (maybe with new smart account features?)
- I think Olas might require it to be a multi-sig for staking though – must check

### On-Chain Job Fulfilment via Olas Marketplace

To provide on-chain verifiability of agent activity, all jobs will be posted to and fulfilled via the Olas Marketplace. This ensures that the work done by Jinn agents is transparent and contributes to the broader Olas ecosystem, even when the tasks could be executed internally. This approach leverages the existing infrastructure of the marketplace for job discovery, negotiation, and settlement.

### Integration with Olas Marketplace

The primary mechanism for decentralised operation will be a direct integration with the Olas Marketplace. We will assume the existence of a robust client library (e.g., a TypeScript/JavaScript SDK) provided by the Eolas team to facilitate this interaction.

#### Key Implementation Steps:

1.  **Library Integration:**
    - The Jinn agent's toolset will be extended with a new set of tools built on top of the Olas Marketplace library.
    - These tools will encapsulate the core marketplace functions: creating job postings, searching for available jobs, bidding on jobs, and settling completed work.

2.  **Agent Logic for Marketplace Interaction:**
    - Agents will be programmed with a new core competency: to function as marketplace participants.
    - **Job Creation:** When a Jinn agent needs to delegate a task, it will use a tool to format and publish a job on the marketplace, specifying the requirements, criteria for success, and offered reward.
    - **Job Tendering:** Jinn agents will also actively monitor the marketplace for jobs they are qualified to perform. They will be able to analyze job requirements, assess their own capabilities, and submit bids.
    - **Settlement:** Upon completion of a job, the agent will use a tool to submit the results and trigger the on-chain settlement process through the Olas contracts.

3.  **Wallet and Gas Management:**
    - Each agent node will manage its own wallet to pay for transaction fees and stake OLAS.
    - The agent's operational logic must include strategies for managing its gas budget and ensuring it has sufficient funds to participate in the marketplace.

---

## Appendix

### Possible Future Direction: A2A-based Settlement

While our primary strategy is to leverage the Olas Marketplace, an alternative or complementary approach for high-frequency, data-intensive interactions is an Agent-to-Agent (A2A) protocol. This model moves most communication off-chain while retaining on-chain settlement for verifiability.

#### Core Principles:
- **Off-Chain Negotiation:** All job discovery, negotiation of terms, and multi-turn communication happens peer-to-peer between agents using the A2A protocol. This is fast, private, and gas-free.
- **On-Chain Settlement:** The final agreement is committed to the blockchain using a specialized escrow contract. This provides an immutable, verifiable record of the transaction's outcome without storing the full job details on-chain.

#### Sketch of Implementation Steps:

1.  **Extend On-Chain Registry for A2A Discovery:**
    - The existing Olas `AgentRegistry` and `ServiceRegistry` can be leveraged.
    - **Action:** Add a field to the agent/service registration data structure for a URI pointing to an off-chain A2A `AgentCard`. This `AgentCard` (a JSON file) contains the agent's capabilities, skills, and A2A endpoint information.

2.  **Develop On-Chain Escrow Factory:**
    - The on-chain settlement mechanism will be a `ConditionalEscrow` contract.
    - **Action:** Implement a `ConditionalEscrowFactory` contract. This factory will deploy a new, isolated `ConditionalEscrow` instance for each individual deal.
    - The escrow contract instance will store only the minimal data required for settlement:
        - The addresses of the buyer and seller agents.
        - A cryptographic hash (`taskHash`) of the off-chain A2A `Task` object, serving as an immutable commitment to the agreed terms.
        - The value and token type held in escrow.
        - A simple state machine (e.g., `Funded`, `Completed`, `Settled`, `Disputed`).
    - **Action:** Design and implement a dispute resolution mechanism. A first-pass implementation could use a designated arbiter address that can resolve the escrow's final state.

3.  **Integrate Lifecycle into Agent Logic:**
    - **Action:** Update the agent's core operational logic to support the hybrid flow:
        1.  **Discover:** Query the on-chain registry to find potential agents and retrieve their `AgentCard` URIs.
        2.  **Negotiate:** Fetch the `AgentCard` and use the A2A protocol to negotiate the job details directly with the other agent.
        3.  **Commit:** Once terms are agreed, one of the agents calls the on-chain `ConditionalEscrowFactory` to create the escrow contract and lock the funds.
        4.  **Settle:** Upon task completion, agents interact with their specific escrow contract instance to signal completion and release funds.

#### Future Enhancements for A2A

**Trust-Minimized Verification with ZKPs**
- While not required for initial implementation, Zero-Knowledge Proofs (ZKPs) offer a path to remove trust assumptions almost entirely.
- The seller agent would generate a cryptographic proof of computation for the completed task.
- The `ConditionalEscrow` contract's condition for releasing funds would become the successful on-chain verification of this proof, transitioning settlement from a subjective buyer approval to an objective, mathematical certainty. This would require tasks to be defined as provable programs. 

---

## Integration Plan for Olas

Based on the architecture of Olas, the integration of Jinn services will proceed in a phased approach, building from fundamental on-chain identity to full economic participation. The order is critical due to on-chain dependencies.

### 1. Wallet Management with Gnosis Safe SDK

*   **Objective**: Establish a secure, on-chain identity for each Jinn service.
*   **Rationale**: Olas services are multi-operator and require a multisig wallet. Gnosis Safe is the industry standard and provides the necessary security and flexibility. This is the foundational step upon which all other interactions depend.
*   **Key Action**: Implement wallet creation and management logic using the Gnosis Safe SDK.

### 2. Integration with the Olas Marketplace

*   **Objective**: Register and manage the lifecycle of Jinn services on the Olas network.
*   **Rationale**: For a service to be discoverable, receive work, and earn rewards, it must be registered in the `ServiceRegistry`. This phase connects our off-chain services to the on-chain marketplace.
*   **Key Actions**:
    *   Interact with the `ServiceRegistry` contract.
    *   Manage service state transitions (e.g., `Pre-Registration`, `Active`, `Terminated Bonded`).

### 3. Integration with Olas Staking

*   **Objective**: Enable Jinn services to participate in the Olas economy and earn emissions.
*   **Rationale**: Staking is the mechanism by which services become economically productive and aligned with the network. It allows services to be eligible for OLAS token emissions as directed by veOLAS governance.
*   **Key Actions**:
    *   Integrate with the Olas staking contracts.
    *   Manage staking and unstaking operations for the service.

### 4. Tokenomics and Reward Handling

*   **Objective**: Claim and manage the economic rewards earned by the service.
*   **Rationale**: After a service is operational and staked, it will accrue rewards. This final phase involves building the logic to claim these rewards and manage the service's treasury.
*   **Key Actions**:
    *   Interact with the `Dispenser` contract to claim accrued OLAS rewards.
    *   Implement logic for managing the service's funds.

This phased approach ensures that each layer of functionality is built on a solid, working foundation, minimizing complexity and risk. The next step is to detail the implementation plan for Phase 1: Wallet Management. 