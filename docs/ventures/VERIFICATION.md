# Ventures & Services Registry – Verification

This document tracks the verification process for the Ventures & Services Registry (VSR) project. Each section documents a specific verification test, its methodology, results, and how to replicate.

---

## Table of Contents

1. [Ventures Registry CRUD Test](#1-ventures-registry-crud-test)

---

## 1. Ventures Registry CRUD Test

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
- Tags: `['test', 'crud', 'validation']`
- Config: `{ testMode: true, createdBy: 'test-crud.ts' }`
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
- JSONB fields (blueprint, config) are correctly stored and retrieved
- Array fields (tags) are preserved

#### Test 3: UPDATE

Updates multiple fields:
- Name: Appends " (Updated)"
- Description: New text
- Tags: Adds 'updated' tag
- Featured: Set to `true`
- Config: Adds `updatedAt` timestamp

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

  ✓ 1. CREATE (Mint) (273ms)
  ✓ 2. READ (Query) (67ms)
  ✓ 3. UPDATE (96ms)
  ✓ 4a. ARCHIVE (Soft Delete) (68ms)
  ✓ 4b. DELETE (Hard Delete) (209ms)
  ✓ BONUS: LIST (63ms)

✅ All tests passed
```

### Sample Output

**Created Venture:**
```json
{
  "id": "31382614-609b-4b1b-ad8d-df6a1f4021cc",
  "name": "Test Venture 1769688823579",
  "slug": "test-venture-1769688823579",
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
  "job_template_id": null,
  "config": {
    "testMode": true,
    "createdBy": "test-crud.ts"
  },
  "tags": ["test", "crud", "validation"],
  "featured": false,
  "status": "active",
  "created_at": "2026-01-29T12:13:43.729471+00:00",
  "updated_at": "2026-01-29T12:13:43.729471+00:00"
}
```

### Notes

- The test is self-cleaning: the created venture is deleted at the end
- If a test fails mid-run, cleanup is attempted automatically
- The script exits with code 0 on success, 1 on failure
- All tests run sequentially (CREATE must succeed for others to run)

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
