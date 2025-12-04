#!/usr/bin/env tsx
/**
 * Ethereum Protocol Research - Entry Point
 * 
 * Single entry point for Ethereum protocol research venture:
 * - Phase 1: Blueprint-driven execution (structured assertions)
 * - Phase 2: Agent autonomously decides execution strategy (direct work vs delegation)
 * - Phase 3: Recognition phase (learns from similar past research)
 * 
 * The agent receives a blueprint defining success criteria:
 * - Data sourcing requirements
 * - Analysis methodology
 * - Output specifications
 * - Trade idea generation
 * 
 * The agent may choose to:
 * - Execute all work directly
 * - Delegate to specialized child jobs
 * - Hybrid approach based on task complexity
 */

import 'dotenv/config';
import { dispatchNewJob } from '../../gemini-agent/mcp/tools/dispatch_new_job.js';
import { readFile } from 'fs/promises';
import { join } from 'path';

async function loadBlueprint(filename: string): Promise<string> {
  const blueprintPath = join(process.cwd(), 'blueprints', filename);
  const content = await readFile(blueprintPath, 'utf-8');
  return content;
}

function parseDispatchResponse(result: any): { jobDefinitionId: string; requestId: string } {
  const response = JSON.parse(result.content[0].text);
  
  if (!response.meta?.ok) {
    throw new Error(`Dispatch failed: ${response.meta?.message}`);
  }
  
  const data = response.data;
  const requestId = Array.isArray(data.request_ids) ? data.request_ids[0] : data.request_id;
  const jobDefinitionId = data.jobDefinitionId;
  
  if (!jobDefinitionId) {
    throw new Error('No jobDefinitionId in response');
  }
  
  return { jobDefinitionId, requestId };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Ethereum Protocol Research - Entry Point                            ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('\nThis venture tests:');
  console.log('  ✓ Phase 1: Blueprint-driven execution');
  console.log('  ✓ Phase 2: Autonomous work decomposition (agent decides delegation)');
  console.log('  ✓ Phase 3: Recognition learning from past executions');
  console.log('\nDispatching entry point job...\n');

  try {
    const blueprint = await loadBlueprint('ethereum-protocol-research.json');
    
    console.log('📊 Dispatching: Ethereum Protocol Daily Brief\n');
    console.log('   Scope: 00:00 UTC Dec 1, 2025 → 00:00 UTC Dec 2, 2025');
    console.log('   Focus: Major DeFi protocols (Uniswap, Aave, Lido, Maker, Curve)');
    console.log('   Output: Structured Daily Report (Markdown Artifact)\n');
    
    // Inject the specific date scope into the blueprint instructions
    const dateScope = "TARGET DATE SCOPE: 00:00 UTC December 1, 2025 to 00:00 UTC December 2, 2025. All research must be strictly limited to this window.";
    const finalBlueprint = blueprint.replace('"assertions": [', `"context": "${dateScope}",\n  "assertions": [`);

    const result = await dispatchNewJob({
      jobName: 'ethereum-protocol-research',
      blueprint: finalBlueprint,
      model: 'gemini-2.5-flash',
      enabledTools: [
        'web_search',
        'create_artifact',
        'write_file',
        'read_file',
        'replace',
        'list_directory',
        'run_shell_command',
      ],
      // skipBranch auto-detected: no CODE_METADATA_REPO_ROOT = artifact-only mode
    });
    
    const { jobDefinitionId, requestId } = parseDispatchResponse(result);
    
    console.log('✅ Research job dispatched successfully!\n');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('\n📋 Job Details:');
    console.log(`   Job Name: ethereum-protocol-research`);
    console.log(`   Job Definition ID: ${jobDefinitionId}`);
    console.log(`   Request ID: ${requestId}`);
    console.log(`   Model: gemini-2.5-flash`);
    
    console.log('\n\n🔧 Next Steps:');
    console.log('\n1. Start worker to process the job:');
    console.log(`   MECH_TARGET_REQUEST_ID=${requestId} yarn dev:mech --single`);
    console.log('\n   Or to monitor the entire workstream:');
    console.log(`   yarn dev:mech --workstream=${requestId} --single`);
    
    console.log('\n2. Monitor execution:');
    console.log('   - Watch for blueprint assertions being addressed');
    console.log('   - Agent may delegate to child jobs or execute directly');
    console.log('   - Check job hierarchy for work decomposition decisions');
    
    console.log('\n3. Validate results:');
    console.log(`   yarn inspect-job-run ${requestId}`);
    
    console.log('\n4. View in explorer:');
    console.log(`   http://localhost:3000/requests/${requestId}`);
    
    console.log('\n\n📝 Validation Checklist:');
    console.log('   [ ] Phase 1: Agent processes blueprint assertions');
    console.log('   [ ] Phase 2: Agent makes autonomous delegation decisions');
    console.log('   [ ] All blueprint assertions satisfied in final output');
    console.log('   [ ] Output: "Ethereum Daily Brief" Artifact created');
    console.log('   [ ] Output: 5 Required Sections (Exec Summary, Metrics, Protocols, Anomalies, Synthesis)');
    console.log('   [ ] Output: Data strictly from Dec 1-2, 2025 window');
    console.log('   [ ] Output: Quantitative metrics for at least 3 protocols');
    
  } catch (error) {
    console.error('\n❌ Failed to dispatch job:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

main();

