#!/usr/bin/env npx tsx
/**
 * Skills E2E Test Suite
 *
 * Tests that venture skills are properly picked up by agents and lead to
 * correct MCP tool invocations for both Claude and Gemini.
 *
 * Tests 8 scenarios:
 * - Claude: CREATE, READ, UPDATE, DELETE
 * - Gemini: CREATE, READ, UPDATE, DELETE
 *
 * Each test verifies:
 * 1. Skill pickup: The skill description matches the operation
 * 2. MCP action: The corresponding MCP tool works correctly
 */

import 'dotenv/config';
import { existsSync, readFileSync, lstatSync, readlinkSync } from 'fs';
import { resolve, join } from 'path';

// Import Gemini MCP tools directly for testing
import { ventureMint } from 'jinn-node/agent/mcp/tools/venture_mint.js';
import { ventureQuery } from 'jinn-node/agent/mcp/tools/venture_query.js';
import { ventureUpdate } from 'jinn-node/agent/mcp/tools/venture_update.js';
import { ventureDelete } from 'jinn-node/agent/mcp/tools/venture_delete.js';

// Import Claude MCP server functions
import {
  createVenture,
  getVenture,
  listVentures,
} from '../ventures/mint.js';
import {
  updateVenture,
  archiveVenture,
  deleteVenture,
} from '../ventures/update.js';

interface TestResult {
  agent: 'Claude' | 'Gemini';
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE';
  skillPickup: boolean;
  skillPickupReason: string;
  mcpAction: boolean;
  mcpActionReason: string;
}

const results: TestResult[] = [];
const BASE_DIR = resolve(import.meta.dirname, '../..');

// Test prompts that should trigger skill pickup
const TRIGGER_PROMPTS = {
  CREATE: [
    'mint a new venture',
    'create a venture called',
    'I want to start a new venture',
  ],
  READ: [
    'show me the venture',
    'what ventures exist',
    'get information about venture',
    'list all ventures',
  ],
  UPDATE: [
    'update the venture',
    'change the venture status',
    'modify venture details',
  ],
  DELETE: [
    'delete the venture',
    'archive the venture',
    'shut down the venture',
  ],
};

// Parse skill file and check if description matches operation
function checkSkillMatchesOperation(
  skillPath: string,
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE'
): { matches: boolean; reason: string } {
  if (!existsSync(skillPath)) {
    return { matches: false, reason: `Skill file not found: ${skillPath}` };
  }

  const content = readFileSync(skillPath, 'utf-8');

  // Parse YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return { matches: false, reason: 'No YAML frontmatter found' };
  }

  const frontmatter = frontmatterMatch[1];
  const descriptionMatch = frontmatter.match(/description:\s*(.+)/);
  if (!descriptionMatch) {
    return { matches: false, reason: 'No description field in frontmatter' };
  }

  const description = descriptionMatch[1].toLowerCase();

  // Check if description contains trigger words for the operation
  const keywords: Record<string, string[]> = {
    CREATE: ['mint', 'creat'],
    READ: ['view', 'information', 'existing'],
    UPDATE: ['updat', 'details', 'status'],
    DELETE: ['shut', 'delet', 'archiv'],
  };

  const opKeywords = keywords[operation];
  const matches = opKeywords.some((kw) => description.includes(kw));

  if (matches) {
    return {
      matches: true,
      reason: `Description contains trigger words for ${operation}: "${description.substring(0, 80)}..."`,
    };
  } else {
    return {
      matches: false,
      reason: `Description missing trigger words for ${operation}. Found: "${description.substring(0, 80)}..."`,
    };
  }
}

// Check if symlink points to correct canonical location
function checkSymlink(
  agentDir: string,
  skillName: string
): { valid: boolean; reason: string } {
  const skillPath = join(BASE_DIR, agentDir, 'skills', skillName);

  try {
    const stats = lstatSync(skillPath);
    if (!stats.isSymbolicLink()) {
      return { valid: false, reason: `${skillPath} is not a symlink` };
    }

    const target = readlinkSync(skillPath);
    const canonicalPath = `../../skills/${skillName}`;

    if (target === canonicalPath || target.endsWith(`skills/${skillName}`)) {
      return {
        valid: true,
        reason: `Symlink correctly points to canonical: ${target}`,
      };
    } else {
      return { valid: false, reason: `Symlink points to wrong target: ${target}` };
    }
  } catch (error) {
    return { valid: false, reason: `Error checking symlink: ${error}` };
  }
}

// Helper to parse MCP tool response
function parseResponse(result: any): {
  data: any;
  meta: { ok: boolean; code?: string; message?: string };
} {
  if (!result?.content?.[0]?.text) {
    throw new Error('Invalid MCP response format');
  }
  return JSON.parse(result.content[0].text);
}

// ============================================================================
// Claude Tests
// ============================================================================

async function testClaudeSkillPickup(
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE'
): Promise<{ skillPickup: boolean; skillPickupReason: string }> {
  // Check skill file exists and description matches
  const skillPath = join(BASE_DIR, '.claude/skills/ventures/SKILL.md');
  const skillCheck = checkSkillMatchesOperation(skillPath, operation);

  // Also verify symlink is correct
  const symlinkCheck = checkSymlink('.claude', 'ventures');

  if (!symlinkCheck.valid) {
    return { skillPickup: false, skillPickupReason: symlinkCheck.reason };
  }

  return {
    skillPickup: skillCheck.matches,
    skillPickupReason: skillCheck.reason,
  };
}

async function testClaudeMcpAction(
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE',
  testId: string
): Promise<{ mcpAction: boolean; mcpActionReason: string; ventureId?: string }> {
  const timestamp = Date.now();
  const testVentureName = `Claude Test ${operation} ${timestamp}`;
  const testOwner = '0x0000000000000000000000000000000000001111';

  try {
    switch (operation) {
      case 'CREATE': {
        const venture = await createVenture({
          name: testVentureName,
          ownerAddress: testOwner,
          blueprint: JSON.stringify({ invariants: [{ id: testId, description: 'Test' }] }),
          status: 'active',
        });
        if (venture?.id) {
          return {
            mcpAction: true,
            mcpActionReason: `Created venture: ${venture.id}`,
            ventureId: venture.id,
          };
        }
        return { mcpAction: false, mcpActionReason: 'No venture ID returned' };
      }

      case 'READ': {
        const ventures = await listVentures({ limit: 5 });
        if (Array.isArray(ventures)) {
          return {
            mcpAction: true,
            mcpActionReason: `Listed ${ventures.length} ventures`,
          };
        }
        return { mcpAction: false, mcpActionReason: 'Invalid list response' };
      }

      case 'UPDATE': {
        // First create a venture to update
        const venture = await createVenture({
          name: testVentureName,
          ownerAddress: testOwner,
          blueprint: JSON.stringify({ invariants: [] }),
          status: 'active',
        });
        if (!venture?.id) {
          return { mcpAction: false, mcpActionReason: 'Could not create venture for update test' };
        }

        const updated = await updateVenture({
          id: venture.id,
          name: `${testVentureName} (Updated)`,
        });

        // Cleanup
        await deleteVenture(venture.id);

        if (updated?.name?.includes('Updated')) {
          return {
            mcpAction: true,
            mcpActionReason: `Updated venture: ${updated.name}`,
          };
        }
        return { mcpAction: false, mcpActionReason: 'Update did not apply' };
      }

      case 'DELETE': {
        // First create a venture to delete
        const venture = await createVenture({
          name: testVentureName,
          ownerAddress: testOwner,
          blueprint: JSON.stringify({ invariants: [] }),
          status: 'active',
        });
        if (!venture?.id) {
          return { mcpAction: false, mcpActionReason: 'Could not create venture for delete test' };
        }

        await deleteVenture(venture.id);

        // Verify deletion
        const check = await getVenture(venture.id);
        if (!check) {
          return {
            mcpAction: true,
            mcpActionReason: `Deleted venture: ${venture.id}`,
          };
        }
        return { mcpAction: false, mcpActionReason: 'Venture still exists after delete' };
      }
    }
  } catch (error) {
    return {
      mcpAction: false,
      mcpActionReason: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Gemini Tests
// ============================================================================

async function testGeminiSkillPickup(
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE'
): Promise<{ skillPickup: boolean; skillPickupReason: string }> {
  // Check skill file exists and description matches
  const skillPath = join(BASE_DIR, '.gemini/skills/ventures/SKILL.md');
  const skillCheck = checkSkillMatchesOperation(skillPath, operation);

  // Also verify symlink is correct
  const symlinkCheck = checkSymlink('.gemini', 'ventures');

  if (!symlinkCheck.valid) {
    return { skillPickup: false, skillPickupReason: symlinkCheck.reason };
  }

  return {
    skillPickup: skillCheck.matches,
    skillPickupReason: skillCheck.reason,
  };
}

async function testGeminiMcpAction(
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE',
  testId: string
): Promise<{ mcpAction: boolean; mcpActionReason: string; ventureId?: string }> {
  const timestamp = Date.now();
  const testVentureName = `Gemini Test ${operation} ${timestamp}`;
  const testOwner = '0x0000000000000000000000000000000000002222';

  try {
    switch (operation) {
      case 'CREATE': {
        const result = await ventureMint({
          name: testVentureName,
          ownerAddress: testOwner,
          blueprint: JSON.stringify({ invariants: [{ id: testId, description: 'Test' }] }),
          status: 'active',
        });
        const response = parseResponse(result);
        if (response.meta.ok && response.data?.venture?.id) {
          return {
            mcpAction: true,
            mcpActionReason: `Created venture: ${response.data.venture.id}`,
            ventureId: response.data.venture.id,
          };
        }
        return {
          mcpAction: false,
          mcpActionReason: response.meta.message || 'Create failed',
        };
      }

      case 'READ': {
        const result = await ventureQuery({ mode: 'list', limit: 5 });
        const response = parseResponse(result);
        if (response.meta.ok && Array.isArray(response.data?.ventures)) {
          return {
            mcpAction: true,
            mcpActionReason: `Listed ${response.data.ventures.length} ventures`,
          };
        }
        return {
          mcpAction: false,
          mcpActionReason: response.meta.message || 'List failed',
        };
      }

      case 'UPDATE': {
        // First create a venture to update
        const createResult = await ventureMint({
          name: testVentureName,
          ownerAddress: testOwner,
          blueprint: JSON.stringify({ invariants: [] }),
          status: 'active',
        });
        const createResponse = parseResponse(createResult);
        if (!createResponse.meta.ok || !createResponse.data?.venture?.id) {
          return { mcpAction: false, mcpActionReason: 'Could not create venture for update test' };
        }

        const ventureId = createResponse.data.venture.id;

        const updateResult = await ventureUpdate({
          id: ventureId,
          name: `${testVentureName} (Updated)`,
        });
        const updateResponse = parseResponse(updateResult);

        // Cleanup
        await ventureDelete({ id: ventureId, mode: 'hard', confirm: true });

        if (updateResponse.meta.ok && updateResponse.data?.venture?.name?.includes('Updated')) {
          return {
            mcpAction: true,
            mcpActionReason: `Updated venture: ${updateResponse.data.venture.name}`,
          };
        }
        return {
          mcpAction: false,
          mcpActionReason: updateResponse.meta.message || 'Update did not apply',
        };
      }

      case 'DELETE': {
        // First create a venture to delete
        const createResult = await ventureMint({
          name: testVentureName,
          ownerAddress: testOwner,
          blueprint: JSON.stringify({ invariants: [] }),
          status: 'active',
        });
        const createResponse = parseResponse(createResult);
        if (!createResponse.meta.ok || !createResponse.data?.venture?.id) {
          return { mcpAction: false, mcpActionReason: 'Could not create venture for delete test' };
        }

        const ventureId = createResponse.data.venture.id;

        const deleteResult = await ventureDelete({ id: ventureId, mode: 'hard', confirm: true });
        const deleteResponse = parseResponse(deleteResult);

        if (deleteResponse.meta.ok && deleteResponse.data?.deleted) {
          return {
            mcpAction: true,
            mcpActionReason: `Deleted venture: ${ventureId}`,
          };
        }
        return {
          mcpAction: false,
          mcpActionReason: deleteResponse.meta.message || `Delete failed: ${JSON.stringify(deleteResponse)}`,
        };
      }
    }
  } catch (error) {
    return {
      mcpAction: false,
      mcpActionReason: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('VENTURES SKILLS E2E TEST SUITE');
  console.log('='.repeat(70));
  console.log(`Testing at: ${new Date().toISOString()}`);
  console.log(`Base directory: ${BASE_DIR}\n`);

  // Check environment
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    console.error('❌ SUPABASE_URL not configured - MCP tests will fail');
    console.log('   Set SUPABASE_URL in .env to run MCP action tests\n');
  } else {
    console.log(`✓ Supabase configured: ${supabaseUrl}\n`);
  }

  const operations: Array<'CREATE' | 'READ' | 'UPDATE' | 'DELETE'> = [
    'CREATE',
    'READ',
    'UPDATE',
    'DELETE',
  ];

  // Claude Tests
  console.log('-'.repeat(70));
  console.log('CLAUDE TESTS');
  console.log('-'.repeat(70));

  for (const op of operations) {
    console.log(`\n→ Claude ${op}:`);
    const testId = `CLAUDE-${op}-${Date.now()}`;

    // Test skill pickup
    const skillResult = await testClaudeSkillPickup(op);
    console.log(
      `  Skill Pickup: ${skillResult.skillPickup ? '✓' : '✗'} ${skillResult.skillPickupReason}`
    );

    // Test MCP action (only if Supabase is configured)
    let mcpResult: { mcpAction: boolean; mcpActionReason: string } = {
      mcpAction: false,
      mcpActionReason: 'Supabase not configured',
    };

    if (supabaseUrl) {
      mcpResult = await testClaudeMcpAction(op, testId);
      console.log(`  MCP Action:   ${mcpResult.mcpAction ? '✓' : '✗'} ${mcpResult.mcpActionReason}`);
    } else {
      console.log(`  MCP Action:   ⏭ Skipped (no Supabase)`);
    }

    results.push({
      agent: 'Claude',
      operation: op,
      skillPickup: skillResult.skillPickup,
      skillPickupReason: skillResult.skillPickupReason,
      mcpAction: mcpResult.mcpAction,
      mcpActionReason: mcpResult.mcpActionReason,
    });
  }

  // Gemini Tests
  console.log('\n' + '-'.repeat(70));
  console.log('GEMINI TESTS');
  console.log('-'.repeat(70));

  for (const op of operations) {
    console.log(`\n→ Gemini ${op}:`);
    const testId = `GEMINI-${op}-${Date.now()}`;

    // Test skill pickup
    const skillResult = await testGeminiSkillPickup(op);
    console.log(
      `  Skill Pickup: ${skillResult.skillPickup ? '✓' : '✗'} ${skillResult.skillPickupReason}`
    );

    // Test MCP action (only if Supabase is configured)
    let mcpResult: { mcpAction: boolean; mcpActionReason: string } = {
      mcpAction: false,
      mcpActionReason: 'Supabase not configured',
    };

    if (supabaseUrl) {
      mcpResult = await testGeminiMcpAction(op, testId);
      console.log(`  MCP Action:   ${mcpResult.mcpAction ? '✓' : '✗'} ${mcpResult.mcpActionReason}`);
    } else {
      console.log(`  MCP Action:   ⏭ Skipped (no Supabase)`);
    }

    results.push({
      agent: 'Gemini',
      operation: op,
      skillPickup: skillResult.skillPickup,
      skillPickupReason: skillResult.skillPickupReason,
      mcpAction: mcpResult.mcpAction,
      mcpActionReason: mcpResult.mcpActionReason,
    });
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST RESULTS SUMMARY');
  console.log('='.repeat(70) + '\n');

  console.log('Agent   | Operation | Skill Pickup | MCP Action');
  console.log('-'.repeat(50));

  for (const r of results) {
    const skillIcon = r.skillPickup ? '✓' : '✗';
    const mcpIcon = r.mcpAction ? '✓' : (supabaseUrl ? '✗' : '⏭');
    console.log(
      `${r.agent.padEnd(7)} | ${r.operation.padEnd(9)} | ${skillIcon.padEnd(12)} | ${mcpIcon}`
    );
  }

  const skillPassed = results.filter((r) => r.skillPickup).length;
  const mcpPassed = results.filter((r) => r.mcpAction).length;
  const mcpTotal = supabaseUrl ? results.length : 0;

  console.log('\n' + '-'.repeat(50));
  console.log(`Skill Pickup: ${skillPassed}/${results.length} passed`);
  console.log(`MCP Actions:  ${mcpPassed}/${mcpTotal || 'N/A'} passed`);

  const allSkillsPassed = skillPassed === results.length;
  const allMcpPassed = !supabaseUrl || mcpPassed === results.length;

  if (allSkillsPassed && allMcpPassed) {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed');

    // Show failures
    const failures = results.filter((r) => !r.skillPickup || (supabaseUrl && !r.mcpAction));
    if (failures.length > 0) {
      console.log('\nFailures:');
      for (const f of failures) {
        if (!f.skillPickup) {
          console.log(`  - ${f.agent} ${f.operation} skill: ${f.skillPickupReason}`);
        }
        if (supabaseUrl && !f.mcpAction) {
          console.log(`  - ${f.agent} ${f.operation} MCP: ${f.mcpActionReason}`);
        }
      }
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
