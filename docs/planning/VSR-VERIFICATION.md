# Ventures & Services Registry – Verification

This document tracks the verification process for the Ventures & Services Registry (VSR) project. Each section documents a specific verification test, its methodology, results, and how to replicate.

---

## Table of Contents

1. [Database Schema Verification](#1-database-schema-verification)
2. [Ventures Registry CRUD Test](#2-ventures-registry-crud-test)

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

Verifies that all four core CRUD operations work correctly on the `ventures` table in Supabase:

1. **CREATE (Mint)** – Insert a new venture record
2. **READ (Query)** – Retrieve a venture by ID
3. **UPDATE** – Modify venture fields
4. **DELETE (Retire)** – Archive (soft delete) and permanently delete

### Prerequisites

- Node.js and Yarn installed
- Valid Supabase credentials in `.env`:
  ```
  SUPABASE_URL=https://clnwgxgvmnrkwqdblqgf.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
  ```
- The `ventures` table must exist (created via `migrations/create_ventures_table.sql`)

### How to Run

```bash
yarn tsx scripts/ventures/test-crud.ts
```

### Test Methodology

The script performs the following sequence:

#### Test 1: CREATE (Mint)

Creates a new venture with:
- Unique name and slug (timestamped)
- Test owner address (`0x0000000000000000000000000000000000001234`)
- Blueprint with 2 invariants (TEST-001, TEST-002)
- Status: `active`

**Validations:**
- Venture ID is returned
- `created_at` and `updated_at` are set
- All input fields match the returned record
- Blueprint invariants array is preserved

#### Test 2: READ (Query)

Retrieves the created venture by ID.

**Validations:**
- Venture is found
- All fields match what was created
- JSONB fields (blueprint) are correctly stored and retrieved

#### Test 3: UPDATE

Updates multiple fields:
- Name: Appends " (Updated)"
- Description: New text

**Validations:**
- Updated fields reflect new values
- Unchanged fields (slug, owner_address, status) remain intact

#### Test 4a: ARCHIVE (Soft Delete)

Sets the venture status to `archived`.

**Validations:**
- Status is now `archived`
- Record still exists and is queryable

#### Test 4b: DELETE (Hard Delete)

Permanently removes the venture from the database.

**Validations:**
- Subsequent query returns `null`
- Record no longer exists

#### Bonus: LIST

Lists all ventures (limit 10) to verify the table is queryable.

**Validations:**
- Returns an array
- Existing ventures are visible

### Results

```
============================================================
TEST RESULTS SUMMARY
============================================================

Total: 6 | Passed: 6 | Failed: 0

  ✓ 1. CREATE (Mint) (171ms)
  ✓ 2. READ (Query) (186ms)
  ✓ 3. UPDATE (101ms)
  ✓ 4a. ARCHIVE (Soft Delete) (103ms)
  ✓ 4b. DELETE (Hard Delete) (161ms)
  ✓ BONUS: LIST (62ms)

✅ All tests passed
```

### Sample Output

**Created Venture (Simplified Schema):**
```json
{
  "id": "a7245e32-eba4-4133-9f34-eb20509e9da9",
  "name": "Test Venture 1769689657740",
  "slug": "test-venture-1769689657740",
  "description": "A test venture for validating CRUD operations",
  "owner_address": "0x0000000000000000000000000000000000001234",
  "blueprint": {
    "invariants": [
      {
        "id": "TEST-001",
        "form": "constraint",
        "description": "Test invariant for CRUD validation",
        "examples": {
          "do": ["Verify the venture is created correctly"],
          "dont": ["Skip validation steps"]
        }
      },
      {
        "id": "TEST-002",
        "form": "boolean",
        "description": "All fields must be persisted"
      }
    ]
  },
  "root_workstream_id": null,
  "root_job_instance_id": null,
  "status": "active",
  "created_at": "2026-01-29T12:27:37.878747+00:00",
  "updated_at": "2026-01-29T12:27:37.878747+00:00"
}
```

### Notes

- The test is self-cleaning: the created venture is deleted at the end
- If a test fails mid-run, cleanup is attempted automatically
- The script exits with code 0 on success, 1 on failure
- All tests run sequentially (CREATE must succeed for others to run)

---

## Files Updated for Schema Migration

The following files were updated to reflect the simplified ventures schema:

### Database
- `migrations/create_ventures_table.sql` – Updated reference schema
- `migrations/alter_ventures_remove_fields.sql` – Migration applied

### CLI Scripts
- `scripts/ventures/mint.ts` – Removed config, tags, featured; renamed jobTemplateId → rootJobInstanceId
- `scripts/ventures/update.ts` – Same changes
- `scripts/ventures/test-crud.ts` – Same changes

### MCP Tools
- `gemini-agent/mcp/tools/venture_mint.ts` – Updated params schema
- `gemini-agent/mcp/tools/venture_update.ts` – Updated params schema

### Frontend
- `frontend/explorer/src/lib/ventures-services.ts` – Updated Venture type, replaced getFeaturedVentures with getActiveVentures
- `frontend/explorer/src/app/admin/actions.ts` – Updated VentureInput type
- `frontend/explorer/src/app/admin/components/venture-form.tsx` – Removed form fields for config, tags, featured

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
