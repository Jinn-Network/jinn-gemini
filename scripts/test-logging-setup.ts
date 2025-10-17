import { logger, agentLogger, workerLogger, createChildLogger, serializeError } from '../logging/index.js';

console.log('=== Testing Logger Setup ===\n');

// Test basic logging
logger.info('Basic logger test');
logger.info({ metadata: 'test' }, 'Logger with metadata');

// Test component loggers
workerLogger.info({ requestId: '123' }, 'Worker processing request');
agentLogger.info('Agent general log');

// Test special agent methods
agentLogger.output('This is AI agent output - should have 🤖 emoji in dev mode');
agentLogger.thinking('This is AI thinking - should have 💭 emoji in dev mode');

// Test custom child logger
const customLogger = createChildLogger('TEST_COMPONENT', { version: '1.0' });
customLogger.info({ action: 'test' }, 'Custom logger test');

// Test error serialization
try {
  throw new Error('Test error');
} catch (error) {
  logger.error({ error: serializeError(error) }, 'Error logging test');
}

console.log('\n=== Test Complete ===');
