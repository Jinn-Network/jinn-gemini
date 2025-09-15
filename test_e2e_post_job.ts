#!/usr/bin/env tsx

import './env/index.js';
import { postMarketplaceJob } from './gemini-agent/mcp/tools/post_marketplace_job.js';

async function testPostJob() {
  console.log('🚀 Testing end-to-end flow: Posting job to marketplace...');
  
  try {
    const result = await postMarketplaceJob({
      prompt: "Hello! Please respond with 'E2E test successful' and the current timestamp.",
      priorityMech: process.env.MECH_WORKER_ADDRESS || '0xaB15F8d064b59447Bd8E9e89DD3FA770aBF5EEb7',
      tools: ['get_details', 'manage_artifact'],
      chainConfig: 'base'
    });

    console.log('📤 Job posted result:', JSON.stringify(result, null, 2));
    
    // Extract the response
    const response = result.content[0]?.text;
    if (response) {
      const parsed = JSON.parse(response);
      if (parsed.meta?.ok) {
        console.log('✅ Job posted successfully!');
        console.log('📋 Request IDs:', parsed.data?.requestIds);
        console.log('🔗 Transaction hash:', parsed.data?.txHash);
        return parsed.data;
      } else {
        console.error('❌ Job posting failed:', parsed.meta?.message);
        return null;
      }
    }
  } catch (error) {
    console.error('❌ Error posting job:', error);
    return null;
  }
}

testPostJob().then((data) => {
  if (data) {
    console.log('\n🎯 Next steps:');
    console.log('1. Run: yarn dev:mech --single');
    console.log('2. Check Ponder GraphQL for delivery');
    console.log(`3. Query: curl -s http://localhost:42069/graphql -H "Content-Type: application/json" -d '{"query":"query { requests(orderBy: \\"blockTimestamp\\", orderDirection: \\"desc\\", limit: 5) { items { id mech requester blockTimestamp } } }"}'`);
  }
  process.exit(0);
});
