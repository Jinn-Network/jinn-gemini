---
argument-hint: <action> [options]
description: Manage ventures in the registry (create, get, list, update, delete)
allowed-tools: Bash
---

# Ventures Management

You have access to the Ventures MCP server which provides CRUD operations for managing ventures in the Jinn platform.

## MCP Server

The ventures MCP server is located at `mcp/ventures/server.ts` and exposes these tools:

| Tool | Operation | Description |
|------|-----------|-------------|
| `venture_create` | CREATE | Create a new venture |
| `venture_get` | READ | Get a venture by ID or slug |
| `venture_list` | READ | List ventures with filters |
| `venture_update` | UPDATE | Update venture fields |
| `venture_delete` | DELETE | Archive or permanently delete |

## Starting the MCP Server

To use the ventures MCP, start the server:

```bash
npx tsx mcp/ventures/server.ts
```

Or add to your MCP configuration.

## Tool Usage

### venture_create

Create a new venture:

```json
{
  "tool": "venture_create",
  "params": {
    "name": "My Venture",
    "ownerAddress": "0x1234567890abcdef1234567890abcdef12345678",
    "blueprint": "{\"invariants\":[{\"id\":\"INV-001\",\"description\":\"Test invariant\"}]}",
    "description": "Optional description",
    "status": "active"
  }
}
```

**Required parameters:**
- `name`: Venture display name
- `ownerAddress`: Ethereum address of the owner
- `blueprint`: JSON string with invariants array

**Optional parameters:**
- `slug`: URL-friendly identifier (auto-generated from name)
- `description`: Venture description
- `rootWorkstreamId`: Associated workstream UUID
- `rootJobInstanceId`: Associated root job instance UUID
- `status`: 'active', 'paused', or 'archived' (default: active)

### venture_get

Get a venture by ID or slug:

```json
{
  "tool": "venture_get",
  "params": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

Or by slug:

```json
{
  "tool": "venture_get",
  "params": {
    "slug": "my-venture"
  }
}
```

### venture_list

List ventures with optional filters:

```json
{
  "tool": "venture_list",
  "params": {
    "status": "active",
    "limit": 20
  }
}
```

**Parameters:**
- `status`: Filter by 'active', 'paused', or 'archived'
- `ownerAddress`: Filter by owner Ethereum address
- `limit`: Maximum results (default: 50)
- `offset`: Pagination offset

### venture_update

Update venture fields:

```json
{
  "tool": "venture_update",
  "params": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Updated Name",
    "status": "paused"
  }
}
```

Only provided fields are updated. All fields except `id` are optional.

### venture_delete

**Soft delete (archive):**

```json
{
  "tool": "venture_delete",
  "params": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "mode": "soft"
  }
}
```

**Hard delete (permanent):**

```json
{
  "tool": "venture_delete",
  "params": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "mode": "hard",
    "confirm": true
  }
}
```

⚠️ Hard delete requires `confirm: true` and cannot be undone.

## CLI Alternative

You can also use the CLI scripts directly:

```bash
# Create
yarn tsx scripts/ventures/mint.ts \
  --name "My Venture" \
  --ownerAddress "0x..." \
  --blueprint '{"invariants":[]}'

# Update
yarn tsx scripts/ventures/update.ts \
  --id "<uuid>" \
  --status "paused"
```

## Response Format

All MCP tools return JSON in this format:

**Success:**
```json
{
  "ok": true,
  "data": {
    "venture": { ... }
  }
}
```

**Error:**
```json
{
  "ok": false,
  "error": "Error message"
}
```

## Architecture

```
Claude/Gemini Agent
    ↓ (calls MCP tool)
Ventures MCP Server (mcp/ventures/server.ts)
    ↓ (calls script functions)
Scripts Library (scripts/ventures/*.ts)
    ↓ (uses Supabase client)
Supabase Database
```

The MCP server is a thin wrapper that exposes the script functions as MCP tools.
The actual database logic lives in the scripts, ensuring consistency between
CLI usage and MCP tool usage.
