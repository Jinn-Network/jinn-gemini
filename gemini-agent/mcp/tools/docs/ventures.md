# Ventures MCP Tools

This document describes how to use the ventures MCP tools for managing ventures in the Jinn platform.

## Overview

Ventures are project entities that own workstreams and services. Each venture has:
- A blueprint containing invariants (success criteria)
- An owner address (Ethereum address)
- Optional workstream and job instance associations

## Available Tools

| Tool | Operation | Description |
|------|-----------|-------------|
| `venture_mint` | CREATE | Create a new venture |
| `venture_query` | READ | Query ventures by ID, slug, workstream, or list all |
| `venture_update` | UPDATE | Modify venture fields |
| `venture_delete` | DELETE | Archive (soft) or permanently delete a venture |

## Architecture

```
Gemini Agent
    ↓ (calls MCP tool)
Gemini MCP Server (gemini-agent/mcp/server.ts)
    ↓ (calls script functions)
Scripts Library (scripts/ventures/*.ts)
    ↓ (uses Supabase client)
Supabase Database
```

---

## venture_mint (CREATE)

Create a new venture with a blueprint defining its invariants.

### Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `name` | Yes | string | Venture display name |
| `ownerAddress` | Yes | string | Ethereum address of the owner (0x...) |
| `blueprint` | Yes | string | JSON string with invariants array |
| `slug` | No | string | URL-friendly identifier (auto-generated from name) |
| `description` | No | string | Venture description |
| `rootWorkstreamId` | No | string | Associated workstream UUID |
| `rootJobInstanceId` | No | string | Associated root job instance UUID |
| `status` | No | enum | 'active', 'paused', or 'archived' (default: active) |

### Example

```json
{
  "name": "My Venture",
  "ownerAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "blueprint": "{\"invariants\":[{\"id\":\"INV-001\",\"description\":\"Test invariant\"}]}",
  "description": "A test venture",
  "status": "active"
}
```

### Response

```json
{
  "data": {
    "venture": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "My Venture",
      "slug": "my-venture",
      "description": "A test venture",
      "owner_address": "0x1234...",
      "blueprint": { "invariants": [...] },
      "status": "active",
      "created_at": "2026-01-29T12:00:00Z",
      "updated_at": "2026-01-29T12:00:00Z"
    }
  },
  "meta": { "ok": true }
}
```

---

## venture_query (READ)

Query ventures from the registry. Supports multiple modes.

### Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `mode` | No | enum | 'get', 'list', 'by_slug', 'by_workstream' (default: list) |
| `id` | For get | string | Venture UUID |
| `slug` | For by_slug | string | Venture slug |
| `workstreamId` | For by_workstream | string | Root workstream UUID |
| `status` | No | enum | Filter by 'active', 'paused', 'archived' |
| `limit` | No | number | Maximum results (default: 20) |
| `offset` | No | number | Pagination offset (default: 0) |

### Mode Examples

**Get by ID:**
```json
{
  "mode": "get",
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**List active ventures:**
```json
{
  "mode": "list",
  "status": "active",
  "limit": 10
}
```

**Find by slug:**
```json
{
  "mode": "by_slug",
  "slug": "my-venture"
}
```

**Find by workstream:**
```json
{
  "mode": "by_workstream",
  "workstreamId": "workstream-uuid-here"
}
```

### Response (Single)

```json
{
  "data": {
    "venture": { ... }
  },
  "meta": { "ok": true }
}
```

### Response (List)

```json
{
  "data": {
    "ventures": [ ... ],
    "total": 5
  },
  "meta": { "ok": true }
}
```

---

## venture_update (UPDATE)

Update an existing venture's properties. Only provided fields are modified.

### Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `id` | Yes | string | Venture UUID to update |
| `name` | No | string | New venture name |
| `slug` | No | string | New URL-friendly identifier |
| `description` | No | string | New description |
| `blueprint` | No | string | New JSON string with invariants array |
| `rootWorkstreamId` | No | string | New workstream UUID |
| `rootJobInstanceId` | No | string | New root job instance UUID |
| `status` | No | enum | 'active', 'paused', 'archived' |

### Example

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Updated Venture Name",
  "status": "paused"
}
```

### Response

```json
{
  "data": {
    "venture": { ... }
  },
  "meta": { "ok": true }
}
```

---

## venture_delete (DELETE)

Delete or archive a venture.

### Parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `id` | Yes | string | Venture UUID to delete |
| `mode` | No | enum | 'soft' (archive) or 'hard' (permanent) - default: soft |
| `confirm` | For hard | boolean | Must be `true` for permanent deletion |

### Soft Delete (Archive)

Sets status to 'archived'. Venture can be restored later.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "mode": "soft"
}
```

### Hard Delete (Permanent)

⚠️ **Cannot be undone!**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "mode": "hard",
  "confirm": true
}
```

### Response (Soft)

```json
{
  "data": {
    "venture": { ... }
  },
  "meta": { "ok": true }
}
```

### Response (Hard)

```json
{
  "data": {
    "deleted": true,
    "id": "550e8400-e29b-41d4-a716-446655440000"
  },
  "meta": { "ok": true }
}
```

---

## Error Response Format

All tools return errors in this format:

```json
{
  "data": null,
  "meta": {
    "ok": false,
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Invalid parameters |
| `NOT_FOUND` | Venture not found |
| `EXECUTION_ERROR` | Runtime error |
| `CONFIRMATION_REQUIRED` | Hard delete requires confirm: true |

---

## Best Practices

1. **Use soft delete by default** - Archive ventures rather than permanently deleting
2. **Validate blueprints** - Ensure blueprint JSON has an `invariants` array
3. **Use slugs for lookups** - Slugs are human-readable and unique
4. **Paginate large lists** - Use `limit` and `offset` for efficiency
5. **Link to workstreams** - Associate ventures with workstreams for automation

---

## Related Documentation

- [Creating Ventures Guide](../../../../docs/ventures/creating-ventures.md)
- [VSR Verification](../../../../docs/planning/VSR-VERIFICATION.md)
