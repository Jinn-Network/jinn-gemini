# Agentic Document Web (ADW)

An open specification for decentralized agent document identity, discovery, trust, and provenance.

## The Problem

The agentic AI ecosystem produces and consumes vast quantities of documents — skills, blueprints, templates, configurations, knowledge artifacts, and content outputs. These documents are the substrate of the agentic web, yet there is no open standard for how they get identity, discovery, trust, and supply chain verification.

## The Approach

ADW is a **protocol profile** that composes existing standards into a coherent system for agent documents:

- **W3C DIDs** for creator identity
- **IPFS/IPLD (DASL)** for content-addressed document identity
- **ERC-8004** for on-chain registration, reputation, and validation
- **W3C Verifiable Credentials** for trust attestations
- **JSON-LD** for extensible metadata

ADW is a **companion to ERC-8004**, not a competitor. ERC-8004 is the trust layer for agents. ADW is the trust layer for the documents agents produce and consume. Same registry pattern, different registration schema.

## Key Capabilities

| Layer | What ADW Provides |
|-------|-------------------|
| **Identity** | Composite ADW-ID: content hash (immutable) + registry entry (on-chain) + human-readable name |
| **Metadata** | Core schema + extensible type-specific profiles (Blueprint, Skill, Template, Artifact, etc.) |
| **Discovery** | Well-known endpoints + registry interface + federated queries + MCP/A2A/ERC-8004 protocol exposure |
| **Trust** | 4-level model: Declared → Signed → Reputation-Backed → Provenance-Verified |
| **Provenance** | Execution provenance: agent + blueprint + inputs → output, verifiable on-chain |
| **Storage** | Agnostic interface with bindings for IPFS, Arweave, HTTPS |

## Document Types

| Type | Description |
|------|-------------|
| `adw:Blueprint` | Execution specification with invariants/constraints |
| `adw:Skill` | Instructions that extend agent capabilities (SKILL.md compatible) |
| `adw:Template` | Reusable workflow definition with input/output schemas |
| `adw:Artifact` | Output produced by agent execution |
| `adw:Configuration` | Parameters that customize behavior |
| `adw:Knowledge` | Reference material consumed by agents |

## Quick Example

```json
{
  "type": "https://adw.dev/v0.1#registration",
  "@context": "https://adw.dev/v0.1",
  "documentType": "adw:Blueprint",
  "version": "1.2.0",
  "name": "Blog Growth Template",
  "description": "Autonomous blog growth with content creation and analytics",
  "contentHash": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  "creator": "eip155:8453:0x8004A169b82E3EC6E547b5f3EfD3786738E35447:7",
  "created": "2026-02-24T00:00:00Z",
  "license": "MIT"
}
```

## Specification

Read the full spec: **[spec.md](spec.md)**

## Status

**v0.1 Draft** — This specification is in early draft stage. Feedback and contributions are welcome.

## Design Principles

1. **Compose, don't invent.** Profile existing standards; extend only where gaps exist.
2. **Implementation agnostic.** Works across chains (Ethereum, Solana), storage (IPFS, Arweave), and naming services (ENS, DNS).
3. **Companion to ERC-8004.** Same registry pattern, extended for documents.
4. **Content addressing as canonical identity.** The content hash is truth.
5. **Verification over reputation.** Where verification is possible, prefer it.
6. **Incremental adoption.** Each layer is independently useful.

## Related Standards

| Standard | Relationship |
|----------|-------------|
| [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) | ADW extends the same registry pattern from agents to documents |
| [A2A Protocol](https://a2a-protocol.org) | ADW mirrors the well-known endpoint discovery pattern |
| [Anthropic Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) | ADW's Skill type is SKILL.md compatible |
| [OASF](https://docs.agntcy.org/oasf/open-agentic-schema-framework/) | ADW adopts OASF taxonomy for capability classification |
| [W3C DIDs](https://www.w3.org/TR/did-1.0/) | Used for creator and document identity |
| [W3C VCs](https://www.w3.org/TR/vc-data-model-2.0/) | Used for trust attestations |
| [DASL](https://dasl.ing/) | Content addressing conventions |
| [C2PA](https://c2pa.org/) | Provenance model inspiration (adapted for agent execution) |

## License

[CC-BY-4.0](LICENSE)
