#!/usr/bin/env tsx
/**
 * Re-dispatch a failed or completed job by jobId or jobName
 * Usage: tsx scripts/redispatch-job.ts --jobId <uuid> [--message "optional message"]
 *        tsx scripts/redispatch-job.ts --jobName <name> [--message "optional message"]
 */

import { dispatchExistingJob } from '../gemini-agent/mcp/tools/dispatch_existing_job.js';

const args = process.argv.slice(2);
const jobIdIndex = args.indexOf('--jobId');
const jobNameIndex = args.indexOf('--jobName');
const messageIndex = args.indexOf('--message');

let jobId: string | undefined;
let jobName: string | undefined;
let message: string | undefined;

if (jobIdIndex !== -1 && args[jobIdIndex + 1]) {
  jobId = args[jobIdIndex + 1];
}

if (jobNameIndex !== -1 && args[jobNameIndex + 1]) {
  jobName = args[jobNameIndex + 1];
}

if (messageIndex !== -1 && args[messageIndex + 1]) {
  message = args[messageIndex + 1];
}

if (!jobId && !jobName) {
  console.error('Error: Must provide either --jobId or --jobName');
  console.error('Usage: tsx scripts/redispatch-job.ts --jobId <uuid> [--message "optional message"]');
  console.error('       tsx scripts/redispatch-job.ts --jobName <name> [--message "optional message"]');
  process.exit(1);
}

async function main() {
  console.log('Re-dispatching job...');
  console.log(`  jobId: ${jobId || 'N/A'}`);
  console.log(`  jobName: ${jobName || 'N/A'}`);
  if (message) console.log(`  message: ${message}`);

  const result = await dispatchExistingJob({
    jobId,
    jobName,
    message,
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

