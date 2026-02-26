# Agentic Document Web (ADW) Specification v0.1

**Status:** Draft
**Date:** 2026-02-24
**Authors:** Oaksprout the Tan, Ritsu Kai and Claude Opus 4.6

---

## 1. Introduction

### 1.1 Problem Statement

The agentic AI ecosystem produces and consumes vast quantities of documents: skills that define agent capabilities, blueprints that specify execution constraints, templates that structure repeatable workflows, configuration files, knowledge artifacts, and content outputs. These documents are the substrate of the agentic web — they encode what agents know, what they can do, and what they have produced.

Today, these documents are scattered across disconnected systems with incompatible identity, discovery, and trust mechanisms:

- Agent skills live as markdown files in Git repositories or proprietary registries
- Blueprints and templates are stored in databases (Supabase, Postgres) or on IPFS
- Content outputs are delivered via IPFS with on-chain hash anchoring
- Agent identities are registered on ERC-8004 registries, but the documents they produce have no equivalent standard

There is no open standard that enables an agent (or human) to:

1. **Discover** a document across organizational and platform boundaries
2. **Verify** who created it and whether it has been tampered with
3. **Trace** its provenance — what inputs, agents, and processes produced it
4. **Trust** it proportionally to the verification evidence available
5. **Reference** it with a stable, cross-ecosystem identity

ERC-8004 ("Trustless Agents") solved this problem for agents. ADW solves it for the documents agents produce and consume.

### 1.2 Design Principles

1. **Compose, don't invent.** ADW is a protocol profile that composes existing standards (W3C DIDs, Verifiable Credentials, IPFS/IPLD, ERC-8004) into a coherent system for agent documents. Where no standard exists, ADW defines the minimum viable extension.

2. **Implementation agnostic.** The spec defines interfaces and schemas, not implementations. A conforming implementation can use Ethereum or Solana, IPFS or Arweave, ENS or any naming service.

3. **Companion to ERC-8004.** ADW reuses the ERC-8004 registry pattern (ERC-721 identity + URI resolution + reputation + validation) and extends it for documents. A document can be registered on the same Identity Registry as an agent.

4. **Content addressing as canonical identity.** A document's content hash is its immutable, canonical identity. Names, registry entries, and DIDs are resolution layers that point to content hashes.

5. **Verification over reputation.** Reputation is a proxy for things you cannot verify. Where verification is possible (cryptographic signatures, on-chain execution records, ZK proofs), it should be preferred. Reputation remains useful where verification is impractical.

6. **Incremental adoption.** Implementors can adopt ADW incrementally — start with identity and metadata, add discovery later, add provenance when ready. Each layer is independently useful.

### 1.3 Relationship to Existing Standards

| Standard | ADW Relationship |
|----------|-----------------|
| **ERC-8004** | ADW extends the same registry pattern (ERC-721 + URI + reputation + validation) from agents to documents. Documents and agents can coexist on the same Identity Registry. |
| **W3C DIDs** | ADW uses DIDs for creator identity and optionally for document identity (`did:web`, `did:key`). |
| **W3C Verifiable Credentials 2.0** | ADW defines VC profiles for document attestations (provenance, quality, safety). |
| **IPFS/IPLD** | ADW uses content-addressed hashes (CIDs) as canonical document identity. IPFS is a conforming storage provider. |
| **A2A Protocol** | ADW's well-known endpoint pattern mirrors A2A's `/.well-known/agent.json`. Agent documents can reference A2A agent cards. |
| **C2PA Content Credentials** | ADW's provenance model is inspired by C2PA but adapted for agent execution chains rather than media capture. |
| **OLAS Registry** | ADW generalizes the OLAS pattern (ERC-721 + IPFS metadata for components/agents/services) to all document types. |
| **OASF** | ADW adopts OASF's dotted notation for capability taxonomy (skill/domain classification) and extends it with trust, provenance, and versioning metadata. |
| **Anthropic Agent Skills (SKILL.md)** | ADW's `adw:Skill` type is compatible with the SKILL.md format adopted by Claude Code, GitHub Copilot, VS Code, and Cursor. ADW adds identity, trust, and provenance layers on top. |
| **DASL/DRISL** | ADW uses DASL content addressing conventions for deterministic document hashing, aligned with the IETF draft (CBOR Tag 42). |
| **Schema.org / JSON-LD** | ADW metadata uses JSON-LD `@context` for extensibility. |

### 1.4 Terminology

| Term | Definition |
|------|-----------|
| **Agent Document** | Any self-contained unit of structured or unstructured content produced or consumed by an AI agent. |
| **ADW-ID** | A composite identifier for a document consisting of a content hash (required), an optional registry entry, and an optional human-readable name. |
| **Content Hash** | A cryptographic hash of a document's content, providing immutable identity. Typically a CID (Content Identifier) as defined by IPLD. |
| **Registration File** | A JSON document pointed to by a registry entry's URI, containing document metadata, type information, and provenance data. |
| **Creator** | The agent, human, or organization that produced the document, identified by a DID, wallet address, or ERC-8004 agent ID. |
| **Provenance Chain** | An ordered sequence of creation and transformation steps that produced a document. |
| **Document Type** | A classification of a document's purpose and structure (e.g., Blueprint, Skill, Artifact). |

---

## 2. Concepts

### 2.1 What is an Agent Document

An Agent Document is any self-contained unit of content that is meaningful in the context of agent operations. This includes but is not limited to:

- **Instructions** that tell agents what to do (skills, prompts, system instructions)
- **Specifications** that define execution constraints (blueprints, schemas, invariants)
- **Templates** that structure repeatable workflows (job templates, configuration templates)
- **Outputs** that agents produce (reports, analyses, code, media)
- **Knowledge** that agents consume (reference documents, training data, context files)
- **Configuration** that parameterizes agent behavior (environment configs, tool lists)

An Agent Document is NOT:

- A running service or API endpoint (that's an agent — see ERC-8004)
- A transient message between agents (that's communication — see A2A/MCP)
- Raw data without structure or intent (databases, logs, telemetry)

### 2.2 Document Types

ADW defines a core vocabulary of document types. This vocabulary is extensible via JSON-LD `@context`.

#### Core Types

| Type | Description | Typical Format |
|------|-------------|---------------|
| `adw:Blueprint` | Execution specification with invariants/constraints that define agent behavior | JSON |
| `adw:Skill` | Instructions that extend an agent's capabilities | Markdown + YAML frontmatter |
| `adw:Template` | Reusable workflow definition with input schema and output spec | JSON |
| `adw:Artifact` | Output produced by an agent execution | JSON, Markdown, or binary |
| `adw:Configuration` | Parameters that customize agent or workflow behavior | JSON, YAML, TOML |
| `adw:Knowledge` | Reference material consumed by agents during execution | Markdown, JSON, PDF |
| `adw:AgentCard` | Agent capability declaration (bridges to A2A/ERC-8004) | JSON |

#### Compatibility with Existing Formats

**SKILL.md compatibility**: The `adw:Skill` type is designed to be compatible with the SKILL.md format that has become a de facto standard, adopted by Anthropic (Claude Code), GitHub Copilot, VS Code, and Cursor. A SKILL.md file with YAML frontmatter (name, description, allowed-tools) can be wrapped in an ADW Registration File without modification to the skill content itself. ADW adds identity, trust, and provenance as an outer layer.

**OASF taxonomy**: For capability classification, ADW adopts OASF's dotted notation (e.g., `agent.code.execution`, `agent.content.creation`). This is used in the `tags` field and in type-specific profiles for skill/domain classification.

#### Extending the Vocabulary

New types are defined by publishing a JSON-LD context document:

```json
{
  "@context": {
    "myorg": "https://myorg.com/adw/v1#",
    "myorg:GovernanceDigest": {
      "@id": "myorg:GovernanceDigest",
      "@context": {
        "protocol": "myorg:protocol",
        "proposalCount": "myorg:proposalCount",
        "votingDeadline": "myorg:votingDeadline"
      }
    }
  }
}
```

### 2.3 Actors

| Actor | Description | Identifier |
|-------|-------------|-----------|
| **Agent** | An autonomous AI system that creates or consumes documents | ERC-8004 agentId, DID, or wallet address |
| **Human** | A person who creates, reviews, or approves documents | DID, wallet address, or ENS name |
| **Organization** | A team or company that publishes documents | DID, wallet address, or ENS name |
| **Validator** | An entity that independently verifies document properties | ERC-8004 validator address |

### 2.4 Document Lifecycle

```
Created → Registered → Discovered → Consumed → (Deprecated | Superseded)
```

1. **Created**: Document content is produced (by agent, human, or automated process)
2. **Registered**: Document is assigned an ADW-ID (content hash computed, optionally minted on registry)
3. **Discovered**: Other agents/humans find the document via well-known endpoints, registry queries, or direct reference
4. **Consumed**: Document is used as input to agent execution, read by a human, or referenced by another document
5. **Deprecated/Superseded**: Document is marked as outdated, replaced by a new version, or revoked

Documents are immutable once created. Versioning creates new documents with new content hashes. The registry entry can be updated to point to the latest version.

---

## 3. Identity Layer

### 3.1 ADW-ID (Composite Identity Scheme)

Every agent document is identified by a composite ADW-ID with three layers:

```
ADW-ID = {
  contentHash: CID,              // REQUIRED — immutable canonical identity
  registry:    RegistryEntry,    // OPTIONAL — on-chain anchor
  name:        HumanReadableName // OPTIONAL — mutable resolution
}
```

**Content hash** is always the canonical identity. Two documents with the same content hash are the same document, regardless of where they are stored or how they are named.

**Registry entry** provides an on-chain anchor with mutable metadata (reputation scores, validation status, deprecation flags) that cannot be captured by an immutable content hash.

**Human-readable name** provides convenience for humans and agents that prefer named references.

#### Full ADW-ID Example

```json
{
  "contentHash": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  "registry": {
    "namespace": "eip155",
    "chainId": 8453,
    "contract": "0x8004A169b82E3EC6E547b5f3EfD3786738E35447",
    "documentId": 42
  },
  "name": "jinn.eth/blog-growth:1.2.0"
}
```

#### Minimal ADW-ID (Content Hash Only)

```json
{
  "contentHash": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
}
```

This is sufficient for referencing a document. No registry or naming service is required. Any agent with the content hash can retrieve and verify the document from any storage provider.

### 3.2 Content Addressing (Immutable Identity)

Content hashes MUST be computed using IPLD CIDv1 following DASL (Data-Addressed Structures and Links) conventions. DASL is a strict subset of IPLD submitted to IETF as a draft standard (CBOR Tag 42, May 2025), providing deterministic content addressing suitable for web-wide standardization.

Defaults:

- **Codec**: `dag-json` (0x0129) for JSON documents, `raw` (0x55) for binary
- **Multihash**: SHA-256 (0x12)
- **Base encoding**: Base32 lower (`b`) for URIs, Base58btc for compact representation
- **Serialization**: DRISL-conformant CBOR for deterministic hashing

The content hash is computed over the **canonical form** of the document:

- JSON documents: Serialized with sorted keys, no whitespace, UTF-8 encoding
- Markdown documents: Raw UTF-8 bytes
- Binary documents: Raw bytes

#### Verification

Any party can verify a document's identity by:

1. Retrieving the document content from any storage provider
2. Computing the CID using the canonical form
3. Comparing with the declared content hash

If they match, the document is authentic. No trust in the storage provider is required.

### 3.3 Named Identity (Mutable, Resolvable)

Named identities follow the pattern:

```
{namespace}/{path}:{version}
```

Examples:
- `jinn.eth/blog-growth:1.2.0`
- `autonolas.eth/component-315:1.0.0`
- `skills.example.com/web-search:2.1.0`

**Namespace** is a domain, ENS name, or other resolvable identifier controlled by the publisher.

**Path** is a hierarchical identifier within the namespace.

**Version** follows [Semantic Versioning 2.0.0](https://semver.org/) (`MAJOR.MINOR.PATCH`).

Name resolution is handled by the namespace provider (ENS, DNS, etc.) and is outside the scope of this specification. ADW requires only that a name resolves to a content hash.

### 3.4 DID Binding

Documents MAY be assigned a DID using any W3C-conformant DID method. Recommended methods:

| Method | Use Case |
|--------|----------|
| `did:web` | Documents hosted by an organization with a web domain |
| `did:key` | Ephemeral or self-contained documents |
| `did:pkh` | Documents anchored to a blockchain address |

Example: `did:web:jinn.network:docs:blog-growth`

The DID document SHOULD include a service endpoint that resolves to the ADW Registration File:

```json
{
  "id": "did:web:jinn.network:docs:blog-growth",
  "service": [{
    "id": "#adw",
    "type": "ADWDocument",
    "serviceEndpoint": "https://jinn.network/adw/docs/blog-growth"
  }]
}
```

### 3.5 Cross-System Resolution

A single document may have identifiers in multiple systems. The Registration File (Section 4) declares all known identifiers:

```json
{
  "identifiers": [
    {
      "system": "adw",
      "id": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
    },
    {
      "system": "erc8004",
      "id": "eip155:8453:0x8004A169...E35447:42"
    },
    {
      "system": "ens",
      "id": "jinn.eth/blog-growth"
    },
    {
      "system": "olas",
      "id": "ethereum:component:315"
    },
    {
      "system": "did",
      "id": "did:web:jinn.network:docs:blog-growth"
    }
  ]
}
```

All identifiers MUST resolve to the same content hash. If they diverge, the content hash is authoritative.

---

## 4. Metadata Schema

### 4.1 Core Metadata (REQUIRED)

Every ADW document MUST have a Registration File containing these fields:

```json
{
  "type": "https://adw.dev/v0.1#registration",
  "@context": "https://adw.dev/v0.1",
  "documentType": "adw:Blueprint",
  "version": "1.2.0",
  "name": "Blog Growth Template",
  "description": "Autonomous blog growth with content creation, distribution, analytics, and site branding",
  "contentHash": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  "creator": "eip155:8453:0x8004A169...E35447:7",
  "created": "2026-02-24T00:00:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | YES | MUST be `https://adw.dev/v0.1#registration` |
| `@context` | string | YES | JSON-LD context URI |
| `documentType` | string | YES | ADW document type (Section 2.2) |
| `version` | string | YES | Semantic version of the document |
| `name` | string | YES | Human-readable document name |
| `description` | string | YES | Brief description of the document's purpose |
| `contentHash` | string | YES | CID of the document content |
| `creator` | string | YES | Identifier of the creator (ERC-8004 agent ID, DID, or wallet address) |
| `created` | string | YES | ISO 8601 timestamp of creation |

### 4.2 Extended Metadata (OPTIONAL)

```json
{
  "license": "MIT",
  "language": "en",
  "tags": ["content", "growth", "blog", "autonomous"],
  "supersedes": "bafybeiprevioushash...",
  "supersededBy": null,
  "deprecated": false,
  "identifiers": [],
  "storage": [],
  "provenance": {},
  "trust": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `license` | string | NO | SPDX license identifier |
| `language` | string | NO | BCP 47 language tag |
| `tags` | string[] | NO | Freeform discovery tags |
| `supersedes` | string | NO | Content hash of the document this version replaces |
| `supersededBy` | string | NO | Content hash of the document that replaces this one |
| `deprecated` | boolean | NO | Whether this document should no longer be used |
| `identifiers` | Identifier[] | NO | Cross-system identifiers (Section 3.5) |
| `storage` | StorageLocation[] | NO | Where the document content can be retrieved (Section 8) |
| `provenance` | Provenance | NO | How the document was produced (Section 7) |
| `trust` | Trust | NO | Trust signals (Section 6) |

### 4.3 Type-Specific Profiles

Each document type defines additional metadata fields. These are declared under a `profile` key:

#### adw:Blueprint

```json
{
  "documentType": "adw:Blueprint",
  "profile": {
    "invariants": [
      {
        "id": "GOAL-MISSION",
        "type": "BOOLEAN",
        "condition": "All content aligns with stated mission",
        "assessment": "For each output, verify mission alignment"
      }
    ],
    "inputSchema": {
      "type": "object",
      "properties": {
        "blogName": { "type": "string" },
        "mission": { "type": "string" }
      },
      "required": ["blogName", "mission"]
    },
    "outputSpec": {
      "type": "object",
      "properties": {
        "liveBlogUrl": { "type": "string" }
      }
    },
    "enabledTools": [
      { "name": "blog_create_post", "required": true },
      { "name": "google_web_search", "required": false }
    ],
    "estimatedDuration": "PT5M",
    "safetyTier": "standard"
  }
}
```

#### adw:Skill

```json
{
  "documentType": "adw:Skill",
  "profile": {
    "format": "markdown",
    "allowedTools": ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
    "triggers": ["deploy to railway", "set up worker", "configure environment"],
    "targetAgent": "claude-code",
    "dependencies": []
  }
}
```

#### adw:Template

```json
{
  "documentType": "adw:Template",
  "profile": {
    "blueprintHash": "bafybeiblueprintcid...",
    "inputSchema": { "type": "object", "properties": {} },
    "outputSpec": { "type": "object", "properties": {} },
    "pricing": {
      "priceWei": "0",
      "currency": "ETH",
      "paymentModel": "per-execution"
    },
    "safetyTier": "standard",
    "status": "published",
    "executionCount": 1247,
    "averageDuration": "PT3M"
  }
}
```

#### adw:Artifact

```json
{
  "documentType": "adw:Artifact",
  "profile": {
    "topic": "blog-growth",
    "artifactType": "SITUATION",
    "sourceExecution": {
      "requestId": "0xabc123...",
      "jobDefinitionId": "blog-growth-writer-001",
      "agentId": "eip155:8453:0x8004...E35447:7"
    },
    "contentPreview": "Published 3 blog posts this cycle...",
    "utilityScore": 85,
    "accessCount": 42
  }
}
```

#### adw:Configuration

```json
{
  "documentType": "adw:Configuration",
  "profile": {
    "targetSchema": "adw:Blueprint",
    "targetDocument": "bafybeiblueprintcid...",
    "parameters": {
      "blogName": "The Lamp",
      "mission": "Illuminate the path to autonomous AI",
      "domain": "thelamp.ai"
    }
  }
}
```

### 4.4 Extensibility

Type-specific profiles are extended by publishing a JSON-LD context:

```json
{
  "@context": {
    "adw": "https://adw.dev/v0.1#",
    "jinn": "https://jinn.network/adw#",
    "jinn:ventureId": { "@type": "xsd:string" },
    "jinn:workstreamId": { "@type": "xsd:string" }
  }
}
```

Custom fields are namespaced to avoid collisions. ADW-unaware consumers ignore unknown namespaced fields.

---

## 5. Discovery Protocol

### 5.1 Well-Known Endpoint

Organizations and agents that publish documents SHOULD host a discovery endpoint:

```
GET https://{domain}/.well-known/adw.json
```

Response:

```json
{
  "adw_version": "0.1",
  "publisher": {
    "name": "Jinn Network",
    "id": "eip155:8453:0x8004A169...E35447:7",
    "did": "did:web:jinn.network"
  },
  "catalogs": [
    {
      "type": "adw:Blueprint",
      "endpoint": "https://jinn.network/adw/blueprints",
      "count": 41,
      "description": "Autonomous workflow blueprints"
    },
    {
      "type": "adw:Skill",
      "endpoint": "https://jinn.network/adw/skills",
      "count": 18,
      "description": "Agent skill definitions"
    },
    {
      "type": "adw:Template",
      "endpoint": "https://jinn.network/adw/templates",
      "count": 12,
      "description": "Reusable workflow templates"
    }
  ],
  "registries": [
    {
      "chain": "eip155:8453",
      "contract": "0x8004A169...E35447",
      "type": "erc8004-compatible"
    }
  ]
}
```

This mirrors A2A's `/.well-known/agent.json` pattern. An agent can discover all documents published by an organization by fetching this endpoint.

### 5.2 Registry Interface

ADW defines an abstract registry interface. Any implementation (smart contract, REST API, GraphQL endpoint) that supports these operations is ADW-conformant:

#### Register

```
register(documentURI: string, metadata?: KeyValue[]) → documentId: uint256
```

Mints a new document identity and associates it with a URI pointing to the Registration File. Returns a unique document ID within the registry.

#### Resolve

```
resolve(documentId: uint256) → documentURI: string
```

Returns the Registration File URI for a given document ID.

#### Query

```
query(filters: QueryFilter) → DocumentDescriptor[]
```

Searches for documents matching given criteria:

```json
{
  "filters": {
    "documentType": "adw:Blueprint",
    "creator": "eip155:8453:0x8004...E35447:7",
    "tags": ["content", "growth"],
    "createdAfter": "2026-01-01T00:00:00Z",
    "minReputationScore": 80
  },
  "limit": 20,
  "offset": 0
}
```

#### Update URI

```
setDocumentURI(documentId: uint256, newURI: string)
```

Updates the Registration File URI. Only callable by the document owner.

### 5.3 Federated Discovery

For decentralized discovery without a central registry, ADW supports federated queries:

1. Agent fetches `/.well-known/adw.json` from known publishers
2. Agent queries each publisher's catalog endpoints
3. Results are merged and deduplicated by content hash

Federated discovery enables a purely peer-to-peer document web where no single registry has complete information.

### 5.4 Protocol Exposure

ADW documents MAY be exposed through existing agent communication protocols:

- **MCP (Model Context Protocol)**: ADW documents can be served as MCP Resources (read-only data) or MCP Prompts (instruction templates). An MCP server can advertise its ADW catalog via the standard `resources/list` or `prompts/list` methods.
- **A2A (Agent-to-Agent)**: An agent's A2A agent card can reference ADW documents in its capabilities list.
- **ERC-8004**: An agent's registration file can include an OASF service endpoint pointing to ADW-formatted skill manifests.

This makes ADW documents discoverable through any protocol an agent already supports, without requiring agents to implement ADW-specific discovery.

---

## 6. Trust & Verification

### 6.1 Creator Binding

Every document MUST declare its creator in the Registration File. The creator binding can be verified at increasing levels of assurance:

**Level 0 — Declared**: The `creator` field is present but not cryptographically verified.

**Level 1 — Signed**: The Registration File includes a cryptographic proof:

```json
{
  "trust": {
    "creatorProof": {
      "type": "EIP-712",
      "signer": "0x900Db2954a6c14C011dBeBE474e3397e58AE5421",
      "signature": "0xabc123...",
      "message": {
        "contentHash": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        "documentType": "adw:Blueprint",
        "version": "1.2.0",
        "timestamp": "2026-02-24T00:00:00Z"
      }
    }
  }
}
```

**Level 2 — On-Chain Anchored**: The document is registered on an ERC-8004-compatible registry. The `register()` transaction provides an immutable on-chain record of who registered the document and when.

### 6.2 Integrity Verification

Document integrity is verified by content hash comparison:

1. Retrieve document content from any storage location
2. Compute CID using canonical form (Section 3.2)
3. Compare with `contentHash` in Registration File

If hashes match, the document is unmodified since creation. No trust in intermediate parties (storage providers, CDNs, caches) is required.

### 6.3 Verifiable Credential Profiles

ADW defines VC profiles for document-specific attestations using W3C Verifiable Credentials 2.0:

#### Document Quality Attestation

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://adw.dev/v0.1"
  ],
  "type": ["VerifiableCredential", "ADWDocumentAttestation"],
  "issuer": "did:web:audit.jinn.network",
  "validFrom": "2026-02-24T00:00:00Z",
  "credentialSubject": {
    "id": "adw:bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    "type": "adw:Blueprint",
    "assertions": [
      {
        "type": "adw:ExecutionCount",
        "value": 1247,
        "observedAt": "2026-02-24T00:00:00Z"
      },
      {
        "type": "adw:SuccessRate",
        "value": 0.94,
        "sampleSize": 1247
      },
      {
        "type": "adw:SafetyAudit",
        "result": "passed",
        "auditor": "did:web:audit.jinn.network",
        "methodology": "ADW-Safety-Review-v1"
      }
    ]
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-rdfc-2022",
    "verificationMethod": "did:web:audit.jinn.network#key-1",
    "proofPurpose": "assertionMethod",
    "proofValue": "z3FXQJe..."
  }
}
```

### 6.4 Trust Levels

ADW defines four progressive trust levels. Each level subsumes the previous:

| Level | Name | Mechanism | What it proves |
|-------|------|-----------|---------------|
| 0 | **Declared** | Registration File metadata | Someone claims to have created this |
| 1 | **Signed** | Cryptographic signature (EIP-712, EdDSA) | A specific key signed this content hash |
| 2 | **Reputation-Backed** | ERC-8004 Reputation Registry | Other parties have provided feedback signals |
| 3 | **Provenance-Verified** | On-chain execution records + ZK proofs | The entire creation chain is cryptographically verifiable |

**ERC-8004 Reputation Registry Integration:**

Documents registered on an ERC-8004-compatible registry inherit the full reputation infrastructure:

```solidity
// Give feedback on a document
reputationRegistry.giveFeedback(
  documentId,  // uint256 — the document's registry ID
  9500,        // int128  — score (95.00)
  2,           // uint8   — decimals
  "quality",   // string  — tag1
  "blueprint", // string  — tag2
  "",          // string  — endpoint (unused for documents)
  "ipfs://QmFeedbackDetails...", // feedbackURI
  0x0          // bytes32 — feedbackHash
);
```

**ERC-8004 Validation Registry Integration:**

Independent validators can verify document properties:

```solidity
// Request validation of a document
validationRegistry.validationRequest(
  validatorAddress,
  documentId,
  "ipfs://QmValidationRequest...",
  requestHash
);

// Validator responds
validationRegistry.validationResponse(
  requestHash,
  85,    // uint8  — response (0-100 scale)
  "ipfs://QmValidationEvidence...",
  responseHash,
  "safety-review"  // string — tag
);
```

---

## 7. Supply Chain (Provenance)

### 7.1 Lineage Model

Every document MAY declare its provenance — how it came into existence:

```json
{
  "provenance": {
    "method": "agent-execution",
    "derivedFrom": [
      {
        "contentHash": "bafybeiblueprintcid...",
        "relationship": "blueprint",
        "description": "Blueprint that defined the execution constraints"
      },
      {
        "contentHash": "bafybeiconfigcid...",
        "relationship": "input",
        "description": "Configuration providing blog parameters"
      },
      {
        "contentHash": "bafybeipreviouscyclecid...",
        "relationship": "context",
        "description": "Previous cycle's summary artifact"
      }
    ]
  }
}
```

#### Relationship Types

| Relationship | Description |
|-------------|-------------|
| `blueprint` | The specification that constrained execution |
| `input` | Data consumed during creation |
| `context` | Background information that informed creation |
| `template` | The template that structured the workflow |
| `predecessor` | The previous version of this document |
| `review` | A document that reviewed/approved this one |

### 7.2 Execution Provenance

For documents produced by agent execution, ADW defines a richer provenance model:

```json
{
  "provenance": {
    "method": "agent-execution",
    "execution": {
      "agent": "eip155:8453:0x8004A169...E35447:7",
      "requestId": "0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a",
      "blueprint": "bafybeiblueprintcid...",
      "tools": [
        "blog_create_post",
        "google_web_search",
        "blog_get_stats"
      ],
      "chain": "eip155:8453",
      "requestTransaction": "0xrequest_txhash...",
      "deliveryTransaction": "0xdelivery_txhash...",
      "timestamp": "2026-02-24T12:00:00Z",
      "duration": "PT3M22S"
    },
    "derivedFrom": [
      {
        "contentHash": "bafybeiblueprintcid...",
        "relationship": "blueprint"
      },
      {
        "contentHash": "bafybeiconfigcid...",
        "relationship": "input"
      }
    ]
  }
}
```

#### On-Chain Verification Steps

Each field in the execution provenance can be independently verified against on-chain data:

1. **"This agent produced this output"** — The `MarketplaceDelivery` event on-chain records which mech (agent) delivered which request. Verify `deliveryMech` matches declared `agent`.

2. **"This blueprint was used"** — The `MarketplaceRequest` event contains `requestData` including the blueprint hash. Verify it matches declared `blueprint`.

3. **"This is the actual output"** — The `Deliver` event contains a SHA-256 digest of the output. Verify `contentHash` of the document matches the on-chain digest.

4. **"These inputs were used"** — Each `derivedFrom` entry can be traced to on-chain request data or prior deliveries.

No trust in the agent, the storage provider, or any intermediary is required. The verification chain is purely cryptographic + on-chain.

### 7.3 Verification Without Reputation

The provenance model enables a verification-first approach to trust:

**Traditional (reputation-based):**
> "This blueprint has a 4.8/5 rating on the marketplace. I trust it."

**ADW (verification-based):**
> "This blueprint has been executed 1,247 times on-chain. In 94% of executions, the output passed validation. I can verify each execution by checking the chain. I don't need to trust anyone's rating."

The key insight: when every step in a document's creation is verifiable, reputation becomes an optimization (a summary of verifiable facts) rather than a necessity (a proxy for unknowable facts).

### 7.4 ZK Proof Slots

ADW reserves a `zkProof` field in the provenance model for future zero-knowledge proof integration:

```json
{
  "provenance": {
    "execution": { ... },
    "zkProof": {
      "type": "groth16",
      "verifier": "eip155:8453:0xVerifierContract...",
      "proof": "0x...",
      "publicInputs": ["contentHash", "blueprintHash", "agentId"]
    }
  }
}
```

A ZK proof could attest to the entire provenance chain in a single verification step: "This document was produced by this agent, using this blueprint, with these inputs, and the output matches this content hash" — without revealing the execution details.

This is not required in v0.1 but the schema MUST reserve the field to enable forward compatibility.

---

## 8. Storage Abstraction

### 8.1 Provider Interface

ADW defines a minimal storage provider interface:

| Operation | Signature | Description |
|-----------|-----------|-------------|
| `store` | `store(content: bytes) → contentHash: CID` | Store content and return its content hash |
| `resolve` | `resolve(contentHash: CID) → content: bytes` | Retrieve content by content hash |
| `pin` | `pin(contentHash: CID) → ack` | Ensure content remains available (optional) |

Any system that implements these operations is an ADW-conformant storage provider.

### 8.2 Storage Bindings

#### IPFS

```json
{
  "storage": [{
    "provider": "ipfs",
    "uri": "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    "gateway": "https://gateway.autonolas.tech/ipfs/"
  }]
}
```

IPFS is the natural primary binding because it is natively content-addressed. The CID IS the content hash — no separate verification step is needed.

#### Arweave

```json
{
  "storage": [{
    "provider": "arweave",
    "uri": "ar://txid_abc123",
    "gateway": "https://arweave.net/"
  }]
}
```

Arweave provides permanent storage with a single upfront payment. The Arweave transaction ID is NOT a content hash — consumers MUST verify the content hash independently after retrieval.

#### HTTPS (Centralized Fallback)

```json
{
  "storage": [{
    "provider": "https",
    "uri": "https://jinn.network/docs/blog-growth/1.2.0.json",
    "contentDigest": "sha-256=:YWJjZGVm...:"
  }]
}
```

HTTPS storage is centralized and mutable. The `contentDigest` header (RFC 9530) provides a verification mechanism, but the content could change. Consumers MUST verify the content hash after retrieval.

### 8.3 Mutable Metadata Overlay

Documents are immutable (content-addressed). Metadata that changes over time lives in a **mutable metadata overlay** separate from the document itself.

The overlay is accessed via the registry entry or the well-known endpoint:

```json
{
  "contentHash": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  "overlay": {
    "accessCount": 1523,
    "lastAccessed": "2026-02-24T15:30:00Z",
    "reputationSummary": {
      "count": 42,
      "average": 92.5
    },
    "validationSummary": {
      "count": 3,
      "averageResponse": 88
    },
    "deprecated": false,
    "supersededBy": null
  }
}
```

The overlay is NOT part of the document's content hash. It is maintained by the registry, the publisher, or any interested indexer.

---

## 9. Conformance Levels

ADW defines three conformance levels to enable incremental adoption:

### Level 1: Addressable

A document is ADW Level 1 conformant if it has:

- A content hash (CID) computed per Section 3.2
- A Registration File with all REQUIRED core metadata fields (Section 4.1)

This is the minimum for a document to participate in the ADW ecosystem. It can be referenced by content hash, and its metadata can be read by any ADW-aware consumer.

### Level 2: Discoverable

A document is ADW Level 2 conformant if it meets Level 1 AND:

- Is registered on an ADW-conformant registry (Section 5.2)
- Has a creator binding at Level 1 (signed) or higher (Section 6.1)
- The publisher hosts a `/.well-known/adw.json` endpoint (Section 5.1)

This enables discovery by other agents and provides basic creator verification.

### Level 3: Verifiable

A document is ADW Level 3 conformant if it meets Level 2 AND:

- Has execution provenance (Section 7.2) with at least one on-chain verification point
- Has at least one Verifiable Credential attestation (Section 6.3)
- Has reputation or validation data on an ERC-8004-compatible registry (Section 6.4)

This is the full trust model where a document's entire creation chain is independently verifiable.

---

## Appendix A: JSON Schema — Core Registration File

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://adw.dev/v0.1/registration.schema.json",
  "title": "ADW Registration File",
  "type": "object",
  "required": [
    "type",
    "@context",
    "documentType",
    "version",
    "name",
    "description",
    "contentHash",
    "creator",
    "created"
  ],
  "properties": {
    "type": {
      "const": "https://adw.dev/v0.1#registration"
    },
    "@context": {
      "type": "string"
    },
    "documentType": {
      "type": "string",
      "pattern": "^adw:[A-Z][a-zA-Z]+$"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "name": {
      "type": "string",
      "maxLength": 256
    },
    "description": {
      "type": "string",
      "maxLength": 2048
    },
    "contentHash": {
      "type": "string"
    },
    "creator": {
      "type": "string"
    },
    "created": {
      "type": "string",
      "format": "date-time"
    },
    "license": {
      "type": "string"
    },
    "language": {
      "type": "string"
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    },
    "supersedes": {
      "type": "string"
    },
    "supersededBy": {
      "type": ["string", "null"]
    },
    "deprecated": {
      "type": "boolean"
    },
    "identifiers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["system", "id"],
        "properties": {
          "system": { "type": "string" },
          "id": { "type": "string" }
        }
      }
    },
    "storage": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["provider", "uri"],
        "properties": {
          "provider": { "type": "string" },
          "uri": { "type": "string" },
          "gateway": { "type": "string" },
          "contentDigest": { "type": "string" }
        }
      }
    },
    "profile": {
      "type": "object"
    },
    "provenance": {
      "type": "object"
    },
    "trust": {
      "type": "object"
    }
  }
}
```

---

## Appendix B: Comparison with Related Standards

| Capability | ADW | ERC-8004 | OLAS Registry | C2PA | AT Protocol | W3C VCs |
|-----------|-----|---------|---------------|------|-------------|---------|
| Document identity | Content hash + registry + name | Agent NFT ID | Component/Agent/Service NFT | Content hash | Record key | Credential ID |
| Versioning | Semantic versioning + hash chain | URI update | New hash = new version | Manifest chain | Record versions | Credential refresh |
| Discovery | Well-known + registry query | Agent card + registry | Marketplace | Embedded | XRPC | Issuer endpoints |
| Creator binding | DID/wallet/agent signature | Wallet ownership | Wallet ownership | Certificate chain | DID signature | Issuer DID |
| Reputation | ERC-8004 registry (reused) | Built-in | External | N/A | Social graph | N/A |
| Validation | ERC-8004 registry (reused) | Built-in | External | N/A | Moderation | Verifier logic |
| Supply chain | Execution provenance | N/A | N/A | Media provenance | N/A | Credential chains |
| Storage | Agnostic (IPFS, Arweave, HTTPS) | URI (any) | IPFS | Embedded | PDS | N/A |
| Cross-chain | Multi-identifier model | Multi-chain deployment | Ethereum + Base | N/A | N/A | N/A |
| Agent-native types | Blueprint, Skill, Template, etc. | Agent services only | Component, Agent, Service | Media types | Social content | Claims |

---

## Appendix C: Examples from Jinn Patterns

### C.1 Blueprint Registration (Blog Growth Template)

```json
{
  "type": "https://adw.dev/v0.1#registration",
  "@context": "https://adw.dev/v0.1",
  "documentType": "adw:Blueprint",
  "version": "1.2.0",
  "name": "Blog Growth Template",
  "description": "Autonomous blog growth with content creation, distribution, analytics, and site branding",
  "contentHash": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  "creator": "eip155:8453:0x8004A169b82E3EC6E547b5f3EfD3786738E35447:7",
  "created": "2026-02-24T00:00:00Z",
  "license": "MIT",
  "tags": ["content", "growth", "blog", "autonomous", "multi-agent"],
  "identifiers": [
    { "system": "adw", "id": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" },
    { "system": "olas", "id": "ethereum:component:315" },
    { "system": "ens", "id": "jinn.eth/blog-growth" }
  ],
  "storage": [
    {
      "provider": "ipfs",
      "uri": "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      "gateway": "https://gateway.autonolas.tech/ipfs/"
    }
  ],
  "profile": {
    "invariants": [
      {
        "id": "GOAL-MISSION",
        "type": "BOOLEAN",
        "condition": "All content aligns with stated mission"
      },
      {
        "id": "GOAL-CONTENT",
        "type": "FLOOR",
        "metric": "content_quality_score",
        "min": 70
      },
      {
        "id": "GOAL-GROWTH-MONTHLY",
        "type": "FLOOR",
        "metric": "month_over_month_visitor_growth_percent",
        "min": 5
      }
    ],
    "inputSchema": {
      "type": "object",
      "required": ["blogName", "mission"],
      "properties": {
        "blogName": { "type": "string" },
        "mission": { "type": "string" },
        "strategy": { "type": "string" },
        "sources": { "type": "array", "items": { "type": "string" } }
      }
    },
    "outputSpec": {
      "type": "object",
      "required": ["liveBlogUrl"],
      "properties": {
        "liveBlogUrl": { "type": "string" }
      }
    },
    "enabledTools": [
      { "name": "blog_create_post", "required": true },
      { "name": "blog_list_posts", "required": true },
      { "name": "google_web_search", "required": false },
      { "name": "telegram_messaging", "required": true }
    ],
    "safetyTier": "standard"
  }
}
```

### C.2 Skill Registration (OLAS Registry Management)

```json
{
  "type": "https://adw.dev/v0.1#registration",
  "@context": "https://adw.dev/v0.1",
  "documentType": "adw:Skill",
  "version": "1.0.0",
  "name": "OLAS Registry Management",
  "description": "Register and manage OLAS protocol entries (components, agents, services). Handles metadata upload, on-chain minting, and marketplace verification.",
  "contentHash": "bafybeiskillhashexample...",
  "creator": "did:web:jinn.network",
  "created": "2026-01-15T00:00:00Z",
  "license": "MIT",
  "tags": ["olas", "registry", "blockchain", "ethereum", "base"],
  "profile": {
    "format": "markdown",
    "allowedTools": ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
    "triggers": [
      "register component on OLAS",
      "mint agent on registry",
      "create service on Base"
    ],
    "targetAgent": "claude-code"
  }
}
```

### C.3 Artifact with Execution Provenance

```json
{
  "type": "https://adw.dev/v0.1#registration",
  "@context": "https://adw.dev/v0.1",
  "documentType": "adw:Artifact",
  "version": "1.0.0",
  "name": "Blog Growth Cycle 47 Summary",
  "description": "Cycle summary with metrics, content performance analysis, and strategy adjustments",
  "contentHash": "bafybeicyclesummarycid...",
  "creator": "eip155:8453:0x8004A169b82E3EC6E547b5f3EfD3786738E35447:7",
  "created": "2026-02-24T15:30:00Z",
  "profile": {
    "topic": "blog-growth",
    "artifactType": "SITUATION",
    "sourceExecution": {
      "requestId": "0x7a8b9c...",
      "jobDefinitionId": "blog-growth-root-047",
      "agentId": "eip155:8453:0x8004A169...E35447:7"
    },
    "contentPreview": "Cycle 47: Published 5 posts, 12% traffic growth, top performer was AI agent comparison guide",
    "utilityScore": 88
  },
  "provenance": {
    "method": "agent-execution",
    "execution": {
      "agent": "eip155:8453:0x8004A169...E35447:7",
      "requestId": "0x7a8b9c...",
      "blueprint": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      "tools": ["blog_get_stats", "blog_get_top_pages", "blog_list_posts"],
      "chain": "eip155:8453",
      "deliveryTransaction": "0xdelivery_txhash...",
      "timestamp": "2026-02-24T15:30:00Z",
      "duration": "PT2M45S"
    },
    "derivedFrom": [
      {
        "contentHash": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
        "relationship": "blueprint"
      },
      {
        "contentHash": "bafybeipreviouscyclesummary...",
        "relationship": "context"
      }
    ]
  }
}
```

---

## Appendix D: DID Method Recommendations

| Scenario | Recommended Method | Rationale |
|----------|-------------------|-----------|
| Organization publishing documents | `did:web` | Leverages existing domain infrastructure |
| Agent producing documents | `did:pkh` or ERC-8004 agent ID | Ties to on-chain identity |
| Ephemeral/temporary documents | `did:key` | No infrastructure required |
| Cross-chain documents | `did:pkh` with CAIP-10 | Chain-agnostic address format |

---

---

## Appendix E: Jinn Strategic Recommendation

### The Landscape

The agent document space is fragmenting across incompatible approaches:

| Approach | Players | Scope | Trust Model |
|----------|---------|-------|-------------|
| **SKILL.md files** | Anthropic, GitHub, VS Code, Cursor | Skill discovery only | None (trust the source) |
| **ERC-8004** | MetaMask, Ethereum Foundation, Google, Coinbase | Agent identity + reputation | On-chain reputation + validation |
| **OASF** | AGNTCY | Capability taxonomy | None (classification only) |
| **OLAS Registry** | Autonolas | Component/agent/service identity | On-chain hash anchoring |
| **MCP** | Anthropic (Linux Foundation) | Tool communication protocol | None (protocol-level only) |

Nobody is connecting these into a coherent document identity + trust + provenance system. ADW fills this gap.

### What Jinn Should Do

**1. Publish ADW as an open specification.** Move this spec to a standalone repository (e.g., `github.com/adw-spec/adw`) and publish it openly. The spec is implementation-agnostic by design — it should not be perceived as a Jinn-only thing.

**2. Build a reference implementation.** Jinn's existing patterns (artifacts on IPFS, templates in Supabase, blueprints in JSON, OLAS registry entries) are already 80% of an ADW implementation. The work is:
- Generate ADW Registration Files for existing templates and blueprints
- Host a `/.well-known/adw.json` on jinn.network
- Register key documents on the ERC-8004 Identity Registry (same contract, different tokenURI schema)
- Add provenance metadata to artifact delivery

**3. Talk to the ERC-8004 authors.** The pitch: "You built the trust layer for agents. Here's the equivalent for documents — same pattern, different schema." Davide Crapis (Ethereum Foundation) is reachable via David M. Marco De Rossi (MetaMask) and Jordan Ellis (Google) are the other key contacts. Positioning ADW as a natural companion to ERC-8004 — potentially as an ERC-800X sibling standard — gives it instant credibility and distribution.

**4. Talk to ENS.** The named identity layer (`jinn.eth/blog-growth:1.2.0`) is a natural extension of ENS. ENS already supports arbitrary records. ADW could define an ENS record type for document resolution.

**5. Talk to OLAS/Autonolas.** Jinn's existing OLAS registry entries (Component 315 etc.) are already proto-ADW documents. Positioning ADW as a generalization of the OLAS metadata pattern creates alignment.

### Migration Priority

| Jinn Pattern | ADW Type | Migration Effort | Value |
|-------------|----------|-----------------|-------|
| Blueprints (`blueprints/*.json`) | `adw:Blueprint` | Low — add Registration File wrapper | High — enables blueprint marketplace |
| Templates (Supabase) | `adw:Template` | Medium — generate Registration Files from DB | High — enables cross-platform template discovery |
| Skills (`skills/*/SKILL.md`) | `adw:Skill` | Low — already SKILL.md format, add ADW metadata | Medium — Anthropic compatibility already exists |
| Artifacts (IPFS + Ponder) | `adw:Artifact` | Medium — add provenance to delivery flow | Very High — execution provenance is the novel contribution |
| OLAS entries | `adw:AgentCard` | Low — wrap existing OLAS metadata | Medium — bridges OLAS and ERC-8004 ecosystems |

### What ADW Gives Jinn Strategically

1. **Thought leadership** — Jinn becomes the team that defined the document layer of the agentic web, alongside Google (A2A), MetaMask/EF (ERC-8004), and Anthropic (MCP/Skills)
2. **Network effects** — Every organization that adopts ADW makes Jinn's documents more discoverable and Jinn's marketplace more valuable
3. **Execution provenance moat** — Jinn already has on-chain execution records (MarketplaceRequest/Deliver events). No one else has this data. ADW formalizes it into a verifiable provenance standard.
4. **Platform conversations** — ADW creates concrete reasons to talk to ENS, OLAS, Ethereum Foundation, Solana, and AI framework teams. Each conversation is "we've built this spec, want to implement it for your ecosystem?"

---

*End of ADW Specification v0.1 (Draft)*
