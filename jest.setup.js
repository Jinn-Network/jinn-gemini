// Jest setup for Zora integration tests
import { jest } from '@jest/globals';

// Global test configuration
jest.setTimeout(30000); // 30 second timeout for integration tests

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.CHAIN_ID = process.env.CHAIN_ID || '8453';
process.env.RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';

// Global mocks for external dependencies
global.fetch = jest.fn();

// Console methods that should be mocked in tests
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

// Cleanup after each test
afterEach(() => {
  jest.restoreAllMocks();
});

// Global error handler for unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
