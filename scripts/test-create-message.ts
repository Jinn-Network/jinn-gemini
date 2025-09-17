import 'dotenv/config';
import { createMessageTool } from '../gemini-agent/mcp/tools/create_message.js';

async function testCreateMessage() {
  console.log('Testing create_message tool...');
  
  // Test 1: Missing requestId context (should fail)
  console.log('\n1. Testing without JINN_REQUEST_ID context (should fail):');
  const result1 = await createMessageTool({
    content: 'Test message without context',
    status: 'PENDING'
  });
  console.log('Result:', JSON.parse(result1.content[0].text));

  // Test 2: With requestId context (should succeed if Control API is available)
  console.log('\n2. Testing with JINN_REQUEST_ID context:');
  process.env.JINN_REQUEST_ID = '0x273609f62f0510689d41f373426fb08c76b4b9242efe44bc1815e6e5eef54c80';
  process.env.JINN_MECH_ADDRESS = '0x1234567890123456789012345678901234567890';
  
  const result2 = await createMessageTool({
    content: 'Test message with context',
    status: 'PENDING'
  });
  console.log('Result:', JSON.parse(result2.content[0].text));

  // Test 3: Invalid parameters (should fail)
  console.log('\n3. Testing with invalid parameters (should fail):');
  const result3 = await createMessageTool({
    content: '', // Empty content should fail validation
    status: 'INVALID_STATUS'
  });
  console.log('Result:', JSON.parse(result3.content[0].text));

  // Test 4: Valid parameters with default status
  console.log('\n4. Testing with valid parameters and default status:');
  const result4 = await createMessageTool({
    content: 'Test message with default status'
    // status not provided, should default to 'PENDING'
  });
  console.log('Result:', JSON.parse(result4.content[0].text));

  console.log('\nTest completed!');
}

testCreateMessage().catch(console.error);
