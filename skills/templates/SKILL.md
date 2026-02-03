---
name: templates
description: Use when creating, registering, or deploying new job templates for the Jinn platform. Templates define reusable workstream blueprints with input schemas, output specs, invariants, and tool requirements. They are executed via the x402-gateway service.
allowed-tools: register_template
---

# Job Templates

You have access to template management for the Jinn platform. Templates are reusable workstream blueprints that define:
- **Input schema**: What parameters the template accepts
- **Output spec**: What the template returns on completion
- **Invariants**: Success criteria and constraints for the agent
- **Tools**: Required and optional MCP tools

## Architecture

**Key insight: Templates are registered on-chain when first executed with a unique job definition.**

"Seeding" a template means **running it for the first time**. The on-chain execution creates the job definition record, which Ponder indexes into the database.

```
Template Blueprint (JSON)
    ↓
First Execution (dispatch_new_job / marketplaceInteract)
    ↓
On-chain Job Definition Created
    ↓
Ponder Indexes → job_template table
    ↓
x402-gateway GET /templates/:id (now available)
```

Database seeding scripts exist for development/testing to pre-populate templates without on-chain execution.

## Template Structure

Templates live in `blueprints/<template-id>.json`:

```json
{
  "templateMeta": {
    "id": "my-template",
    "name": "My Template",
    "description": "What this template does",
    "priceWei": "0",
    "inputSchema": {
      "type": "object",
      "properties": {
        "param1": {
          "type": "string",
          "description": "Parameter description",
          "envVar": "OPTIONAL_ENV_MAPPING"
        }
      },
      "required": ["param1"]
    },
    "outputSpec": {
      "version": "1.0",
      "fields": [
        { "name": "result", "path": "$.result.value", "type": "string", "required": true }
      ]
    },
    "tools": [
      { "name": "tool_name", "required": true },
      { "name": "optional_tool", "required": false }
    ]
  },
  "invariants": [
    {
      "id": "GOAL-001",
      "type": "BOOLEAN",
      "condition": "What the agent must do",
      "assessment": "How to verify the condition was met",
      "examples": {
        "do": ["Good behavior examples"],
        "dont": ["Bad behavior examples"]
      }
    }
  ]
}
```

## Creating a New Template

### Step 1: Create Blueprint JSON

Create `blueprints/<template-id>.json` with:

1. **templateMeta.id**: URL-friendly identifier (lowercase, hyphens)
2. **templateMeta.name**: Human-readable display name
3. **templateMeta.description**: Clear description of purpose
4. **templateMeta.inputSchema**: JSON Schema for inputs
   - Use `envVar` to map inputs to worker environment variables
5. **templateMeta.outputSpec**: Fields extracted from result
   - `path` uses JSONPath syntax (e.g., `$.result.fieldName`)
6. **templateMeta.tools**: Required and optional MCP tools
7. **invariants**: BOOLEAN-type constraints with examples

### Step 2: Create Test Input Config

Create `blueprints/inputs/<template-id>-test.json`:

```json
{
  "param1": "test value",
  "param2": "another value"
}
```

### Step 3: Create Seeding Script

Create `scripts/templates/seed-<template-id>.ts`:

```typescript
#!/usr/bin/env tsx
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import { parseAnnotatedTools } from '../../gemini-agent/shared/template-tools.js';

dotenv.config();

const TEMPLATE_FILE = join(process.cwd(), 'blueprints', '<template-id>.json');

// Copy the pattern from scripts/templates/seed-blog-growth-template.ts
// Key functions:
// - getPonderDatabaseUrl()
// - discoverActiveSchema()
// - computeBlueprintHash()
// - main() with upsert logic
```

### Step 4: Seed Template (Run First Execution)

**Templates are registered on-chain when first executed.** There are two approaches:

**Option A: Direct execution (production)**
```bash
# Dispatch the template as a job - this registers it on-chain
yarn launch:workstream <template-id> --input blueprints/inputs/<template-id>-test.json
```

**Option B: Database pre-population (development/testing)**
```bash
# Dry run (preview what would be inserted)
yarn tsx scripts/templates/seed-<template-id>.ts --dry-run

# Insert into database (bypasses on-chain registration)
yarn tsx scripts/templates/seed-<template-id>.ts
```

Option B is useful for development but the template won't have an on-chain job definition until it's actually executed.

### Step 5: Test via x402-gateway

```bash
# Check gateway health
curl https://<gateway-url>/health

# List templates
curl https://<gateway-url>/templates

# Get template details
curl https://<gateway-url>/templates/<template-id>

# Execute template
curl -X POST https://<gateway-url>/templates/<template-id>/execute \
  -H "Content-Type: application/json" \
  -d '{"input": {...}}'

# Check result
curl https://<gateway-url>/runs/<requestId>/result
```

## Invariant Types

Templates use invariants to define success criteria:

| Type | Description | Properties |
|------|-------------|------------|
| `BOOLEAN` | Pass/fail condition | `condition`, `assessment`, `examples` |
| `FLOOR` | Minimum threshold | `metric`, `min`, `assessment`, `examples` |
| `CEILING` | Maximum threshold | `metric`, `max`, `assessment`, `examples` |
| `RANGE` | Within bounds | `metric`, `min`, `max`, `assessment`, `examples` |

**Example BOOLEAN invariant:**
```json
{
  "id": "GOAL-001",
  "type": "BOOLEAN",
  "condition": "You post results to Telegram using telegram_send_message",
  "assessment": "Verify telegram_send_message was called with correct parameters",
  "examples": {
    "do": ["Format with HTML tags", "Include relevant links"],
    "dont": ["Post unformatted text", "Exceed 4096 char limit"]
  }
}
```

**Example FLOOR invariant:**
```json
{
  "id": "QUALITY-001",
  "type": "FLOOR",
  "metric": "content_quality_score",
  "min": 70,
  "assessment": "Rate output 0-100 on: accuracy (25%), clarity (25%), completeness (25%), actionability (25%)"
}
```

## Input Schema with Environment Variables

Use `envVar` to inject input values as environment variables on the worker:

```json
{
  "properties": {
    "telegramChatId": {
      "type": "string",
      "description": "Telegram chat ID",
      "envVar": "TELEGRAM_CHAT_ID"
    }
  }
}
```

When the template executes, `TELEGRAM_CHAT_ID` will be set to the provided value.

## Output Spec

Define what fields to extract from the job result. **This is where output requirements belong - NOT in invariants.**

```json
{
  "version": "1.0",
  "fields": [
    { "name": "messageLink", "path": "$.result.messageLink", "type": "string", "required": true },
    { "name": "count", "path": "$.result.count", "type": "number", "required": true },
    { "name": "details", "path": "$.result.details", "type": "object", "required": false }
  ]
}
```

Paths use JSONPath syntax to extract values from the delivery payload.

**Important:** Do NOT create invariants for output fields. The `outputSpec` already defines required outputs. Invariants are for **behavioral constraints** (what the agent must/must not do), not for specifying what fields to return.

## Tool Policy

Specify which MCP tools the template needs:

```json
{
  "tools": [
    { "name": "telegram_messaging", "required": true },
    { "name": "github_list_commits", "required": true },
    { "name": "web_search", "required": false }
  ]
}
```

- **required: true** - Template will fail if tool is unavailable
- **required: false** - Tool is optional/nice-to-have

## Existing Templates

| Template ID | Description | Location |
|-------------|-------------|----------|
| `blog-growth` | Autonomous blog growth with content, analytics, distribution | `blueprints/blog-growth-template.json` |
| `blog-growth-orchestrator` | Multi-manager orchestrator for blog growth | `blueprints/blog-growth-orchestrator.json` |

## CLI Scripts

```bash
# Seed a template
yarn tsx scripts/templates/seed-blog-growth-template.ts

# Seed with dry run
yarn tsx scripts/templates/seed-blog-growth-template.ts --dry-run
```

## Best Practices

1. **Use BOOLEAN invariants** - They're the most common and clearest type
2. **Focus on behavior, not outputs** - Invariants define what the agent must/must not DO, not what to return
3. **Output goes in outputSpec** - Never create invariants for output field requirements
4. **Include examples** - `do` and `dont` examples help agents understand intent
5. **Keep tools minimal** - Only require tools the template truly needs
6. **Use envVar for secrets** - Map sensitive inputs to environment variables
7. **Seed by executing** - Templates are registered on-chain when first run
8. **Validate output paths** - Ensure JSONPath expressions match expected result structure

## Debugging

**Template not appearing in /templates:**
- Check Ponder is running and healthy
- Verify template was seeded (check database)
- Ensure `status` is `'visible'` not `'hidden'`

**Template execution failing:**
- Check x402-gateway logs in Railway
- Verify required env vars are set on worker
- Check invariants aren't too strict

**Output fields missing:**
- Verify JSONPath expressions in outputSpec
- Check agent actually produced the expected output structure
