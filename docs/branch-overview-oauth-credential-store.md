# `feature/oauth-credential-store` — Branch Overview

**Branch:** `feature/oauth-credential-store`
**Base:** `main`
**Scope:** ~50 commits · 193 files changed · +10,500 / −12,400 lines

---

## TL;DR

This branch gives Jinn agents **secure access to web2 credentials** (Twitter, Umami, GitHub, etc.) **without ever exposing secrets to the agent process**, and replaces the old trust-me header auth with **cryptographically signed requests** across the entire stack.

---

## The Problem

Before this branch, two fundamental limitations existed:

1. **Agents couldn't use web2 APIs.** On-chain agents had no safe way to obtain OAuth tokens for services like Twitter, analytics platforms, or content publishers. Credentials were either hardcoded in env vars (insecure, unscalable) or simply unavailable.

2. **Inter-service auth was spoofable.** Workers identified themselves to the Control API via a plain `X-Worker-Address` header — anyone who knew the format could impersonate any worker.

---

## What This Branch Introduces

### 1. Credential Bridge (x402-gateway)

A new credential service that brokers OAuth tokens on behalf of agents:

```
Agent ──ERC-8128──▶ Credential Bridge ──verify──▶ Control API
                          │
                     Nango (OAuth)
                          │
                    Twitter / Umami / etc.
```

- **Agents request credentials by provider name** (e.g. `twitter`, `umami`) — the bridge fetches a fresh OAuth token from [Nango](https://www.nango.dev/) and returns it in a time-limited bundle.
- **Access Control List (ACL)** — database-backed, per-operator, per-venture allow/deny policies control which operators can access which providers. Supports JSON-file and Postgres backends.
- **Job verification** — the bridge calls back to the Control API to confirm the requesting agent actually has an active job, preventing credential exfiltration.
- **Rate limiting** — per-address request throttling via Redis.
- **Audit logging** — every token issuance is logged with operator address, provider, venture context, and cost attribution.
- **Admin API** — routes for managing operators, policies, credentials, and viewing audit history.

**Key files:**
- `services/x402-gateway/credentials/` — the entire credential module (operators, ACL, rate-limit, audit, admin, job-verify, Nango client)
- `jinn-node/src/agent/shared/credential-client.ts` — agent-side client
- `jinn-node/src/worker/filters/credentialFilter.ts` — worker-side capability probing and job filtering

---

### 2. ERC-8128 Signed Auth

Every HTTP request between services is now cryptographically signed using [ERC-8128](https://eips.ethereum.org/EIPS/eip-8128) (RFC 9421 + Ethereum signatures):

| Before | After |
|--------|-------|
| `X-Worker-Address: 0xabc...` header (spoofable) | ERC-8128 `signature` + `signature-input` + `content-digest` headers (cryptographically verified) |
| No replay protection | Nonce-based replay protection with TTL expiry |
| No request integrity | Full body content-digest verification |

**Adopted across:**
- Worker → Control API
- Agent → Credential Bridge
- Credential Bridge → Control API (job verification callback)

**Key file:** `jinn-node/src/http/erc8128.ts` — signer construction, request signing, nonce store, and verification helpers.

---

### 3. Signing Proxy (Private Key Isolation)

The agent subprocess **never touches the private key**. Instead, a localhost HTTP proxy runs in the worker process:

```
┌─────────────────────────────┐
│  Worker Process              │
│  ┌─────────────────────────┐ │
│  │  Signing Proxy          │ │  ← Has the private key
│  │  127.0.0.1:{random}     │ │  ← Bearer-token protected
│  │  /address               │ │
│  │  /sign                  │ │
│  │  /sign-raw              │ │
│  │  /sign-typed-data       │ │
│  │  /dispatch              │ │
│  └─────────────────────────┘ │
│           ▲                  │
│           │ HTTP              │
│  ┌────────┴────────────────┐ │
│  │  Agent Subprocess        │ │  ← No key access
│  │  (Claude / Gemini)       │ │
│  └─────────────────────────┘ │
└─────────────────────────────┘
```

Even if the agent is compromised (e.g. via prompt injection from IPFS content), it cannot extract the private key. It can only request signatures through the proxy's constrained API.

**Key files:**
- `jinn-node/src/agent/signing-proxy.ts` — the proxy server
- `jinn-node/src/agent/shared/signing-proxy-client.ts` — agent-side client

---

### 4. Credential-Aware Job Routing

Workers now **discover their credential capabilities at startup** by probing the credential bridge:

- If a job requires tools that need credentials (e.g. `twitter_post` needs `twitter`), only workers with matching ACL grants will claim it.
- Credential-requiring jobs get **priority routing** to trusted operators.
- Per-job re-probing supports **venture-scoped credentials** — a worker may have different credential access depending on which venture dispatched the job.

---

### 5. Security Hardening

Beyond the architectural changes above, targeted security fixes include:

- **IPFS injection protection** — agent input from IPFS is sanitised to prevent tool-call injection
- **Fail-closed auth defaults** — if verification fails for any reason, the request is rejected (no fallback to unauthenticated)
- **Credential bridge input validation** — strict schema validation on all endpoints
- **x402 payment verification** — EIP-712 `transferWithAuthorization` support for paid credential access

---

### 6. Environment & Trust Boundaries

- **Credential bundles** are now configured per-environment with clear trust tiers (`trusted` / `untrusted`)
- **Tool registration** — tools that require credentials (e.g. `twitter_post`, `blog_get_stats`) are explicitly registered with their provider requirements in a shared mapping
- **Env variable cleanup** — credential detection moved from scattered env-var checks to bridge-probed capabilities

---

### 7. E2E Test Infrastructure

A full end-to-end testing framework for the credential flow:

- Docker-based Nango setup for OAuth simulation
- Credential session lifecycle tests (request → verify → use → expire)
- ERC-8128 auth integration tests
- Skills synced as Claude commands for manual testing workflow

---

## What This Unlocks

| Capability | Status Before | Status After |
|------------|--------------|--------------|
| Agents posting to Twitter | ❌ Not possible | ✅ Via credential bridge |
| Agents reading analytics | ❌ Not possible | ✅ Via credential bridge |
| Agents using any OAuth API | ❌ Not possible | ✅ Add to Nango + ACL |
| Spoofing worker identity | ⚠️ Trivial | ✅ Cryptographically impossible |
| Agent extracting private key | ⚠️ Key in env | ✅ Key never in agent process |
| Per-venture credential scoping | ❌ N/A | ✅ ACL supports venture context |
| Credential usage auditing | ❌ No tracking | ✅ Full audit trail |
| Paid API access (x402) | ❌ N/A | ✅ On-chain payment verification |

**In short:** this branch is the foundation for Jinn agents to operate as **full-stack actors** — interacting with both on-chain and off-chain services — without compromising security or operator trust boundaries.

---

## Migration Notes

- The old `X-Worker-Address` header auth is **removed**. All services must use ERC-8128 signed requests.
- Workers need `X402_GATEWAY_URL` set to use the credential bridge (graceful fallback if unset).
- Test scripts (`test_onchain_e2e.ts`, integration tests) have been updated to use signed auth.
- `AGENTS.md` updated to reflect new auth requirements.
