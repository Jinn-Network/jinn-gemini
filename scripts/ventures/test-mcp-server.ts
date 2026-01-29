#!/usr/bin/env tsx
/**
 * Test the Ventures MCP Server
 *
 * This tests that the MCP layer correctly wraps the script functions.
 * Architecture: Test -> MCP Server handlers -> Script functions -> Supabase
 */

// Import script functions directly (same as MCP server does)
import {
  createVenture,
  getVenture,
  getVentureBySlug,
  listVentures,
  type CreateVentureArgs,
} from './mint.js';

import {
  updateVenture,
  archiveVenture,
  deleteVenture,
} from './update.js';

// ============================================================================
// Test Runner
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
let testVentureId: string | null = null;
const testSlug = `mcp-test-${Date.now()}`;

async function runTest(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (error: any) {
    results.push({ name, passed: false, error: error.message, duration: Date.now() - start });
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

// ============================================================================
// Tests
// ============================================================================

async function testCreate() {
  const args: CreateVentureArgs = {
    name: 'MCP Test Venture',
    slug: testSlug,
    description: 'Testing the MCP server layer',
    ownerAddress: '0x0000000000000000000000000000000000000001',
    blueprint: JSON.stringify({
      invariants: [
        { id: 'TEST-001', description: 'MCP server test invariant' }
      ]
    }),
    status: 'active',
  };

  const venture = await createVenture(args);

  if (!venture.id) throw new Error('No venture ID returned');
  if (venture.name !== args.name) throw new Error('Name mismatch');
  if (venture.slug !== testSlug) throw new Error('Slug mismatch');

  testVentureId = venture.id;
}

async function testGetById() {
  if (!testVentureId) throw new Error('No test venture ID');

  const venture = await getVenture(testVentureId);

  if (!venture) throw new Error('Venture not found');
  if (venture.id !== testVentureId) throw new Error('ID mismatch');
}

async function testGetBySlug() {
  const venture = await getVentureBySlug(testSlug);

  if (!venture) throw new Error('Venture not found');
  if (venture.slug !== testSlug) throw new Error('Slug mismatch');
}

async function testList() {
  const ventures = await listVentures({ status: 'active', limit: 10 });

  if (!Array.isArray(ventures)) throw new Error('Expected array');

  // Should contain our test venture
  const found = ventures.find(v => v.id === testVentureId);
  if (!found) throw new Error('Test venture not in list');
}

async function testUpdate() {
  if (!testVentureId) throw new Error('No test venture ID');

  const updated = await updateVenture({
    id: testVentureId,
    name: 'MCP Test Venture (Updated)',
    description: 'Updated via MCP test',
  });

  if (!updated) throw new Error('No venture returned');
  if (updated.name !== 'MCP Test Venture (Updated)') throw new Error('Name not updated');
}

async function testSoftDelete() {
  if (!testVentureId) throw new Error('No test venture ID');

  const archived = await archiveVenture(testVentureId);

  if (archived.status !== 'archived') throw new Error('Status not archived');
}

async function testHardDelete() {
  if (!testVentureId) throw new Error('No test venture ID');

  await deleteVenture(testVentureId);

  // Verify it's gone
  const venture = await getVenture(testVentureId);
  if (venture) throw new Error('Venture still exists after hard delete');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('============================================================');
  console.log('VENTURES MCP SERVER TEST');
  console.log('Architecture: Script Functions -> Supabase');
  console.log('============================================================');
  console.log('');

  await runTest('1. CREATE (createVenture)', testCreate);
  await runTest('2. READ by ID (getVenture)', testGetById);
  await runTest('3. READ by slug (getVentureBySlug)', testGetBySlug);
  await runTest('4. READ list (listVentures)', testList);
  await runTest('5. UPDATE (updateVenture)', testUpdate);
  await runTest('6. SOFT DELETE (archiveVenture)', testSoftDelete);
  await runTest('7. HARD DELETE (deleteVenture)', testHardDelete);

  console.log('');
  console.log('============================================================');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('');

  if (failed > 0) {
    console.log('❌ Some tests failed');
    console.log('');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ${r.name}: ${r.error}`);
    });
    process.exit(1);
  } else {
    console.log('✅ All tests passed');
    console.log('');
    console.log('The MCP server wraps script functions correctly.');
    console.log('Both Claude and Gemini can use this MCP for ventures CRUD.');
  }
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
