---
name: ventures
description: Managing ventures in the Jinn platform registry. Use when creating, querying, updating, or deleting ventures. Use when working with venture blueprints, invariants, or owner addresses. Use when asked about "ventures", "projects in the registry", or "venture CRUD operations".
---

# Ventures Registry

You have access to ventures management tools for the Jinn platform. Ventures are project entities that own workstreams and services.

## Architecture

```
Gemini Agent -> MCP Tools -> Scripts (scripts/ventures/*.ts) -> Supabase
```

## Available MCP Tools

| Tool | Operation | Description |
|------|-----------|-------------|
| `venture_mint` | CREATE | Create a new venture with blueprint and owner |
| `venture_query` | READ | Query ventures by ID, slug, workstream, or list all |
| `venture_update` | UPDATE | Update venture fields |
| `venture_delete` | DELETE | Archive (soft) or permanently delete |

## CREATE - venture_mint

Create a new venture with a blueprint defining success criteria.

**Required parameters:**
- `name`: Venture display name
- `ownerAddress`: Ethereum address (0x...)
- `blueprint`: JSON string with invariants array

**Optional parameters:**
- `slug`: URL-friendly identifier (auto-generated from name)
- `description`: Venture description
- `rootWorkstreamId`: Associated workstream UUID
- `rootJobInstanceId`: Associated root job instance UUID
- `status`: 'active', 'paused', or 'archived' (default: active)

**Example:**
```json
{
  "name": "My Venture",
  "ownerAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "blueprint": "{\"invariants\":[{\"id\":\"INV-001\",\"description\":\"Test invariant\"}]}",
  "status": "active"
}
```

## READ - venture_query

Supports multiple query modes:

**Get by ID:**
```json
{ "mode": "get", "id": "<uuid>" }
```

**Get by slug:**
```json
{ "mode": "by_slug", "slug": "my-venture" }
```

**Find by workstream:**
```json
{ "mode": "by_workstream", "workstreamId": "<workstream-uuid>" }
```

**List with filters:**
```json
{ "mode": "list", "status": "active", "limit": 20, "offset": 0 }
```

## UPDATE - venture_update

Update any combination of venture fields. Only provided fields are modified.

```json
{
  "id": "<uuid>",
  "name": "Updated Name",
  "status": "paused"
}
```

## DELETE - venture_delete

**Soft delete (archive)** - can be restored:
```json
{ "id": "<uuid>", "mode": "soft" }
```

**Hard delete (permanent)** - cannot be undone:
```json
{ "id": "<uuid>", "mode": "hard", "confirm": true }
```

## Blueprint Format

Blueprints define success criteria (invariants) for a venture:

```json
{
  "invariants": [
    {
      "id": "inv-availability",
      "name": "Service Availability",
      "description": "All production services maintain 99.9% uptime",
      "type": "availability",
      "threshold": 0.999
    }
  ]
}
```

## Response Format

**Success:**
```json
{
  "data": { "venture": { ... } },
  "meta": { "ok": true }
}
```

**Error:**
```json
{
  "data": null,
  "meta": { "ok": false, "code": "ERROR_CODE", "message": "..." }
}
```

## Best Practices

1. **Use soft delete by default** - Archive ventures rather than permanently deleting
2. **Validate blueprints** - Ensure blueprint JSON has an `invariants` array
3. **Use slugs for lookups** - Slugs are human-readable and unique
4. **Use venture_query modes** - Choose the appropriate mode for your lookup
5. **Link to workstreams** - Associate ventures with workstreams for automation
