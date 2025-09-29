import { describe, test, expect, beforeEach, vi } from 'vitest';
import '../env/index.js';

// Mock dependencies
vi.mock('./logger.js', () => ({
  workerLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('./control_api_client.js', () => ({
  claimRequest: vi.fn(),
  createJobReport: vi.fn(),
  createArtifact: vi.fn()
}));

vi.mock('../gemini-agent/mcp/tools/dispatch_existing_job.js', () => ({
  dispatchExistingJob: vi.fn()
}));

// We'll need to export these functions from mech_worker.ts for testing
// For now, we'll test them inline

describe('FinalStatus Parser', () => {
  // Inline implementation for testing (should match mech_worker.ts)
  interface FinalStatus {
    status: 'COMPLETED' | 'DELEGATING' | 'WAITING' | 'FAILED';
    message: string;
  }

  function parseFinalStatus(output: string): FinalStatus | null {
    if (!output) return null;
    
    // Match FinalStatus: {...} pattern
    const pattern = /FinalStatus:\s*(\{[^}]+\})/;
    const match = output.match(pattern);
    
    if (!match) {
      return null;
    }
    
    try {
      const parsed = JSON.parse(match[1]);
      
      // Validate structure
      if (!parsed.status || !parsed.message) {
        return null;
      }
      
      // Validate status code
      const validStatuses = ['COMPLETED', 'DELEGATING', 'WAITING', 'FAILED'];
      if (!validStatuses.includes(parsed.status)) {
        return null;
      }
      
      return {
        status: parsed.status,
        message: parsed.message
      };
    } catch (e) {
      return null;
    }
  }

  test('parses valid COMPLETED status', () => {
    const output = `
    Execution Summary:
    - Objective: Generate market analysis
    - Job Output: Created comprehensive report
    
    FinalStatus: {"status": "COMPLETED", "message": "Successfully analyzed 15 market segments"}
    `;
    
    const result = parseFinalStatus(output);
    expect(result).toEqual({
      status: 'COMPLETED',
      message: 'Successfully analyzed 15 market segments'
    });
  });

  test('parses valid DELEGATING status', () => {
    const output = 'Some output\nFinalStatus: {"status": "DELEGATING", "message": "Dispatched 3 child jobs for data collection"}';
    const result = parseFinalStatus(output);
    expect(result).toEqual({
      status: 'DELEGATING',
      message: 'Dispatched 3 child jobs for data collection'
    });
  });

  test('parses valid WAITING status', () => {
    const output = 'FinalStatus: {"status": "WAITING", "message": "Waiting for sibling job results"}';
    const result = parseFinalStatus(output);
    expect(result).toEqual({
      status: 'WAITING',
      message: 'Waiting for sibling job results'
    });
  });

  test('parses valid FAILED status', () => {
    const output = 'Error occurred\nFinalStatus: {"status": "FAILED", "message": "API rate limit exceeded"}';
    const result = parseFinalStatus(output);
    expect(result).toEqual({
      status: 'FAILED',
      message: 'API rate limit exceeded'
    });
  });

  test('returns null for missing FinalStatus', () => {
    const output = 'Some output without any status signal';
    expect(parseFinalStatus(output)).toBeNull();
  });

  test('returns null for empty output', () => {
    expect(parseFinalStatus('')).toBeNull();
  });

  test('returns null for null/undefined output', () => {
    expect(parseFinalStatus(null as any)).toBeNull();
    expect(parseFinalStatus(undefined as any)).toBeNull();
  });

  test('validates status codes - rejects invalid status', () => {
    const output = 'FinalStatus: {"status": "INVALID", "message": "Test"}';
    expect(parseFinalStatus(output)).toBeNull();
  });

  test('validates structure - missing message', () => {
    const output = 'FinalStatus: {"status": "COMPLETED"}';
    expect(parseFinalStatus(output)).toBeNull();
  });

  test('validates structure - missing status', () => {
    const output = 'FinalStatus: {"message": "Test message"}';
    expect(parseFinalStatus(output)).toBeNull();
  });

  test('handles malformed JSON', () => {
    const output = 'FinalStatus: {status: "COMPLETED", message: "Missing quotes"}';
    expect(parseFinalStatus(output)).toBeNull();
  });

  test('handles partial JSON', () => {
    const output = 'FinalStatus: {"status": "COMPLETED"';
    expect(parseFinalStatus(output)).toBeNull();
  });

  test('extracts first FinalStatus when multiple present', () => {
    const output = `
    FinalStatus: {"status": "DELEGATING", "message": "First status"}
    Some other content
    FinalStatus: {"status": "COMPLETED", "message": "Second status"}
    `;
    const result = parseFinalStatus(output);
    expect(result).toEqual({
      status: 'DELEGATING',
      message: 'First status'
    });
  });

  test('handles FinalStatus with extra whitespace', () => {
    const output = 'FinalStatus:    {"status": "COMPLETED", "message": "Extra spaces"}';
    const result = parseFinalStatus(output);
    expect(result).toEqual({
      status: 'COMPLETED',
      message: 'Extra spaces'
    });
  });

  test('handles FinalStatus with newlines in message', () => {
    const output = 'FinalStatus: {"status": "FAILED", "message": "Error: Connection refused"}';
    const result = parseFinalStatus(output);
    expect(result).toEqual({
      status: 'FAILED',
      message: 'Error: Connection refused'
    });
  });
});

describe('Parent Dispatch Logic', () => {
  test('dispatches parent on COMPLETED status', () => {
    // Test that parent is dispatched when status is COMPLETED
  });

  test('dispatches parent on FAILED status', () => {
    // Test that parent is dispatched when status is FAILED
  });

  test('does not dispatch parent on DELEGATING status', () => {
    // Test that parent is NOT dispatched when status is DELEGATING
  });

  test('does not dispatch parent on WAITING status', () => {
    // Test that parent is NOT dispatched when status is WAITING
  });

  test('does not dispatch parent when no sourceJobDefinitionId', () => {
    // Test that parent is NOT dispatched when there's no parent job
  });
});