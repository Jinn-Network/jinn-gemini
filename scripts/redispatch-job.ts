#!/usr/bin/env tsx
/**
 * Re-dispatch a failed or completed job by jobId or jobName
 * Usage: tsx scripts/redispatch-job.ts --jobId <uuid> [--message "optional message"] [--workstreamId <0x...>]
 *        tsx scripts/redispatch-job.ts --jobName <name> [--message "optional message"] [--workstreamId <0x...>]
 */

import '../env/index.js';
import { dispatchExistingJob } from '../gemini-agent/mcp/tools/dispatch_existing_job.js';
import { graphQLRequest } from '../http/client.js';
import { getPonderGraphqlUrl } from '../gemini-agent/mcp/tools/shared/env.js';
import { buildIpfsPayload } from '../gemini-agent/shared/ipfs-payload-builder.js';
import { marketplaceInteract } from '@jinn-network/mech-client-ts/dist/marketplace_interact.js';
import { getMechAddress, getMechChainConfig, getServicePrivateKey } from '../env/operate-profile.js';

const args = process.argv.slice(2);
const jobIdIndex = args.indexOf('--jobId');
const jobNameIndex = args.indexOf('--jobName');
const messageIndex = args.indexOf('--message');
const workstreamIdIndex = args.indexOf('--workstreamId');
const cyclicIndex = args.indexOf('--cyclic');

let jobId: string | undefined;
let jobName: string | undefined;
let message: string | undefined;
let workstreamId: string | undefined;
let cyclic = false;

if (jobIdIndex !== -1 && args[jobIdIndex + 1]) {
  jobId = args[jobIdIndex + 1];
}

if (jobNameIndex !== -1 && args[jobNameIndex + 1]) {
  jobName = args[jobNameIndex + 1];
}

if (messageIndex !== -1 && args[messageIndex + 1]) {
  message = args[messageIndex + 1];
}

if (workstreamIdIndex !== -1 && args[workstreamIdIndex + 1]) {
  workstreamId = args[workstreamIdIndex + 1];
}
if (cyclicIndex !== -1) {
  cyclic = true;
}

if (!jobId && !jobName) {
  console.error('Error: Must provide either --jobId or --jobName');
  console.error('Usage: tsx scripts/redispatch-job.ts --jobId <uuid> [--message "optional message"] [--workstreamId <0x...>] [--cyclic]');
  console.error('       tsx scripts/redispatch-job.ts --jobName <name> [--message "optional message"] [--workstreamId <0x...>] [--cyclic]');
  process.exit(1);
}

async function main() {
  console.log('Re-dispatching job...');
  console.log(`  jobId: ${jobId || 'N/A'}`);
  console.log(`  jobName: ${jobName || 'N/A'}`);
  if (message) console.log(`  message: ${message}`);
  if (workstreamId) console.log(`  workstreamId: ${workstreamId}`);
  if (cyclic) console.log('  cyclic: true');

  let result: any;
  if (!cyclic) {
    result = await dispatchExistingJob({
      jobId,
      jobName,
      message,
      workstreamId,
    });
  } else {
    const ponderUrl = getPonderGraphqlUrl();
    let jobDef: any | null = null;
    if (jobId) {
      const response = await graphQLRequest<{
        jobDefinition: {
          id: string;
          name: string;
          enabledTools?: string[];
          blueprint?: string;
          codeMetadata?: any;
        } | null;
      }>({
        url: ponderUrl,
        query: `query($id: String!) { jobDefinition(id: $id) { id name enabledTools blueprint codeMetadata } }`,
        variables: { id: jobId },
        maxRetries: 1,
        context: { operation: 'getJobById', jobId },
      });
      jobDef = response?.jobDefinition || null;
    } else if (jobName) {
      const response = await graphQLRequest<{
        jobDefinitions: { items: Array<{ id: string; name: string; enabledTools?: string[]; blueprint?: string; codeMetadata?: any; }>; };
      }>({
        url: ponderUrl,
        query: `query($name: String!) { jobDefinitions(where: { name: $name }, limit: 1) { items { id name enabledTools blueprint codeMetadata } } }`,
        variables: { name: jobName },
        maxRetries: 1,
        context: { operation: 'getJobByName', jobName },
      });
      jobDef = response?.jobDefinitions?.items?.[0] || null;
    }

    if (!jobDef) {
      console.error(`Job definition '${jobName || jobId}' not found in Ponder.`);
      process.exit(1);
    }

    const jobDefinitionId = jobDef.id;
    const enabledTools = Array.isArray(jobDef.enabledTools) ? jobDef.enabledTools : [];
    const blueprint = typeof jobDef.blueprint === 'string' ? jobDef.blueprint : undefined;

    if (!blueprint) {
      console.error('Job definition has no blueprint; cannot redispatch with cyclic flag.');
      process.exit(1);
    }

    const { ipfsJsonContents } = await buildIpfsPayload({
      blueprint,
      jobName: jobDef.name,
      jobDefinitionId,
      enabledTools,
      model: undefined,
      tools: undefined,
      cyclic: true,
      additionalContextOverrides: message
        ? { message: { content: message, to: jobDefinitionId } }
        : undefined,
      workstreamId,
      codeMetadata: jobDef.codeMetadata,
    } as any);

    const mechAddress = getMechAddress();
    const chainConfig = getMechChainConfig();
    const privateKey = getServicePrivateKey();
    if (!mechAddress || !privateKey) {
      throw new Error('Mech config missing (MECH address/private key).');
    }

    const dispatchResult = await marketplaceInteract({
      prompts: [blueprint],
      priorityMech: mechAddress,
      tools: enabledTools,
      ipfsJsonContents,
      chainConfig,
      keyConfig: { source: 'value', value: privateKey },
      postOnly: true,
      responseTimeout: 300,
    });

    result = {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ data: dispatchResult, meta: { ok: true } }),
      }],
    };
  }

  console.log('\nResult:');
  if (result.content && result.content[0] && result.content[0].type === 'text') {
    const parsed = JSON.parse(result.content[0].text);
    console.log(JSON.stringify(parsed, null, 2));

    if (parsed.meta?.ok) {
      console.log('\n✓ Job dispatched successfully!');
      if (parsed.data?.request_ids) {
        console.log(`Request IDs: ${parsed.data.request_ids.join(', ')}`);
      }
    } else {
      console.error('\n✗ Job dispatch failed');
      console.error(`Code: ${parsed.meta?.code}`);
      console.error(`Message: ${parsed.meta?.message}`);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

