#!/usr/bin/env tsx
/**
 * Re-dispatch a failed or completed job by jobId or jobName
 * Usage: tsx scripts/redispatch-job.ts --jobId <uuid> [--message "optional message"] [--workstreamId <0x...>]
 *        tsx scripts/redispatch-job.ts --jobName <name> [--message "optional message"] [--workstreamId <0x...>]
 */

import '../env/index.js';
import { dispatchExistingJob } from '../gemini-agent/mcp/tools/dispatch_existing_job.js';

const args = process.argv.slice(2);
const jobIdIndex = args.indexOf('--jobId');
const jobNameIndex = args.indexOf('--jobName');
const messageIndex = args.indexOf('--message');
const workstreamIdIndex = args.indexOf('--workstreamId');

let jobId: string | undefined;
let jobName: string | undefined;
let message: string | undefined;
let workstreamId: string | undefined;

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

if (!jobId && !jobName) {
  console.error('Error: Must provide either --jobId or --jobName');
  console.error('Usage: tsx scripts/redispatch-job.ts --jobId <uuid> [--message "optional message"] [--workstreamId <0x...>]');
  console.error('       tsx scripts/redispatch-job.ts --jobName <name> [--message "optional message"] [--workstreamId <0x...>]');
  process.exit(1);
}

async function main() {
  console.log('Re-dispatching job...');
  console.log(`  jobId: ${jobId || 'N/A'}`);
  console.log(`  jobName: ${jobName || 'N/A'}`);
  if (message) console.log(`  message: ${message}`);
  if (workstreamId) console.log(`  workstreamId: ${workstreamId}`);

  const result = await dispatchExistingJob({
    jobId,
    jobName,
    message,
    workstreamId,
  });

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

