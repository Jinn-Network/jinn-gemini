#!/usr/bin/env tsx
/**
 * Test script for Ventures Registry CRUD Operations
 *
 * Tests the four core operations:
 * 1. CREATE (mint) - Create a new venture
 * 2. READ - Query a venture by ID
 * 3. UPDATE - Modify venture fields
 * 4. DELETE (retire) - Remove the venture
 *
 * Usage: yarn tsx scripts/ventures/test-crud.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ============================================================================
// Supabase Client Setup
// ============================================================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase: SupabaseClient;

function initSupabase(): boolean {
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing required environment variables:');
    if (!supabaseUrl) console.error('  - SUPABASE_URL');
    if (!supabaseKey) console.error('  - SUPABASE_SERVICE_ROLE_KEY');
    return false;
  }

  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log(`✓ Supabase client initialized: ${supabaseUrl}`);
    return true;
  } catch (error: any) {
    console.error(`Failed to initialize Supabase client: ${error.message}`);
    return false;
  }
}

// ============================================================================
// Types
// ============================================================================

interface Venture {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_address: string;
  blueprint: {
    invariants: Array<{
      id: string;
      form?: string;
      description: string;
      examples?: { do?: string[]; dont?: string[] };
    }>;
  };
  root_workstream_id: string | null;
  root_job_instance_id: string | null;
  status: 'active' | 'paused' | 'archived';
  created_at: string;
  updated_at: string;
}

interface CreateVentureArgs {
  name: string;
  slug?: string;
  description?: string;
  ownerAddress: string;
  blueprint: object;
  rootWorkstreamId?: string;
  rootJobInstanceId?: string;
  status?: 'active' | 'paused' | 'archived';
}

interface UpdateVentureArgs {
  id: string;
  name?: string;
  slug?: string;
  description?: string;
  ownerAddress?: string;
  blueprint?: object;
  rootWorkstreamId?: string | null;
  rootJobInstanceId?: string | null;
  status?: 'active' | 'paused' | 'archived';
}

// ============================================================================
// CRUD Functions
// ============================================================================

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function createVenture(args: CreateVentureArgs): Promise<Venture> {
  const slug = args.slug || generateSlug(args.name);

  const record = {
    name: args.name,
    slug,
    description: args.description || null,
    owner_address: args.ownerAddress,
    blueprint: args.blueprint,
    root_workstream_id: args.rootWorkstreamId || null,
    root_job_instance_id: args.rootJobInstanceId || null,
    status: args.status || 'active',
  };

  const { data, error } = await supabase
    .from('ventures')
    .insert(record)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create venture: ${error.message}`);
  }

  return data as Venture;
}

async function getVenture(id: string): Promise<Venture | null> {
  const { data, error } = await supabase
    .from('ventures')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get venture: ${error.message}`);
  }

  return data as Venture;
}

async function listVentures(options: {
  status?: string;
  ownerAddress?: string;
  limit?: number;
} = {}): Promise<Venture[]> {
  let query = supabase
    .from('ventures')
    .select('*')
    .order('created_at', { ascending: false });

  if (options.status) {
    query = query.eq('status', options.status);
  }
  if (options.ownerAddress) {
    query = query.eq('owner_address', options.ownerAddress);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list ventures: ${error.message}`);
  }

  return data as Venture[];
}

async function updateVenture(args: UpdateVentureArgs): Promise<Venture> {
  const { id, ...updates } = args;

  const record: Record<string, any> = {};

  if (updates.name !== undefined) record.name = updates.name;
  if (updates.slug !== undefined) record.slug = updates.slug;
  if (updates.description !== undefined) record.description = updates.description;
  if (updates.ownerAddress !== undefined) record.owner_address = updates.ownerAddress;
  if (updates.rootWorkstreamId !== undefined) record.root_workstream_id = updates.rootWorkstreamId;
  if (updates.rootJobInstanceId !== undefined) record.root_job_instance_id = updates.rootJobInstanceId;
  if (updates.status !== undefined) record.status = updates.status;
  if (updates.blueprint !== undefined) record.blueprint = updates.blueprint;

  if (Object.keys(record).length === 0) {
    throw new Error('No fields to update');
  }

  const { data, error } = await supabase
    .from('ventures')
    .update(record)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update venture: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Venture not found: ${id}`);
  }

  return data as Venture;
}

async function archiveVenture(id: string): Promise<Venture> {
  return updateVenture({ id, status: 'archived' });
}

async function deleteVenture(id: string): Promise<void> {
  const { error } = await supabase
    .from('ventures')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete venture: ${error.message}`);
  }
}

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_OWNER_ADDRESS = '0x0000000000000000000000000000000000001234';
const TEST_VENTURE_NAME = `Test Venture ${Date.now()}`;
const TEST_SLUG = `test-venture-${Date.now()}`;

const TEST_BLUEPRINT = {
  invariants: [
    {
      id: 'TEST-001',
      form: 'constraint',
      description: 'Test invariant for CRUD validation',
      examples: {
        do: ['Verify the venture is created correctly'],
        dont: ['Skip validation steps'],
      },
    },
    {
      id: 'TEST-002',
      form: 'boolean',
      description: 'All fields must be persisted',
    },
  ],
};

// ============================================================================
// Test Helpers
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  data?: any;
  error?: string;
}

const results: TestResult[] = [];

function logHeader(text: string) {
  console.log('\n' + '='.repeat(60));
  console.log(text);
  console.log('='.repeat(60));
}

function logStep(step: string) {
  console.log(`\n→ ${step}`);
}

function logSuccess(message: string) {
  console.log(`  ✓ ${message}`);
}

function logError(message: string) {
  console.log(`  ✗ ${message}`);
}

function logData(label: string, data: any) {
  console.log(`  ${label}:`);
  const json = JSON.stringify(data, null, 2);
  json.split('\n').forEach(line => console.log(`    ${line}`));
}

async function runTest(
  name: string,
  testFn: () => Promise<any>
): Promise<TestResult> {
  const start = Date.now();
  try {
    const data = await testFn();
    const duration = Date.now() - start;
    const result: TestResult = { name, passed: true, duration, data };
    results.push(result);
    return result;
  } catch (err: any) {
    const duration = Date.now() - start;
    const result: TestResult = {
      name,
      passed: false,
      duration,
      error: err.message,
    };
    results.push(result);
    return result;
  }
}

// ============================================================================
// Test 1: CREATE (Mint) a New Venture
// ============================================================================

async function testCreate(): Promise<Venture> {
  logStep('Creating new venture...');

  const venture = await createVenture({
    name: TEST_VENTURE_NAME,
    slug: TEST_SLUG,
    description: 'A test venture for validating CRUD operations',
    ownerAddress: TEST_OWNER_ADDRESS,
    blueprint: TEST_BLUEPRINT,
    status: 'active',
  });

  // Validate required fields exist
  if (!venture.id) throw new Error('Venture ID not returned');
  if (!venture.created_at) throw new Error('created_at not set');
  if (!venture.updated_at) throw new Error('updated_at not set');
  if (venture.name !== TEST_VENTURE_NAME) throw new Error('Name mismatch');
  if (venture.slug !== TEST_SLUG) throw new Error('Slug mismatch');
  if (venture.owner_address !== TEST_OWNER_ADDRESS) throw new Error('Owner address mismatch');
  if (venture.status !== 'active') throw new Error('Status not active');
  if (!venture.blueprint?.invariants) throw new Error('Blueprint invariants missing');
  if (venture.blueprint.invariants.length !== 2) throw new Error('Expected 2 invariants');

  logSuccess(`Created venture: ${venture.id}`);
  logData('Venture', {
    id: venture.id,
    name: venture.name,
    slug: venture.slug,
    status: venture.status,
    owner_address: venture.owner_address,
    invariant_count: venture.blueprint?.invariants?.length,
  });

  return venture;
}

// ============================================================================
// Test 2: READ (Query) the Venture
// ============================================================================

async function testRead(ventureId: string): Promise<Venture> {
  logStep('Reading venture by ID...');

  const venture = await getVenture(ventureId);
  if (!venture) throw new Error(`Venture not found: ${ventureId}`);

  // Validate all fields were persisted
  if (venture.id !== ventureId) throw new Error('ID mismatch');
  if (venture.name !== TEST_VENTURE_NAME) throw new Error('Name not persisted correctly');
  if (venture.slug !== TEST_SLUG) throw new Error('Slug not persisted correctly');
  if (venture.owner_address !== TEST_OWNER_ADDRESS) throw new Error('Owner address not persisted');
  if (venture.status !== 'active') throw new Error('Status not persisted');
  if (!venture.description) throw new Error('Description not persisted');

  logSuccess(`Read venture successfully`);
  logData('Full Venture Object', venture);

  return venture;
}

// ============================================================================
// Test 3: UPDATE the Venture
// ============================================================================

async function testUpdate(ventureId: string): Promise<Venture> {
  logStep('Updating venture fields...');

  const updatedName = `${TEST_VENTURE_NAME} (Updated)`;
  const updatedDescription = 'This description was updated by the test script';

  const venture = await updateVenture({
    id: ventureId,
    name: updatedName,
    description: updatedDescription,
  });

  // Validate updates
  if (venture.name !== updatedName) throw new Error('Name not updated');
  if (venture.description !== updatedDescription) throw new Error('Description not updated');

  // Validate unchanged fields remain
  if (venture.slug !== TEST_SLUG) throw new Error('Slug unexpectedly changed');
  if (venture.owner_address !== TEST_OWNER_ADDRESS) throw new Error('Owner unexpectedly changed');
  if (venture.status !== 'active') throw new Error('Status unexpectedly changed');

  logSuccess(`Updated venture successfully`);
  logData('Updated Fields', {
    name: venture.name,
    description: venture.description,
  });

  return venture;
}

// ============================================================================
// Test 4a: ARCHIVE (Soft Delete) the Venture
// ============================================================================

async function testArchive(ventureId: string): Promise<Venture> {
  logStep('Archiving venture (soft delete)...');

  const venture = await archiveVenture(ventureId);

  if (venture.status !== 'archived') throw new Error('Status not set to archived');

  logSuccess(`Archived venture successfully`);
  logData('Archived Venture', {
    id: venture.id,
    name: venture.name,
    status: venture.status,
  });

  return venture;
}

// ============================================================================
// Test 4b: DELETE (Hard Delete) the Venture
// ============================================================================

async function testDelete(ventureId: string): Promise<void> {
  logStep('Deleting venture permanently...');

  await deleteVenture(ventureId);

  // Verify deletion
  const deleted = await getVenture(ventureId);
  if (deleted) throw new Error('Venture still exists after deletion');

  logSuccess(`Deleted venture permanently`);
}

// ============================================================================
// Test: List Ventures
// ============================================================================

async function testList(): Promise<Venture[]> {
  logStep('Listing all ventures...');

  const ventures = await listVentures({ limit: 10 });

  logSuccess(`Found ${ventures.length} ventures`);
  if (ventures.length > 0) {
    logData('First Venture', {
      id: ventures[0].id,
      name: ventures[0].name,
      status: ventures[0].status,
    });
  }

  return ventures;
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main() {
  logHeader('VENTURES REGISTRY CRUD TEST');
  console.log(`Starting at: ${new Date().toISOString()}`);

  // Initialize Supabase client
  if (!initSupabase()) {
    console.error('\n❌ Cannot run tests without valid Supabase configuration');
    process.exit(1);
  }

  let createdVentureId: string | null = null;

  try {
    // Test 1: CREATE
    const createResult = await runTest('1. CREATE (Mint)', async () => {
      const venture = await testCreate();
      createdVentureId = venture.id;
      return venture;
    });

    if (!createResult.passed || !createdVentureId) {
      logError(`CREATE failed: ${createResult.error}`);
      throw new Error('Cannot continue without successful CREATE');
    }

    // Test 2: READ
    const readResult = await runTest('2. READ (Query)', async () => {
      return await testRead(createdVentureId!);
    });

    if (!readResult.passed) {
      logError(`READ failed: ${readResult.error}`);
    }

    // Test 3: UPDATE
    const updateResult = await runTest('3. UPDATE', async () => {
      return await testUpdate(createdVentureId!);
    });

    if (!updateResult.passed) {
      logError(`UPDATE failed: ${updateResult.error}`);
    }

    // Test 4a: ARCHIVE (soft delete)
    const archiveResult = await runTest('4a. ARCHIVE (Soft Delete)', async () => {
      return await testArchive(createdVentureId!);
    });

    if (!archiveResult.passed) {
      logError(`ARCHIVE failed: ${archiveResult.error}`);
    }

    // Test 4b: DELETE (hard delete)
    const deleteResult = await runTest('4b. DELETE (Hard Delete)', async () => {
      return await testDelete(createdVentureId!);
    });

    if (!deleteResult.passed) {
      logError(`DELETE failed: ${deleteResult.error}`);
    }

    // Bonus: LIST test
    const listResult = await runTest('BONUS: LIST', async () => {
      return await testList();
    });

    if (!listResult.passed) {
      logError(`LIST failed: ${listResult.error}`);
    }

  } catch (err: any) {
    logError(`Test execution failed: ${err.message}`);

    // Cleanup: Try to delete the venture if it was created
    if (createdVentureId) {
      console.log('\nAttempting cleanup...');
      try {
        await deleteVenture(createdVentureId);
        console.log(`  Cleaned up venture: ${createdVentureId}`);
      } catch {
        console.log(`  Failed to cleanup venture: ${createdVentureId}`);
      }
    }
  }

  // Print Summary
  logHeader('TEST RESULTS SUMMARY');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}\n`);

  results.forEach(result => {
    const status = result.passed ? '✓' : '✗';
    const duration = `(${result.duration}ms)`;
    console.log(`  ${status} ${result.name} ${duration}`);
    if (!result.passed && result.error) {
      console.log(`    Error: ${result.error}`);
    }
  });

  // Exit with appropriate code
  if (failed > 0) {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
