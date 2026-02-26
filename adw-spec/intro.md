# Agentic Document Web (ADW) in Plain Language

## What this is

ADW is a shared way to label and verify documents used by AI agents.

Think of it as:
- a **passport system** for agent documents
- a **public record** of who made a document
- a **tamper check** to prove the document has not changed
- a **paper trail** showing how an output was produced

## Why this matters

Agents do real work using documents:
- skills (`SKILL.md`)
- blueprints
- templates
- config files
- reports and other outputs

Today, these are scattered across repos, databases, and storage networks with different trust models. ADW makes them easier to discover and safer to use across teams, tools, and platforms.

## The core idea

Every document gets a stable identity based on its content hash.

That means:
- if the content changes, the hash changes
- if the hash matches, you know the content is exactly what was published

On top of that, ADW can add:
- an on-chain registry entry (for discoverability and reputation)
- a human-readable name
- signed attestations and provenance proofs

## What ADW does (simple view)

1. **Identity**
   Give documents a stable, verifiable identity.
2. **Discovery**
   Make documents discoverable by agents and humans.
3. **Trust**
   Show trust evidence (signatures, attestations, reputation, provenance).
4. **Provenance**
   Track where a document came from and how it was produced.

## Trust levels

ADW supports a progressive trust model:
- **Declared**: someone claims authorship
- **Signed**: cryptographic signature proves key ownership
- **Reputation-backed**: creator has historical trust signals
- **Provenance-verified**: creation steps can be independently checked

## Relationship to ERC-8004

ERC-8004 is for trustless **agents**.

ADW is the companion for trustless **documents**.

Same idea, different object:
- ERC-8004: "Can I trust this agent?"
- ADW: "Can I trust this document and how it was made?"

## A quick mental model

When an agent outputs a report:
- the report is stored and hashed
- the hash becomes its canonical identity
- metadata says what type of document it is
- creator info ties it to an agent/org/person
- optional provenance links inputs + blueprint + execution to the output

Now another agent can verify before using it.

## What ADW is not

ADW is not:
- a new blockchain
- a storage network
- a specific vendor platform

It is a specification that works with existing standards (DIDs, IPFS/IPLD, ERC-8004, Verifiable Credentials).

## Read next

- You are here: [Plain-language intro](intro.md)
- Continue to the [full technical specification](spec.md)
- For the high-level project overview, see the [repository README](README.md)
