# Claude Code Configuration


      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.

## Ventures & Services Registry

When working with ventures (creating, querying, updating, or deleting ventures), use the ventures MCP tools:

| Tool | Operation | Usage |
|------|-----------|-------|
| `venture_create` | CREATE | Create a new venture with blueprint and owner |
| `venture_get` | READ | Get venture by ID or slug |
| `venture_list` | READ | List ventures with filters |
| `venture_update` | UPDATE | Update venture fields |
| `venture_delete` | DELETE | Archive (soft) or permanently delete |

### Quick Reference

**Create a venture:**
```json
{ "name": "My Venture", "ownerAddress": "0x...", "blueprint": "{\"invariants\":[...]}" }
```

**Query ventures:**
- By ID: `{ "id": "<uuid>" }`
- By slug: `{ "slug": "my-venture" }`
- List active: `{ "status": "active", "limit": 20 }`

**Update a venture:**
```json
{ "id": "<uuid>", "name": "New Name", "status": "paused" }
```

**Delete a venture:**
- Soft (archive): `{ "id": "<uuid>", "mode": "soft" }`
- Hard (permanent): `{ "id": "<uuid>", "mode": "hard", "confirm": true }`

### Architecture

The ventures MCP server wraps script functions:
```
Claude -> MCP Server (mcp/ventures/server.ts) -> Scripts (scripts/ventures/*.ts) -> Supabase
```

For detailed documentation, see `/ventures` skill or `docs/ventures/creating-ventures.md`.
