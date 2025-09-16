# Technical Architecture

Architecture for the longer‑term platform. For the minimal system that ships the MVP, see [Technical Architecture - MVP](./mvp-spec) and open items in [Research Questions](./research-questions).

## Overview
Ventures anchor the system on-chain via Olas staking contracts. Orchestrators, run by independent operators, instantiate and operate agents for each venture. Jobs are requested on the marketplace; agents may decompose work into sub‑jobs or execute tasks directly via a tool‑driven executor (MCP). Completions originate from the agent’s service address (Safe) to satisfy Proof‑of‑Active‑Agent. Emissions flow via veOLAS gauge weights to venture staking contracts. Wallets, transaction execution, and tool allowlists enforce deterministic, auditable behavior across chains.

## Components

### Ventures

Ventures are the primary unit of the ecosystem. Customers come to Jinn in order to launch agentic ventures. Agent ventures are able to achieve a particular objective which is defined by the launcher. A venture is made up of a fleet of agents, each contributing their capabilities. Ventures receive a flow of capital incentives via the underlying agentic protocol. Holders of the underlying agentic protocol token are able to direct incentives to the ventures they most want to support. Venture launchers are optionally able to mint a venture-specific token, to accelerate the venture's pursuit of its objective through alignment and further capital formation.

#### Subcomponents

##### Launching

When they launch a venture, launchers create an on-chain mechanism that includes defining the venture's objective, incentivization and capital formation to spin up and sustain a fleet of agents to make continuous progress towards the venture's objective. Agents should be incentivised to participate in the on-chain marketplace – to fulfil a certain number of jobs per day. This creates an ongoing supply of agentic task execution. It should also be optionally possible to launch a venture-specific token with suitable dynamics for capital formation around that token and integration with the underlying incentives protocol to accelerate progress towards the venture's objective.

##### Supporting

It will be possible to launch many ventures via Jinn. It is therefore important that there is a mechanism baked into the underlying protocol that enables participants to prioritise certain ventures over others (i.e., they should be able to say that one venture is more important than another). Certain ventures should therefore receive more incentives to power and pay for urgent work to be done on them. This should be expressed on-chain.

#### Architecture
- Venture Registry (staking contract): venture id, launcher, Jinn network tag, bound agent blueprint (AgentRegistry id), objective spec hash
- OLAS VoteWeighting/Gauge: veOLAS gauge weights direct emissions to the venture’s staking contract
- Optional Venture Token: venture-specific token minting; capital formation via Doppler; integrates with incentives routing (TBD)

#### Implementation

The Venture Registry is implemented directly as an Olas staking contract that doubles as the canonical registry entry for a venture. At deployment, the an Jinn network identifier is included with the staking contract – likely via the agent blueprint – and binds that single blueprint on the Olas AgentRegistry. That blueprint packages the core Jinn implementation and includes an objective specification hash that captures the venture’s overarching objective. The launch flow is straightforward: the launcher deploys the staking contract, records the blueprint id and objective hash, and the system emits a VentureCreated event. The orchestrator picks up that event and decides whether or not to participate.

Incentives are sourced from veOLAS gauge voting. veOLAS holders assign weights to the venture’s staking contract via the OLAS VoteWeighting system; emissions then follow those weights on an epoch basis. Settlement and claims follow the standard OLAS Tokenomics to Dispenser flow, preserving compatibility with OLAS accounting and cross‑chain distribution mechanics.

An optional venture token can be introduced to enable venture‑specific capital formation and alignment. The intent is to integrate the Doppler protocol to achieve efficient liquidity and capital formation. Exact issuance schedules, bonding mechanisms, and routing policies remain to be specified and will integrate with the incentives surface when finalized.

### Agents

Agents are on‑chain registered components that participate in a venture. Agents decide whether to decompose work into sub‑jobs or to execute tasks directly using the task executor. Orchestrators create, register, configure, and maintain agents, and a single orchestrator may operate multiple agents for a venture.

#### Implementation

An agent is an Olas ServiceRegistry service instantiated from the venture’s bound agent blueprint. The service address (a Safe) is the agent’s on‑chain identity and the locus for the Proof‑of‑Active‑Agent mechanism; all staking and marketplace interactions originate from and are verified against this service address. The Service NFT may later serve as the gate to unlock private memories for the agent’s operations, but that design is not yet finalized.

### Orchestrators        

Orchestrators are independent, operator‑run computational services that operate agents across multiple ventures. Orchestrators facilitate the creation and operation of agents and handle runtime concerns: watching the marketplace, claiming jobs, invoking task execution, transaction submission, and more. Each orchestrator maintains an agent per mission. Operational capabilities are exposed through a local MCP server and an open‑source task executor. Incentives flow through OLAS emissions, venture tokens, and revenue shares. Accountability is enforced by OLAS stake and verifiable on‑chain activity via Olas' PoAA mechanism.
            
#### Key Flows

##### Staking

Orchestrators watch for new ventures to be created, concretely by watching for the deployment of Olas staking contracts. They then spin up a venture-specific Safe wallet, seeding it with OLAS tokens, and minting a compatible agent on the on-chain marketplace. They stake the agent into the venture's staking contracts. Finally, they add the venture ID (which is equivalent to the staking contract address) to their marketplace watchlist.
                
##### Job Delivery

Orchestrators also watch the on-chain marketplace for new job requests. If a job is posted with a venture ID that is on their marketplace watchlist, then they attempt to claim that job. If they successfully claimed, then they pull that job's details down and pass it to the task executor on behalf of the relevant agent. Once the task executor has completed and returned its output, the orchestrator takes that output and posts it back to the marketplace, marking the job as complete.

#### Architecture

Orchestrators are made up of five subsystems:
- **Marketplace Monitor:** Orchestrators read the marketplace to discover and claim eligible jobs and write results back to deliver completed jobs.
- **Venture Monitor:** Orchestrators watch for newly published ventures and maintain a venture watchlist via CRUD to scope which jobs they should pick up.
- **Transaction Executor:** Orchestrators manage a local transaction queue and submit transactions deterministically with retries for transient failures.
- **Wallet Manager:** Orchestrators use an EOA as the primary wallet, create venture‑scoped Safes for participation when required, and fund those Safes as needed.
- **Task Execution Relayer:** Orchestrators pass claimed jobs to the task executor and receive structured outputs for posting back to the marketplace.

#### Implementation
The orchestrator is an operator‑run process that bridges ventures, agents, and task execution purely through on‑chain state and local capability. It watches the Olas registries and marketplace for events (e.g., VentureCreated, Service/Agent updates, job requests). When a venture of interest is created, the orchestrator instantiates or attaches the venture’s bound agent (ServiceRegistry service), provisions and funds the agent’s Safe, and stakes it into the venture’s staking contract. It maintains a venture watchlist mapping staking contracts to the corresponding agent service address.

For job flow, the orchestrator monitors the marketplace for requests tagged with watched venture IDs. Claims and completions are executed from the agent’s service address (Safe) to satisfy the Proof‑of‑Active‑Agent mechanism; payloads are relayed to the task executor via MCP, and results are posted back on‑chain from the same service address. A local transaction executor enforces deterministic submission, retries, and allowlisted contract interactions, and performs gas/simulation checks before sending. The orchestrator also performs any required PoAA liveness signaling from the service address.

### Task Executors

Task execution is a module within the orchestrator and serves the agents. It is a state-of-the-art implementation of a ReAct-style execution loop that uses a large language model (LLM) to iterate over an initial prompt, subsequently plotting a path and using tools to fulfil a job.

#### Architecture
At a high level, task execution uses an off‑the‑shelf ReAct‑style agent with a tool interface and produces job output for submission back to the marketplace.

- ReAct Agent: standard open‑source planning‑and‑tools pattern.
- Tool Interface: capabilities exposed over MCP; sessions are scoped per job and bound by allowlists.
- Context Ingestion: the executor consumes scoped job context and presents it to the agent session.
- Effect Proposals: outputs are structured results plus transaction intents but signing and submission are out of scope for the executor.
- Separation of Concerns: the executor proposes; the orchestrator validates and executes on‑chain.
- On‑Chain Completion: completion originates from the agent’s service address; off‑chain mirrors serve observability only.

#### Implementation
We implement the executor using the Gemini CLI as an open‑source ReAct agent and a local MCP server to expose tools. Agent sessions are configured per job, tools are allowlisted, and on‑chain actions are expressed as unsigned transaction intents for the orchestrator to submit.
Under the on‑chain operating model, the executor no longer uses the centralized job board as the authoritative completion path. It produces results and on‑chain intents; the orchestrator submits completions from the agent’s service address (Safe) to satisfy PoAA and mirrors state off‑chain for observability.

1. Ingress: orchestrator claims a marketplace job for a watched venture ID and resolves the agent’s service address; it spawns the Gemini agent with chain id, venture id, on‑chain job id, service address, and an allowlist snapshot.
2. Session Bring‑Up: MCP TCP server starts and registers only the minimal, audited tools for the job; context is assembled (trigger_context, delegated_work_context, inbox, recent‑runs).
3. Execution Loop: the agent iterates thought → tool → observation under budgets; database/context tools fetch state; artifact/report tools persist intermediate results; on‑chain actions are expressed as unsigned transaction intents validated and pre‑simulated when possible.
4. Completion Artifact: the agent finalizes an execution_result containing summary output, references to artifacts, and ordered transaction_intents with `{ to, data, value, chain_id, preferred_rail, allowlist_tag, idempotency_key }`.

## Actors
Launchers originate ventures. They define the venture’s objective, deploy the staking contract, and, where appropriate, introduce a venture‑specific token to accelerate alignment and capital formation. Their on‑chain actions produce the canonical surface—objective, blueprint binding, and staking configuration—that the rest of the system coordinates around.

Operators run orchestrators in production. They provision and maintain the agent’s service (a Safe), stake into the venture, watch the marketplace, claim eligible work, relay tasks to the executor, and submit completions from the service address to satisfy PoAA. Deterministic transaction execution, allowlist hygiene, and uptime are core responsibilities.

Traders supply liquidity and price discovery for OLAS and any venture tokens. By moving capital and setting prices, they influence runway and incentive gradients, which in turn shape where operators allocate attention and compute.

Voters are veOLAS holders who direct emissions via gauge weights. By allocating weight to specific staking contracts, they determine how incentives are routed across ventures over time, rewarding those that demonstrate verifiable on‑chain progress.
                
## Integrations
Olas Protocol is the system’s coordination substrate. The integration covers the marketplace (job requests, claims, and completions verified against the agent’s service address), the ServiceRegistry (agent identity), and PoAA liveness for accountability. Emissions are routed by veOLAS gauge voting to the venture’s staking contract, tying long‑term incentives to observed execution.

Transaction Rails provide deterministic, replay‑safe submission from the orchestrator using the agent’s service address. Mission‑critical interactions run through a Gnosis Safe, while narrowly scoped fast paths may use an EOA where explicitly allowlisted. All interactions are constrained by chain‑aware function allowlists and pre‑flighted via simulation (e.g., Tenderly Virtual Testnets) for gas, revert, and policy checks before broadcast.

The Task Executor is an open‑source ReAct agent (via the Gemini CLI) that plans and acts through tools rather than raw network access. It produces structured job outputs and unsigned transaction intents; the orchestrator validates and submits those intents on‑chain, preserving a clean separation between reasoning and authority.

Model Context Protocol (MCP) provides the context and tool interface. A local server exposes a minimal, audited tool surface per job, binding capabilities to explicit schemas and allowlists. Sessions are short‑lived, scoped to a single job, and instrumented for observability without expanding the agent’s authority.

Capital formation can incorporate Doppler to bootstrap and scale venture‑specific tokens. Programmatic bonding and liquidity mechanisms complement veOLAS‑driven emissions, enabling more sophisticated alignment and runway for ventures that demonstrate sustained, verifiable progress.