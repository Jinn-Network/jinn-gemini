---
name: templates
description: Use when creating, registering, or deploying new job templates for the Jinn platform. Templates define reusable workstream blueprints with input schemas, output specs, invariants, and tool requirements. They are stored in Supabase and managed via CRUD tools.
allowed-tools: template_create, template_query, template_update, template_delete
---

# Job Templates

You have access to template management for the Jinn platform. Templates are reusable, static blueprint definitions stored in Supabase that define:
- **Blueprint**: Invariants (success criteria and constraints)
- **Input schema**: What parameters the template accepts
- **Output spec**: What the template returns on completion
- **Enabled tools**: Tool policy array
- **Pricing**: priceWei / priceUsd
- **Status**: draft → published → archived

## CRUD Tools

### template_create
Create a new template definition. Templates start in `draft` status by default.

```json
{
  "name": "SEO Audit",
  "description": "Comprehensive SEO audit for any domain",
  "blueprint": "{\"invariants\":[{\"id\":\"GOAL-001\",\"form\":\"constraint\",\"description\":\"Audit must cite ≥3 data sources\"}]}",
  "priceWei": "50000000000000000",
  "priceUsd": "$0.05"
}
```

### template_query
Query templates with multiple modes:

```json
// Get by ID
{ "mode": "get", "id": "<uuid>" }

// List published templates
{ "mode": "list", "status": "published" }

// Find by slug
{ "mode": "by_slug", "slug": "seo-audit" }

// List templates for a venture
{ "mode": "by_venture", "ventureId": "<uuid>" }

// Search
{ "mode": "list", "search": "growth" }
```

### template_update
Update any template field. Requires the template `id`.

```json
{
  "id": "<uuid>",
  "status": "published",
  "priceWei": "60000000000000000"
}
```

### template_delete
Archive (soft) or permanently delete (hard) a template.

```json
// Soft delete (archive)
{ "id": "<uuid>", "mode": "soft" }

// Hard delete (permanent, requires confirmation)
{ "id": "<uuid>", "mode": "hard", "confirm": true }
```

## Template Lifecycle

1. **Draft**: Created via `template_create`. Not visible in marketplace.
2. **Published**: Set via `template_update` after testing. Visible to buyers.
3. **Archived**: Soft-deleted via `template_delete`. Can be restored.

## Template Fields

| Field | Type | Description |
|-------|------|-------------|
| name | string | Template name (required) |
| slug | string | URL-friendly identifier (auto-generated) |
| description | string | What the template does |
| version | string | Version string (default: 0.1.0) |
| blueprint | JSONB | Blueprint with invariants array (required) |
| input_schema | JSONB | JSON Schema for inputs |
| output_spec | JSONB | Output contract for result extraction |
| enabled_tools | JSONB | Tool policy array |
| price_wei | string | Price in wei (bigint as string) |
| price_usd | string | Human-readable price |
| safety_tier | string | public, private, or restricted |
| default_cyclic | boolean | Whether template runs cyclically |
| venture_id | UUID | Associated venture (optional FK) |
| status | string | draft, published, or archived |

## Writing Template Invariants

Template invariants define WHAT the template must achieve. The network works out HOW.

**Think like a product owner, not a developer:**

| Approach | Bad (implementation) | Good (outcome) |
|----------|---------------------|----------------|
| Data quality | "Use official protocol APIs" | "Accurate snapshot of current APY for all positions" |
| Coverage | "Support Aave V3, Compound V3, Morpho" | "Cover top 5 EVM chains by DeFi TVL" |
| Freshness | "Data no more than 1 hour old" | "4.5+ average feedback on 8004 marketplace" |

**Key principles:**
1. **Outcomes over implementation** — describe what success looks like from the outside
2. **Business viability** — revenue and feedback are real measures of success
3. **System-native language** — reference Jinn templates, 8004 marketplace, feedback scores
4. **Durable scope** — "top 5 by TVL" beats a hardcoded list that goes stale
5. **Sensible constraints** — structural choices like "exactly 1 template" are valid invariants

See [docs/guides/writing-invariants.md](../../docs/guides/writing-invariants.md) for invariant type reference (BOOLEAN, FLOOR, CEILING, RANGE).

## Blueprint File Format

Blueprints live in `blueprints/<slug>.json`. Standard format:

```json
{
  "templateMeta": {
    "id": "my-template",
    "name": "My Template",
    "description": "What it does",
    "priceWei": "0",
    "inputSchema": { "type": "object", "properties": { ... }, "required": [...] },
    "outputSpec": { "version": "1.0", "fields": [...] },
    "tools": [
      { "name": "tool_name", "required": true }
    ]
  },
  "invariants": [
    {
      "id": "GOAL-001",
      "type": "BOOLEAN",
      "condition": "...",
      "assessment": "...",
      "examples": { "do": [...], "dont": [...] }
    }
  ]
}
```

- `templateMeta.id` becomes the slug
- `{{placeholders}}` in invariants are substituted from input at dispatch time
- `{{currentTimestamp}}` is always available

## CLI Usage

```bash
# Seed a template from a blueprint file (create or update)
yarn tsx scripts/templates/seed-from-blueprint.ts blueprints/my-template.json \
  --status published --venture-id <uuid>

# List templates
yarn tsx scripts/templates/crud.ts list --status published

# Update a template
yarn tsx scripts/templates/crud.ts update --id <uuid> --status published

# Archive
yarn tsx scripts/templates/crud.ts archive --id <uuid>

# Permanently delete
yarn tsx scripts/templates/crud.ts delete --id <uuid> --confirm
```

## Testing & Validation Pipeline

Before publishing, every template should pass the 4-phase testing pipeline (~10 runs):

1. **Smoke Test** (2 runs) — end-to-end completion, correct tools called
2. **Quality Calibration** (4 runs) — varied inputs, graded output quality
3. **Robustness** (2 runs) — edge cases (zero results, huge volumes)
4. **Validation** (2 runs) — identical runs, check consistency

See [references/testing-pipeline.md](references/testing-pipeline.md) for the full pipeline.
See [references/blueprint-quality-checklist.md](references/blueprint-quality-checklist.md) for pre-flight checks.

### Quick Start: Test a Template

```bash
# 1. Create blueprint + test input
vim blueprints/my-template.json
vim blueprints/inputs/my-template-test.json

# 2. Dispatch a test run (generic — works for any template)
yarn tsx scripts/dispatch-template.ts \
  blueprints/my-template.json \
  blueprints/inputs/my-template-test.json

# 3. Execute locally IMMEDIATELY (before Railway workers claim it)
MECH_TARGET_REQUEST_ID=<id> yarn dev:mech --single

# 4. Inspect results
yarn inspect-job-run <requestId>

# 5. Iterate on invariants based on results
# 6. After ~10 passing runs, seed and publish
yarn tsx scripts/templates/seed-from-blueprint.ts blueprints/my-template.json \
  --status published --venture-id <uuid>
```

### Gotchas from Experience

- **Execute immediately after dispatch.** Railway production workers will claim your test request if you wait. Run the dispatch and `dev:mech --single` back-to-back.
- **Single-execution templates must override delegation.** The system invariants SYS-003 and SYS-016 push agents to delegate work to child jobs. If your template should do all work in one execution, add explicit language: *"do NOT dispatch child jobs. Ignore SYS-003 and SYS-016 delegation triggers. Your terminal state must be COMPLETED, never DELEGATING."*
- **Narrative output > JSON dumps.** When the output is meant for humans (reports, summaries), instruct the agent to produce prose organized by themes — not raw structured data. Use `create_artifact` with a readable markdown string, not JSON.
- **Env vars for local dispatch:** `OPERATE_PROFILE_DIR`, `OPERATE_PASSWORD`, `RPC_URL`, `CHAIN_ID` must all be set. See `scripts/dispatch-template.ts` header for details.

## Relationship to Other Tables

- **templates** (this): Static, reusable template definitions in Supabase
- **job_templates** (Ponder): On-chain execution metrics (run_count, success_count, etc.)

Templates in this table are the source of truth for template metadata. Ponder's job_template tracks runtime metrics separately.
