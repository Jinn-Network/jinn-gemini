# Proposal — Tokenomics‑First Transition for Jinn (Discussion Draft)

> **Status:** Discussion draft — alternatives welcome. This is a starting point to invite feedback; not a final plan.
> *Why this doc focuses on tokenomics now:* The incentive choices we make determine which tokens belong in the marketplace, how value flows (worker payout / protocol share / mission sink), and which minimal on‑chain hooks we actually need—so this discussion must precede any architectural plan.

We propose evaluating Jinn’s path toward blockchain‑native mechanics **through tokenomics first**. From our exploration so far, architecture is secondary; durable value comes from **incentives** that reward real work, prioritize scarce attention, and create healthy sinks/liquidity. Once the token loop is agreed, the minimal on‑chain components follow naturally.

---

## Why Tokenomics First

* The incentive choices we make determine **which tokens belong in the marketplace**, **how value flows**, and **which minimal on‑chain hooks** we actually need—so this discussion must come before any architectural plan.
* Aligns spend with demand (lightweight “surge” for strong missions; affordability for early ones).
* Creates **real token utility** (job volume → buy‑and‑burn or add liquidity) rather than pure speculation.
* Pulls worker attention to **proven demand** while keeping marketplace budgets predictable (single stable).

---

## How We Arrived Here (Initial Exploration)

* Mapped the existing event‑driven system to on‑chain analogues (events → transactions, triggers → contracts, workers → executors).
* Compared DApp vs. appchain approaches and concluded **incentives drive the design** more than base architecture.
* Identified a **single‑stable marketplace with mission‑token sinks** as a simple, scorable value loop.
* Considered a **small, value‑based pricing multiplier** to align sponsor spend with demand.
* Recognized **staking** as a work‑based subsidy/participation mechanism, with flexible staking assets (single‑asset, LP, or a master pool).

---

## The Tokenomics Proposal (High Level)

### Launchpad / Missions

* Each mission launches a **mission token** via a **bonding curve** (or similar), avoiding upfront liquidity.
* On sufficient demand, the token **graduates to a liquidity pool** automatically (e.g., via CreatorBid or a Doppler‑based flow).
* Mission tokens may **influence marketplace pricing** with a **small multiplier** based on the mission token’s market value once eligible.

### Marketplace (Single Stable Asset)

* All job settlement uses **one stable** (e.g., **USDe**).
* **Job price** is a **base in the stable** with a **small multiplier** informed by the eligible mission token’s market value.
* Every transaction **splits three ways**: **Worker payout** (bulk), **Protocol share** (Jinn), **Mission sink** (buy‑and‑burn or add liquidity for that mission token).

### Worker Loop & Staking

* Workers are paid in the **stable** and fund any downstream jobs they spawn in the **same stable** (implying working‑capital needs in the stable).
* A **single staking program** pays workers **OLAS** for verified activity (e.g., accepted jobs per period); stricter penalties can be added later. One contract is sufficient initially (separate per‑mission staking is not required).
* **Staking asset options** may include **JINN**, **JINN–OLAS LP**, or a **master liquidity pool** (JINN plus a basket of ecosystem tokens) so staking also deepens ecosystem liquidity.

# Minimal On‑Chain Spec — Jinn Tokenomics Backbone (DB‑First)

**Intent**
Stand up the smallest set of on‑chain pieces required to make the proposed tokenomics work (launchpad, marketplace split, staking) while **keeping our current database as the primary system of record**. Everything heavy (job specs, artifacts, prompts, traces) stays in Supabase; the chain anchors identity, payments, and staking signals.

---

## Scope (what we will build on‑chain)

1. **Token Launch Wrapper** — a thin `JinnTokenFactory` that calls **Doppler** to create mission tokens (bonding curve → LP graduation) and emits addresses we store in DB.
2. **Forked Mech Marketplace (preferred)** — a friendly fork of the Mech Marketplace that enforces the **three‑way split (worker / protocol / mission sink)** and preserves Mech compatibility; as an interim fallback, a minimal `JinnRouter` can proxy requests.
3. **Staking (JINN)** — configure an **Olas PoAA staking program** that accepts **JINN** (ERC‑20) or a JINN LP token as the stake asset , keyed by **Mech contract address** as the worker identity.&#x20;

> We do **not** rebuild a marketplace or data layer. We only add hooks to make the tokenomics loop real and observable.

---

## Contract 1 — JinnTokenFactory (Doppler wrapper)

**Purpose:** Launch mission tokens via Doppler and surface the new addresses to our DB.

**Key behaviors**

* Calls Doppler factory with mission params (name/symbol, bonding‑curve config, governance mode, treasury recipient).
* Registers Doppler’s built‑in auto‑graduation so liquidity is created when demand thresholds are met; we index the graduation/migration events for the DB.
* Emits a canonical event we index:

```solidity
event MissionLaunched(
  bytes32 indexed projectRef,   // our DB project identifier (opaque string/bytes32)
  uint256 indexed chainId,
  address token,                // ERC‑20 mission token
  address pool,                 // bonding curve / initial pool (if available)
  bytes32 dopplerVersion,
  bytes extra                   // optional: module set, creation params
);
```

**DB impact (Projects table)**

* `chain_id`
* `token_address`
* `pool_address` (nullable until graduation)
* `doppler_version`
* `creation_tx_hash`

**Notes**

* We **do not** mirror Doppler state on‑chain; the DB stores references and integrity hashes where needed.

---

## Contract 2 — Friendly Fork Marketplace (fees/sinks)

**Purpose:** Make Jinn the canonical posting surface while preserving Mech compatibility and PoAA rewards. The forked marketplace enforces the **three‑way split (worker / protocol / mission sink)** and emits the same request/delivery semantics so existing Mechs continue to operate.

**Responsibilities (only these)**

* **Receive sponsor payment** in the single stable (e.g., USDe) for a given job.
* **Apply the split:**

  * transfer **Worker portion** → fund the underlying Mech request (or escrow until delivery, per policy)
  * transfer **Protocol share** → Jinn treasury
  * execute **Mission sink** → buy & burn the mission token **or** add POL
* **Create a Mech‑compatible request** that references the DB job (public `job_ref` or HMAC), and store the on‑chain `requestId`.
* **Emit link event** our indexer consumes:

```solidity
event Request(
  address indexed mech,           // Mech contract (worker identity)
  bytes32 indexed requestId,      // Mech request identifier
  bytes32 indexed jobRef,         // our DB job reference (non‑sensitive)
  address paymentToken,           // stable used
  address missionToken            // for sink routing
);
```

* **(Optional) Delivery ack:** expose `confirmDelivery(bytes32 requestId)` or mirror Mech delivery events to record finalization.

**Guards**

* Only allow **registered mechs** (workers) and the **approved stable**.
* Revert if the sink action fails (atomicity: either full post + sink + fee, or nothing).

**DB impact (Job Board)**
Add the following columns (illustrative names):

* `worker_mech_address` (address)
* `chain_id` (int)
* `payment_token` (address)
* `request_id` (bytes32)
* `request_cid` (text; IPFS CID if used)
* `posted_tx_hash` (text)
* `delivered_tx_hash` (text)
* `status` **ENUM**: `DRAFT → PENDING_ONCHAIN → VERIFIED → DELIVERED → SETTLED → FAILED`

**Sinks ledger (new table)**

* `job_id`, `mission_token`, `action` (BURN|LP), `amount_in_stable`, `amount_out_token`, `tx_hash`, `timestamp`.

**Bypass prevention (policy, not heavy code)**

* This fork is the canonical posting path for Jinn jobs; workers agree to process **Jinn‑signed** requests.
* Marketplace signature embedded in request payload; mechs verify before acting (cheap check).

**Alternative (fallback): Router**

* If we defer the fork initially, a minimal `JinnRouter` can proxy requests to the original Mech Marketplace while applying the same split, events, and guards.

## Contract 3 — Staking (Olas PoAA with JINN)

**Purpose:** Let workers stake **JINN** and earn **OLAS** for active work, keyed to their **Mech** address.

**Approach**

* Use Olas’ **ERC‑20 staking program** configured with `stakingToken = JINN`.
* **Identity:** stake **from the Mech address** if it can hold/approve ERC‑20; otherwise add a tiny `JinnMechRegistry` that binds `staker → mech` and require a signed bind.
* Rewards flow is handled by Olas PoAA; our addition is just the accepted **stake asset** (JINN) and identity binding.

**Events to count (from chain, no DB coupling required)**

* Mech **Request** and **Delivery** events (activity window)
* Staking **Staked / Unstaked** events (for dashboards)

**Optional DB cache (for UX only)**

* `staker_address`, `mech_address`, `staked_amount`, `last_epoch_rewards` (display‑only; canonical state is on‑chain).

---

## End‑to‑End Flows (happy path)

### A) Mission launch

1. Create project in DB (`project_id`).
2. Call `JinnTokenFactory.launch(projectRef, params)` → Doppler deploys token (and curve/pool).
3. Index `MissionLaunched` → upsert `token_address`, `pool_address`, `doppler_version`, `creation_tx_hash`.

### B) Post job (verify on‑chain)

1. Insert job → `status=PENDING_ONCHAIN`.
2. Sponsor posts the job via the **Forked Mech Marketplace** with the approved stable and `job_ref`.
3. Marketplace applies the **three‑way split** (worker / protocol / mission sink), creates the Mech‑compatible request, and emits `Request`.
4. Indexer writes `request_id`, `posted_tx_hash`, sets `status=VERIFIED`.

### C) Deliver & settle

1. Worker completes off‑chain; Mech **delivers** on‑chain.
2. Listener maps `requestId → job_ref` → update `status=DELIVERED`, store `delivered_tx_hash`, persist artifact pointers.
3. If any final payout/escrow step is used, router (or cron) executes it; set `status=SETTLED`.

---

## Minimal DB Changes (summary)

* **projects**: `chain_id`, `token_address`, `pool_address` (nullable), `doppler_version`, `creation_tx_hash`.
* **job\_board**: `worker_mech_address`, `chain_id`, `payment_token`, `request_id`, `request_cid`, `posted_tx_hash`, `delivered_tx_hash`, `status` enum.
* **sinks\_ledger** (new): per‑job record of buy‑and‑burn / LP adds.

> Everything else (job specs, prompts, artifacts, traces) remains exactly as today.

---

## Non‑Goals / Out of Scope (for MVP)

* Dispute windows/auctions; advanced assignment logic.
* On‑chain data storage of specs/artifacts; we only store hashes/CIDs where needed.
* Per‑mission staking contracts (one global staking program is enough).

---

## Open Questions (to discuss, still high‑level)

* **Graduation trigger:** What high‑level condition moves a mission from bonding curve to LP?
* **Sink destination:** Fixed split vs. mission‑selectable (burn vs. POL)?
* **Bypass policy:** Signature check only, or also economic disincentives for off‑router posts?
* **Identity binding:** Require Mech‑address staking, or allow operator‑address with a registry bind?

---

**Result:** We gain token launches (Doppler), fee/sink enforcement (Router), and staking (Olas PoAA with JINN) with **minimal DB changes** and without rebuilding our pipeline. The chain tracks identity, payment, and staking; the database keeps doing everything else.


---

## Discussion Prompts (Problem‑Focused; Alternatives Welcome)

These prompts surface alternatives and critiques, not a single design.

### Incentivization & Value Flows

* What behaviors do we most want to **reward** (throughput, quality, liveness, coverage) and **discourage** (spam, low‑effort posts)?
* How should the **mission sink** be directed in principle (burn vs. add liquidity), and when should each be preferred?
* Is there sufficient room for \*\*degens to have fun? \*\*

### Tokens & Payments

* Which **settlement token(s)** belong in the marketplace—and why?
* Where does **value accrue** to mission tokens in this model?
* What is the most effective way to **launch mission tokens** (bonding‑curve variants, thresholds, graduation signals)?
* How (if at all) should the protocol **capture value from launches** without distorting incentives?

### Staking & Participation

* Should missions have their **own staking contracts**, or is one global program preferable at the outset?
* Which **staking assets** best align incentives initially (single‑asset vs. LP vs. master pool)?
* What **activity signals** should determine rewards (accepted jobs, dispute‑rate thresholds, coverage of underserved categories)?

### Tech Stack Considerations

* Should the marketplace be hosted **in‑house** or leverage an **external marketplace** (e.g., a Mech marketplace)? What are the trade‑offs for control, fees, distribution, and UX?
* Should we partner with an existing launchpad (e.g., **CreatorBid**) or build our own using **Doppler**?

