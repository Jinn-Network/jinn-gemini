# Roadmap

The current focus is on standing up an MVP of the platform in order to support the Zora demo application.

## MVP To Do

- [ ] Integration with Olas Marketplace
  - [ ] Minimal marketplace watch/claim path for venture-scoped jobs
  - [ ] Completion submission verified from the service address

- [ ] Integration with Olas Staking

- **Misc**
    - [ ] Make transaction queue local to Orchestrator

## Completed

We have completed an initial research and validation phase whereby we built an agentic application using centralised database instances. Out of that has come some reusable code modules, and research outcomes that have informed this specification.

### Reusable Modules

- [x] Task Executor
  - [x] Gemini CLI agent wrapper with dynamic per-job tool gating via MCP
  - [x] ReAct-style loop; context ingestion; off-chain observability
  - [x] Telemetry plumbing compatible with new flow

- [x] Transaction Rails
  - [x] On-chain identity and wallet management via `wallet-manager` (deterministic Safe provisioning, idempotent find-or-create, secret hygiene)
  - [x] Dual-rail execution: `EOA` and `SAFE` paths with chain-aware allowlists (`worker/config/allowlists.json`)
  - [x] Deterministic submission queue and retries for transient failures (to be localized to orchestrator)

### Research Outcomes

- [x] Orchestrator lifecycle: claim → execute → report framing
- [x] Database-centric eventing and context injection patterns (`trigger_context`, `delegated_work_context`) as conceptual groundwork
- [x] Awareness tools (`get_context_snapshot`, `get_job_graph`, `trace_lineage`) proving value; require adaptation to marketplace-first model
- [x] Shared context manager for pagination/truncation as a pattern to retain