/**
 * Integration tests for OlasOperateWrapper
 * 
 * These tests validate the wrapper functionality without requiring
 * a fully configured OLAS environment.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { OlasOperateWrapper, OperateCommandResult } from './OlasOperateWrapper.js';
import { resolve } from 'path';

describe('OlasOperateWrapper', () => {
  let wrapper: OlasOperateWrapper;

  beforeEach(async () => {
    wrapper = await OlasOperateWrapper.create({
      middlewarePath: resolve(process.cwd(), 'olas-operate-middleware'),
      timeout: 10000, // Shorter timeout for tests
      pythonBinary: 'python3'
    });
  });

  describe('Configuration', () => {
    test('should initialize with default configuration', async () => {
      const defaultWrapper = await OlasOperateWrapper.create();
      expect(defaultWrapper.getMiddlewarePath()).toContain('olas-operate-middleware');
    });

    test('should accept custom configuration', async () => {
      const customWrapper = await OlasOperateWrapper.create({
        middlewarePath: '/custom/path',
        timeout: 5000,
        pythonBinary: 'python'
      });
      expect(customWrapper.getMiddlewarePath()).toBe('/custom/path');
    });
  });

  describe('Environment Validation', () => {
    test('should validate environment and report issues', async () => {
      const result = await wrapper.validateEnvironment();
      
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('issues');
      expect(Array.isArray(result.issues)).toBe(true);
      
      // Should detect common issues like missing dependencies
      if (!result.isValid) {
        expect(result.issues.length).toBeGreaterThan(0);
        
        // Check for expected error patterns
        const hasExpectedError = result.issues.some(issue => 
          issue.includes('AEA/Autonomy framework') ||
          issue.includes('Python dependencies') ||
          issue.includes('Middleware not found') ||
          issue.includes('Python binary') ||
          issue.includes('Missing Python module') ||
          issue.includes("No module named 'aea'")
        );
        expect(hasExpectedError).toBe(true);
      }
    });
  });

  describe('Command Execution', () => {
    test('should handle command execution with proper error structure', async () => {
      // This will likely fail due to missing dependencies, but should return structured result
      const result = await wrapper.executeCommand('--version');
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('exitCode');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.stdout).toBe('string');
      expect(typeof result.stderr).toBe('string');
    });

    test('should handle timeout scenarios', async () => {
      // Create wrapper with very short timeout
      const timeoutWrapper = await OlasOperateWrapper.create({
        timeout: 100 // 100ms timeout
      });
      
      const result = await timeoutWrapper.executeCommand('--version');
      
      if (!result.success && result.stderr.includes('timed out')) {
        expect(result.exitCode).toBeNull();
        expect(result.stderr).toContain('timed out');
      }
    });

    test('should handle invalid commands gracefully', async () => {
      const result = await wrapper.executeCommand('invalid-command');
      
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.length).toBeGreaterThan(0);
    });
  });

  describe('Utility Methods', () => {
    test('should parse JSON output correctly', () => {
      const successResult: OperateCommandResult = {
        success: true,
        stdout: '{"test": "value", "number": 42}',
        stderr: '',
        exitCode: 0
      };
      
      const parsed = wrapper.parseJsonOutput(successResult);
      expect(parsed).toEqual({ test: 'value', number: 42 });
    });

    test('should handle invalid JSON gracefully', () => {
      const invalidResult: OperateCommandResult = {
        success: true,
        stdout: 'invalid json output',
        stderr: '',
        exitCode: 0
      };
      
      const parsed = wrapper.parseJsonOutput(invalidResult);
      expect(parsed).toBeNull();
    });

    test('should return null for failed commands', () => {
      const failedResult: OperateCommandResult = {
        success: false,
        stdout: '{"valid": "json"}',
        stderr: 'command failed',
        exitCode: 1
      };
      
      const parsed = wrapper.parseJsonOutput(failedResult);
      expect(parsed).toBeNull();
    });
  });

  describe('Agent and Service Commands', () => {
    test('should construct agent commands correctly', async () => {
      // Mock the executeCommand to verify correct argument passing
      const originalExecute = wrapper.executeCommand.bind(wrapper);
      let capturedArgs: string[] = [];
      
      wrapper.executeCommand = async (command: string, args: string[] = []) => {
        capturedArgs = [command, ...args];
        return {
          success: false,
          stdout: '',
          stderr: 'mocked',
          exitCode: 1
        };
      };
      
      await wrapper.executeAgentCommand('register', ['--arg1', 'value1']);
      
      expect(capturedArgs).toEqual(['agent', 'register', '--arg1', 'value1']);
      
      // Restore original method
      wrapper.executeCommand = originalExecute;
    });

    test('should construct service commands correctly', async () => {
      // Mock the executeCommand to verify correct argument passing
      const originalExecute = wrapper.executeCommand.bind(wrapper);
      let capturedArgs: string[] = [];
      
      wrapper.executeCommand = async (command: string, args: string[] = []) => {
        capturedArgs = [command, ...args];
        return {
          success: false,
          stdout: '',
          stderr: 'mocked',
          exitCode: 1
        };
      };
      
      await wrapper.executeServiceCommand('create', ['--service-id', '123']);
      
      expect(capturedArgs).toEqual(['service', 'create', '--service-id', '123']);
      
      // Restore original method
      wrapper.executeCommand = originalExecute;
    });
  });

  describe('Health Check', () => {
    test('should perform health check', async () => {
      const isHealthy = await wrapper.checkHealth();
      
      expect(typeof isHealthy).toBe('boolean');
      
      // In most test environments, this will be false due to missing dependencies
      // but the method should complete without throwing
    });
  });
});

describe('Integration Scenarios', () => {
  test('should provide helpful error messages for common setup issues', async () => {
    const wrapper = await OlasOperateWrapper.create();
    const validation = await wrapper.validateEnvironment();
    
    if (!validation.isValid) {
      // Should provide actionable error messages
      const hasActionableError = validation.issues.some(issue =>
        issue.includes('poetry install') ||
        issue.includes('git submodule') ||
        issue.includes('Check PATH') ||
        issue.includes('Install psutil') ||
        issue.includes('Missing Python module') ||
        issue.includes("No module named 'aea'")
      );
      
      expect(hasActionableError).toBe(true);
    }
  });
});
