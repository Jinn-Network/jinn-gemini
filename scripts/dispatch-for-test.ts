#!/usr/bin/env tsx
import '../env/index.js';
import { dispatchExistingJob } from '../gemini-agent/mcp/tools/dispatch_existing_job.js';

async function main() {
  const jobDefinitionId = process.argv[2];
  const message = process.argv[3] || 'Test run to verify WAITING status fix';
  const workstreamId = process.argv[4]; // Optional workstream ID
  
  if (!jobDefinitionId) {
    console.error('Usage: tsx scripts/dispatch-for-test.ts <jobDefinitionId> [message] [workstreamId]');
    process.exit(1);
  }
  
  try {
    const result = await dispatchExistingJob({
      jobId: jobDefinitionId,
      message,
      workstreamId
    });
    
    const parsed = JSON.parse(result.content[0].text);
    
    if (parsed.data && parsed.data.request_ids) {
      // Output just the request ID for easy capture in bash
      console.log(parsed.data.request_ids[0]);
    } else {
      console.error('ERROR:', JSON.stringify(parsed.meta));
      process.exit(1);
    }
  } catch (error: any) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
}

main();

