#!/usr/bin/env tsx
/**
 * Launch Local Arcade Venture
 * 
 * Dispatches the initial job for the Local Arcade venture.
 * This venture creates a self-contained arcade with three classic games
 * (Snake, 2048, Minesweeper) that runs entirely offline.
 * 
 * Usage:
 *   ./scripts/ventures/launch-local-arcade.ts [optional message]
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
    console.log('║  🎮 Launching Local Arcade Venture                                    ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════╝');

    // Note: This venture doesn't require a specific repository since it's self-contained
    // The agent will create the arcade in a new location or use CODE_METADATA_REPO_ROOT if set
    if (process.env.CODE_METADATA_REPO_ROOT) {
        console.log(`\n📂 Linked Repository: ${process.env.CODE_METADATA_REPO_ROOT}`);
        console.log('   (The arcade will be created in this location)');
    } else {
        console.log('\n📂 No repository specified - agent will determine the output location');
    }

    try {
        const blueprint = await loadBlueprint('local-arcade.json');
        const message = process.argv[2];

        console.log('\n📋 Dispatching initial job...');
        if (message) {
            console.log(`   Message: "${message}"`);
        }

        const result = await dispatchNewJob({
            jobName: 'local-arcade-initial',
            blueprint,
            message,
            model: 'gemini-2.5-pro',
            enabledTools: [
                'web_search',
                'create_artifact',
                'write_file', // Official Gemini CLI tool name
                'read_file',
                'replace', // Official Gemini CLI tool for editing files
                'list_directory',
                'run_shell_command', // Official Gemini CLI tool name for shell execution
                'dispatch_new_job' // Needed for delegation
            ],
            skipBranch: false, // We WANT a branch for this venture to start coding
        });

        const { jobDefinitionId, requestId } = parseDispatchResponse(result);

        console.log('✅ Venture launched successfully!\n');
        console.log('═══════════════════════════════════════════════════════════════════════');
        console.log(`   Job Definition ID: ${jobDefinitionId}`);
        console.log(`   Request ID: ${requestId}`);
        console.log('═══════════════════════════════════════════════════════════════════════');

        console.log('\n🔧 Next Steps:');
        console.log('\n1. Start the worker:');
        console.log(`   MECH_TARGET_REQUEST_ID=${requestId} yarn dev:mech --single`);

        console.log('\n2. Monitor the agent:');
        console.log(`   http://localhost:3000/requests/${requestId}`);

    } catch (error) {
        console.error('\n❌ Failed to launch venture:', error);
        process.exit(1);
    }
}

main();

