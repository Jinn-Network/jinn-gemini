#!/usr/bin/env tsx

import { getDetails } from '../gemini-agent/mcp/tools/get-details.js';
import { resolveRequestIpfsContent, resolveIpfsContent } from '../gemini-agent/mcp/tools/shared/ipfs.js';

async function testIpfsResolution() {
    console.log('🧪 Testing IPFS resolution in get-details tool...\n');

    try {
        // Test with the newest request ID from Ponder that has IPFS content
        const testRequestId = '0x1d0585cbd8d049919321f8f8d29f8493f5b0eeb57f8fbe6494d7aa28fa8e34ea';
        
        console.log(`📋 Testing get-details with request ID: ${testRequestId}`);
        
        const result = await getDetails({
            ids: [testRequestId],
            resolve_ipfs: true
        });

        console.log('✅ get-details result:');
        console.log(JSON.stringify(result, null, 2));

        // Test direct IPFS resolution functions
        console.log('\n🔍 Testing direct IPFS resolution functions...');
        
        // Test resolveRequestIpfsContent with a working CID from our latest request
        const realCid = 'f01551220fb6ff905cb73c04fa4b74a97f7cf28adb45bef824e8687d0fd0fdf3688d909bc';
        console.log(`📄 Testing resolveRequestIpfsContent with real CID: ${realCid}`);
        
        try {
            const requestContent = await resolveRequestIpfsContent(realCid, 15000);
            console.log('✅ Request IPFS content:', requestContent);
        } catch (error) {
            console.log('⚠️  Request IPFS resolution failed:', error.message);
        }

        // Test resolveIpfsContent for deliverables
        const sampleDeliverableCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
        const sampleRequestId = '123456789';
        console.log(`📦 Testing resolveIpfsContent with CID: ${sampleDeliverableCid}, Request ID: ${sampleRequestId}`);
        
        try {
            const deliverableContent = await resolveIpfsContent(sampleDeliverableCid, sampleRequestId, 5000);
            console.log('✅ Deliverable IPFS content:', deliverableContent);
        } catch (error) {
            console.log('⚠️  Deliverable IPFS resolution failed (expected for test CID):', error.message);
        }

        console.log('\n🎉 IPFS resolution test completed!');

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

testIpfsResolution();
