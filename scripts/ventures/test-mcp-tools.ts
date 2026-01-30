#!/usr/bin/env npx tsx
/**
 * Ventures MCP Tools CRUD Test
 *
 * Tests the MCP tool functions directly to verify they work correctly
 * for CREATE, READ, UPDATE, DELETE operations on ventures.
 *
 * This validates that the Gemini agent has full CRUD capability via MCP tools.
 */

import 'dotenv/config';

// Import MCP tool functions directly
import { ventureMint } from '../../gemini-agent/mcp/tools/venture_mint.js';
import { ventureQuery } from '../../gemini-agent/mcp/tools/venture_query.js';
import { ventureUpdate } from '../../gemini-agent/mcp/tools/venture_update.js';
import { ventureDelete } from '../../gemini-agent/mcp/tools/venture_delete.js';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];
let createdVentureId: string | null = null;

// Helper to parse MCP tool response
function parseResponse(result: any): { data: any; meta: { ok: boolean; code?: string; message?: string } } {
  if (!result?.content?.[0]?.text) {
    throw new Error('Invalid MCP response format');
  }
  return JSON.parse(result.content[0].text);
}

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await testFn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, duration: Date.now() - start, error: errorMessage });
    console.log(`  ✗ ${name} (${Date.now() - start}ms)`);
    console.log(`    Error: ${errorMessage}`);
  }
}

async function main() {
  console.log('\n============================================================');
  console.log('VENTURES MCP TOOLS CRUD TEST');
  console.log('============================================================');
  console.log(`Starting at: ${new Date().toISOString()}`);

  // Verify environment
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    console.error('Error: SUPABASE_URL not configured');
    process.exit(1);
  }
  console.log(`✓ Supabase configured: ${supabaseUrl}\n`);

  const timestamp = Date.now();
  const testVentureName = `MCP Test Venture ${timestamp}`;
  const testVentureSlug = `mcp-test-venture-${timestamp}`;

  try {
    // Test 1: CREATE (venture_mint)
    console.log('→ Testing venture_mint (CREATE)...');
    await runTest('1. CREATE (venture_mint)', async () => {
      const result = await ventureMint({
        name: testVentureName,
        slug: testVentureSlug,
        description: 'A test venture for validating MCP tool operations',
        ownerAddress: '0x0000000000000000000000000000000000001234',
        blueprint: JSON.stringify({
          invariants: [
            {
              id: 'MCP-TEST-001',
              form: 'constraint',
              description: 'Test invariant for MCP tool validation',
            },
          ],
        }),
        status: 'active',
      });

      const response = parseResponse(result);

      if (!response.meta.ok) {
        throw new Error(`venture_mint failed: ${response.meta.message}`);
      }

      if (!response.data?.venture?.id) {
        throw new Error('venture_mint did not return venture ID');
      }

      createdVentureId = response.data.venture.id;
      console.log(`    Created venture: ${createdVentureId}`);
      console.log(`    Name: ${response.data.venture.name}`);
    });

    // Test 2: READ by ID (venture_query get mode)
    console.log('\n→ Testing venture_query get mode (READ by ID)...');
    await runTest('2. READ by ID (venture_query)', async () => {
      if (!createdVentureId) throw new Error('No venture ID from CREATE test');

      const result = await ventureQuery({
        mode: 'get',
        id: createdVentureId,
      });

      const response = parseResponse(result);

      if (!response.meta.ok) {
        throw new Error(`venture_query get failed: ${response.meta.message}`);
      }

      if (response.data.venture.name !== testVentureName) {
        throw new Error(`Name mismatch: expected "${testVentureName}", got "${response.data.venture.name}"`);
      }

      console.log(`    Retrieved: ${response.data.venture.name}`);
      console.log(`    Blueprint invariants: ${response.data.venture.blueprint?.invariants?.length}`);
    });

    // Test 3: READ by slug (venture_query by_slug mode)
    console.log('\n→ Testing venture_query by_slug mode (READ by slug)...');
    await runTest('3. READ by slug (venture_query)', async () => {
      const result = await ventureQuery({
        mode: 'by_slug',
        slug: testVentureSlug,
      });

      const response = parseResponse(result);

      if (!response.meta.ok) {
        throw new Error(`venture_query by_slug failed: ${response.meta.message}`);
      }

      if (response.data.venture.id !== createdVentureId) {
        throw new Error(`ID mismatch when querying by slug`);
      }

      console.log(`    Found by slug: ${response.data.venture.slug}`);
    });

    // Test 4: READ list (venture_query list mode)
    console.log('\n→ Testing venture_query list mode (READ list)...');
    await runTest('4. READ list (venture_query)', async () => {
      const result = await ventureQuery({
        mode: 'list',
        status: 'active',
        limit: 10,
      });

      const response = parseResponse(result);

      if (!response.meta.ok) {
        throw new Error(`venture_query list failed: ${response.meta.message}`);
      }

      const ventures = response.data.ventures || [];
      const found = ventures.find((v: any) => v.id === createdVentureId);

      if (!found) {
        throw new Error('Created venture not found in list');
      }

      console.log(`    Listed ${ventures.length} ventures`);
      console.log(`    Test venture found in list: ✓`);
    });

    // Test 5: UPDATE (venture_update)
    console.log('\n→ Testing venture_update (UPDATE)...');
    await runTest('5. UPDATE (venture_update)', async () => {
      if (!createdVentureId) throw new Error('No venture ID from CREATE test');

      const updatedName = `${testVentureName} (Updated)`;
      const result = await ventureUpdate({
        id: createdVentureId,
        name: updatedName,
        description: 'Updated by MCP tool test',
      });

      const response = parseResponse(result);

      if (!response.meta.ok) {
        throw new Error(`venture_update failed: ${response.meta.message}`);
      }

      if (response.data.venture.name !== updatedName) {
        throw new Error(`Name not updated: expected "${updatedName}", got "${response.data.venture.name}"`);
      }

      console.log(`    Updated name: ${response.data.venture.name}`);
      console.log(`    Updated description: ${response.data.venture.description?.substring(0, 30)}...`);
    });

    // Test 6: SOFT DELETE (venture_delete soft mode)
    console.log('\n→ Testing venture_delete soft mode (ARCHIVE)...');
    await runTest('6. SOFT DELETE (venture_delete archive)', async () => {
      if (!createdVentureId) throw new Error('No venture ID from CREATE test');

      const result = await ventureDelete({
        id: createdVentureId,
        mode: 'soft',
      });

      const response = parseResponse(result);

      if (!response.meta.ok) {
        throw new Error(`venture_delete soft failed: ${response.meta.message}`);
      }

      if (response.data.venture.status !== 'archived') {
        throw new Error(`Status not archived: ${response.data.venture.status}`);
      }

      console.log(`    Archived venture status: ${response.data.venture.status}`);
    });

    // Test 7: HARD DELETE (venture_delete hard mode)
    console.log('\n→ Testing venture_delete hard mode (PERMANENT DELETE)...');
    await runTest('7. HARD DELETE (venture_delete permanent)', async () => {
      if (!createdVentureId) throw new Error('No venture ID from CREATE test');

      const result = await ventureDelete({
        id: createdVentureId,
        mode: 'hard',
        confirm: true,
      });

      const response = parseResponse(result);

      if (!response.meta.ok) {
        throw new Error(`venture_delete hard failed: ${response.meta.message}`);
      }

      if (!response.data.success) {
        throw new Error('Hard delete did not return success');
      }

      console.log(`    Permanently deleted venture`);

      // Verify deletion by trying to read
      const verifyResult = await ventureQuery({
        mode: 'get',
        id: createdVentureId,
      });

      const verifyResponse = parseResponse(verifyResult);

      if (verifyResponse.meta.ok) {
        throw new Error('Venture still exists after hard delete');
      }

      console.log(`    Verified: venture no longer exists`);
      createdVentureId = null; // Clear so cleanup doesn't run
    });

  } finally {
    // Cleanup if test failed mid-way
    if (createdVentureId) {
      console.log('\n→ Cleaning up test venture...');
      try {
        await ventureDelete({
          id: createdVentureId,
          mode: 'hard',
          confirm: true,
        });
        console.log('  ✓ Cleanup complete');
      } catch (e) {
        console.log(`  ⚠ Cleanup failed: ${e}`);
      }
    }
  }

  // Summary
  console.log('\n============================================================');
  console.log('TEST RESULTS SUMMARY');
  console.log('============================================================\n');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  for (const result of results) {
    const icon = result.passed ? '✓' : '✗';
    console.log(`  ${icon} ${result.name} (${result.duration}ms)`);
    if (result.error) {
      console.log(`    Error: ${result.error}`);
    }
  }

  console.log('');

  if (failed > 0) {
    console.log('❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('✅ All tests passed');
    console.log('\nGemini MCP tools have full CRUD capability for ventures.');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
