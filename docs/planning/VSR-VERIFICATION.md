# Ventures & Services Registry – Verification

This document tracks the verification process for the Ventures & Services Registry (VSR) project. Each section documents a specific verification test, its methodology, results, and how to replicate.

---

## Table of Contents

1. [Database Schema Verification](#1-database-schema-verification)
2. [Ventures Registry CRUD Test](#2-ventures-registry-crud-test)
3. [Gemini MCP Tools Verification](#3-gemini-mcp-tools-verification)
4. [Claude MCP Capability Verification](#4-claude-mcp-capability-verification)

---

## 1. Database Schema Verification

**Date:** 2026-01-29
**Status:** PASSED
**Migration:** `migrations/alter_ventures_remove_fields.sql`

### Overview

Verified that the ventures table schema has been updated to match the simplified design:

**Kept Fields:**
- `id` (UUID, primary key)
- `name` (text, required)
- `slug` (text, unique)
- `description` (text, optional)
- `owner_address` (text, required)
- `blueprint` (JSONB with invariants array)
- `root_workstream_id` (UUID, optional)
- `status` (enum: active, paused, archived)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**Renamed Fields:**
- `job_template_id` → `root_job_instance_id`

**Removed Fields:**
- `config` (JSONB) – moved to service-level configuration
- `tags` (text[]) – moved to service-level tags
- `featured` (boolean) – removed, use status/queries for listing

### Migration Applied

```sql
-- Drop indexes first
DROP INDEX IF EXISTS idx_ventures_featured;
DROP INDEX IF EXISTS idx_ventures_tags;

-- Rename column
ALTER TABLE ventures RENAME COLUMN job_template_id TO root_job_instance_id;

-- Remove unused columns
ALTER TABLE ventures DROP COLUMN IF EXISTS config;
ALTER TABLE ventures DROP COLUMN IF EXISTS tags;
ALTER TABLE ventures DROP COLUMN IF EXISTS featured;
```

### Verification

The migration was applied via `mcp__supabase__apply_migration` and verified by:
1. Running the CRUD test script (all 6 tests passed)
2. Confirming `root_job_instance_id` appears in query results
3. Confirming removed fields no longer appear in query results

---

## 2. Ventures Registry CRUD Test

**Date:** 2026-01-29
**Status:** PASSED
**Script:** `scripts/ventures/test-crud.ts`

### Overview

Verifies that all four core CRUD operations work correctly on the `ventures` table in Supabase via direct database queries.

### How to Run

```bash
yarn tsx scripts/ventures/test-crud.ts
```

### Results

```
Total: 6 | Passed: 6 | Failed: 0

  ✓ 1. CREATE (Mint) (171ms)
  ✓ 2. READ (Query) (186ms)
  ✓ 3. UPDATE (101ms)
  ✓ 4a. ARCHIVE (Soft Delete) (103ms)
  ✓ 4b. DELETE (Hard Delete) (161ms)
  ✓ BONUS: LIST (62ms)

✅ All tests passed
```

---

## 3. Gemini MCP Tools Verification

**Date:** 2026-01-29
**Status:** PASSED
**Script:** `scripts/ventures/test-mcp-tools.ts`

### Overview

Verifies that the Gemini agent has complete CRUD capability for ventures via MCP tools:

| Tool | Operation | Status |
|------|-----------|--------|
| `venture_mint` | CREATE | ✓ PASSED |
| `venture_query` | READ | ✓ PASSED |
| `venture_update` | UPDATE | ✓ PASSED |
| `venture_delete` | DELETE | ✓ PASSED |

### How to Run

```bash
yarn tsx scripts/ventures/test-mcp-tools.ts
```

### Results

```
============================================================
VENTURES MCP TOOLS CRUD TEST
============================================================

Total: 7 | Passed: 7 | Failed: 0

  ✓ 1. CREATE (venture_mint) (160ms)
  ✓ 2. READ by ID (venture_query) (61ms)
  ✓ 3. READ by slug (venture_query) (55ms)
  ✓ 4. READ list (venture_query) (68ms)
  ✓ 5. UPDATE (venture_update) (59ms)
  ✓ 6. SOFT DELETE (venture_delete archive) (95ms)
  ✓ 7. HARD DELETE (venture_delete permanent) (474ms)

✅ All tests passed

Gemini MCP tools have full CRUD capability for ventures.
```

### MCP Tools Created

Two new MCP tools were created to complete the CRUD capability:

1. **venture_query.ts** (READ)
   - Modes: `get`, `list`, `by_slug`, `by_workstream`
   - Returns venture(s) with full details

2. **venture_delete.ts** (DELETE)
   - Modes: `soft` (archive), `hard` (permanent)
   - Hard delete requires `confirm: true`
   - Hard delete blocked if venture has services

### Documentation

Updated `docs/ventures/creating-ventures.md` with:
- Complete MCP tools reference
- Usage examples for all four tools
- Parameters tables
- Best practices

---

## 4. Claude MCP Capability Verification

**Date:** 2026-01-29
**Status:** PASSED
**Tools Used:** `mcp__supabase__execute_sql`

### Overview

Verifies that Claude has CRUD capability for ventures via the Supabase MCP tools.

### Test Results

| Operation | SQL Command | Status |
|-----------|-------------|--------|
| CREATE | `INSERT INTO ventures ...` | ✓ PASSED |
| READ | `SELECT ... FROM ventures WHERE id = ...` | ✓ PASSED |
| UPDATE | `UPDATE ventures SET ... WHERE id = ...` | ✓ PASSED |
| DELETE | `DELETE FROM ventures WHERE id = ...` | ✓ PASSED |

### Evidence

**CREATE:**
```sql
INSERT INTO ventures (name, slug, description, owner_address, blueprint, status)
VALUES ('Claude Test Venture', 'claude-test-venture-...', ...)
RETURNING id, name, slug, created_at;
-- Result: Created venture with id 'b534a0f3-2507-4f27-a6e5-68bb2c15c135'
```

**READ:**
```sql
SELECT * FROM ventures WHERE id = 'b534a0f3-2507-4f27-a6e5-68bb2c15c135';
-- Result: Returned full venture record with blueprint and all fields
```

**UPDATE:**
```sql
UPDATE ventures SET name = 'Claude Test Venture (Updated)', status = 'archived'
WHERE id = 'b534a0f3-2507-4f27-a6e5-68bb2c15c135'
RETURNING id, name, status;
-- Result: Updated name and status fields
```

**DELETE:**
```sql
DELETE FROM ventures WHERE id = 'b534a0f3-2507-4f27-a6e5-68bb2c15c135'
RETURNING id, name;
-- Result: Venture deleted, subsequent SELECT returns empty array
```

### Claude's MCP Approach

Claude uses the `mcp__supabase__execute_sql` tool which provides:
- Full SQL capability for any CRUD operation
- No need for venture-specific MCP tools
- Direct database access with service role permissions

---

## Files Updated for This Verification

### New MCP Tools
- `gemini-agent/mcp/tools/venture_query.ts` - READ operations
- `gemini-agent/mcp/tools/venture_delete.ts` - DELETE operations

### Updated MCP Server
- `gemini-agent/mcp/tools/index.ts` - Export new tools
- `gemini-agent/mcp/server.ts` - Register new tools

### Test Scripts
- `scripts/ventures/test-mcp-tools.ts` - Gemini MCP tools test

### Documentation
- `docs/ventures/creating-ventures.md` - Full MCP tools reference

### Bug Fixes
- `gemini-agent/mcp/tools/shared/supabase.ts` - Fixed incorrect URL validation that blocked real Supabase project

---

## Future Verification Tests

The following tests are planned for future verification:

- [ ] Services Registry CRUD Test
- [ ] Deployments Registry CRUD Test
- [ ] Interfaces Registry CRUD Test
- [ ] Service Docs CRUD Test
- [ ] Venture-Service Relationship Test
- [ ] On-chain Workstream Integration Test
- [ ] Frontend Data Layer Test
- [ ] API Permissions/RLS Test

---

*Last updated: 2026-01-29*
