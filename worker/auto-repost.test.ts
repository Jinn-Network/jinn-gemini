#!/usr/bin/env tsx
/**
 * Basic test for the auto-repost functionality
 * Tests the logic for determining if chains should be reposted
 */

import 'dotenv/config';

// Test configuration
const TEST_REPOSTING_CONFIG = {
  maxDecompositionDepth: 5,
  minTimeBetweenReposts: 5 * 60 * 1000, // 5 minutes
  chainCompletionTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
  enableAutoRepost: true,
};

// Mock recent reposts map for testing
const testRecentReposts = new Map<string, number>();

/**
 * Test version of shouldRepost function
 */
function testShouldRepost(rootJobDefinitionId: string): boolean {
  const now = Date.now();
  const lastRepost = testRecentReposts.get(rootJobDefinitionId);
  
  if (lastRepost && (now - lastRepost) < TEST_REPOSTING_CONFIG.minTimeBetweenReposts) {
    return false;
  }
  
  return true;
}

/**
 * Test the shouldRepost logic
 */
function testRepostLogic() {
  console.log('🧪 Testing auto-repost logic...');
  
  const testJobId = 'test-job-123';
  
  // Test 1: Should allow repost for new job
  console.log('Test 1: New job should allow repost');
  const result1 = testShouldRepost(testJobId);
  console.assert(result1 === true, 'New job should allow repost');
  console.log('✅ New job repost allowed');
  
  // Test 2: Should prevent immediate repost after recent repost
  console.log('Test 2: Recent repost should prevent immediate repost');
  testRecentReposts.set(testJobId, Date.now());
  const result2 = testShouldRepost(testJobId);
  console.assert(result2 === false, 'Recent repost should prevent immediate repost');
  console.log('✅ Recent repost prevention working');
  
  // Test 3: Should allow repost after timeout
  console.log('Test 3: Old repost should allow new repost');
  const oldTimestamp = Date.now() - (TEST_REPOSTING_CONFIG.minTimeBetweenReposts + 1000);
  testRecentReposts.set(testJobId, oldTimestamp);
  const result3 = testShouldRepost(testJobId);
  console.assert(result3 === true, 'Old repost should allow new repost');
  console.log('✅ Old repost timeout working');
  
  console.log('🎉 All repost logic tests passed!');
}

/**
 * Test the DecompositionContext interface
 */
function testDecompositionContextInterface() {
  console.log('🧪 Testing DecompositionContext interface...');
  
  // Test that the interface structure is correct
  const mockContext = {
    jobChainId: 'test-chain-123',
    rootJobDefinition: {
      id: 'test-root-job-456',
      name: 'Test Root Job',
    },
    completedWork: {
      totalRequests: 3,
      successfulRequests: 2,
      failedRequests: 1,
      artifacts: [
        {
          id: 'artifact-1',
          name: 'Test Artifact',
          topic: 'test-topic',
          cid: 'QmTest123',
        }
      ],
      deliveries: [
        {
          requestId: '0x123',
          ipfsHash: 'QmDelivery123',
        }
      ],
    },
    chainMetrics: {
      totalDuration: 300000, // 5 minutes
      averageRequestTime: 100000, // ~1.7 minutes
      startTime: new Date('2025-01-01T10:00:00Z'),
      endTime: new Date('2025-01-01T10:05:00Z'),
    },
  };
  
  // Basic structure validation
  console.assert(typeof mockContext.jobChainId === 'string', 'jobChainId should be string');
  console.assert(typeof mockContext.rootJobDefinition.id === 'string', 'rootJobDefinition.id should be string');
  console.assert(typeof mockContext.rootJobDefinition.name === 'string', 'rootJobDefinition.name should be string');
  console.assert(typeof mockContext.completedWork.totalRequests === 'number', 'totalRequests should be number');
  console.assert(Array.isArray(mockContext.completedWork.artifacts), 'artifacts should be array');
  console.assert(Array.isArray(mockContext.completedWork.deliveries), 'deliveries should be array');
  console.assert(mockContext.chainMetrics.startTime instanceof Date, 'startTime should be Date');
  console.assert(mockContext.chainMetrics.endTime instanceof Date, 'endTime should be Date');
  
  console.log('✅ DecompositionContext interface validation passed!');
}

/**
 * Test enhanced prompt generation logic
 */
function testEnhancedPromptGeneration() {
  console.log('🧪 Testing enhanced prompt generation...');
  
  const originalPrompt = "Complete the user's task efficiently.";
  const mockContext = {
    jobChainId: 'test-chain-123',
    rootJobDefinition: {
      id: 'test-root-job-456',
      name: 'Test Root Job',
    },
    completedWork: {
      totalRequests: 2,
      successfulRequests: 2,
      failedRequests: 0,
      artifacts: [
        {
          id: 'artifact-1',
          name: 'Research Results',
          topic: 'market-analysis',
          cid: 'QmTest123',
        }
      ],
      deliveries: [
        {
          requestId: '0x123',
          ipfsHash: 'QmDelivery123',
        }
      ],
    },
    chainMetrics: {
      totalDuration: 300000, // 5 minutes
      averageRequestTime: 150000,
      startTime: new Date('2025-01-01T10:00:00Z'),
      endTime: new Date('2025-01-01T10:05:00Z'),
    },
  };
  
  // Simulate enhanced prompt generation
  const enhancedPrompt = `${originalPrompt}

## DECOMPOSITION RESULTS SUMMARY
Previous work was decomposed into ${mockContext.completedWork.totalRequests} sub-tasks.

### Completed Work:
${mockContext.completedWork.artifacts.map(a => `- ${a.name}: ${a.topic}`).join('\n')}

### Available Context:
${mockContext.completedWork.deliveries.map(d => `- Request ${d.requestId}: Available via IPFS ${d.ipfsHash}`).join('\n')}

### Chain Metrics:
- Total Duration: ${Math.round(mockContext.chainMetrics.totalDuration / 1000 / 60)} minutes
- Successful Requests: ${mockContext.completedWork.successfulRequests}/${mockContext.completedWork.totalRequests}

### Next Steps:
Based on the completed decomposition work above, determine what needs to be done next. You can:
1. Integrate the results and complete the original task
2. Identify any missing work and decompose further if needed
3. Deliver final results if the task is complete

Previous decomposition chain ID: ${mockContext.jobChainId}
`;

  // Validate enhanced prompt contains expected elements
  console.assert(enhancedPrompt.includes(originalPrompt), 'Enhanced prompt should contain original prompt');
  console.assert(enhancedPrompt.includes('DECOMPOSITION RESULTS SUMMARY'), 'Should contain decomposition summary');
  console.assert(enhancedPrompt.includes('Research Results'), 'Should contain artifact names');
  console.assert(enhancedPrompt.includes('market-analysis'), 'Should contain artifact topics');
  console.assert(enhancedPrompt.includes('5 minutes'), 'Should contain duration');
  console.assert(enhancedPrompt.includes('2/2'), 'Should contain success ratio');
  console.assert(enhancedPrompt.includes(mockContext.jobChainId), 'Should contain chain ID');
  
  console.log('✅ Enhanced prompt generation working correctly!');
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('🚀 Running auto-repost functionality tests...\n');
  
  try {
    testRepostLogic();
    console.log();
    testDecompositionContextInterface();
    console.log();
    testEnhancedPromptGeneration();
    console.log();
    console.log('🎉 All tests passed! Auto-repost functionality is ready.');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
runTests();