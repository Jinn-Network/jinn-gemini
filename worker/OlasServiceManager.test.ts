/**
 * Tests for OlasServiceManager corrupt service cleanup
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { OlasServiceManager } from './OlasServiceManager.js';
import { OlasOperateWrapper } from './OlasOperateWrapper.js';

describe('OlasServiceManager - Corrupt Service Cleanup', () => {
  let testDir: string;
  let middlewarePath: string;
  let servicesDir: string;
  
  beforeEach(async () => {
    // Create temp directory structure
    testDir = join(tmpdir(), `olas-test-${Date.now()}`);
    middlewarePath = join(testDir, 'middleware');
    servicesDir = join(middlewarePath, '.operate/services');
    await fs.mkdir(servicesDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should detect and remove service with missing config.json', async () => {
    // Create service directory without config
    const corruptService = join(servicesDir, 'sc-missing-config');
    await fs.mkdir(corruptService);

    const wrapper = { 
      getMiddlewarePath: () => middlewarePath 
    } as any;
    const manager = new OlasServiceManager(wrapper, '/tmp/test.json', testDir);

    const result = await manager.cleanupCorruptServices();

    expect(result.cleaned).toContain('sc-missing-config');
    expect(result.errors).toHaveLength(0);
    
    // Verify directory was removed
    const exists = await fs.access(corruptService).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('should detect and remove service with zero address Safe', async () => {
    const corruptService = join(servicesDir, 'sc-zero-address');
    await fs.mkdir(corruptService);
    
    const config = {
      name: 'test-service',
      chain_configs: {
        base: {
          chain_data: {
            multisig: '0x0000000000000000000000000000000000000000',
            token: 123
          }
        }
      }
    };
    
    await fs.writeFile(join(corruptService, 'config.json'), JSON.stringify(config));

    const wrapper = { 
      getMiddlewarePath: () => middlewarePath 
    } as any;
    const manager = new OlasServiceManager(wrapper, '/tmp/test.json', testDir);

    const result = await manager.cleanupCorruptServices();

    expect(result.cleaned).toContain('sc-zero-address');
  });

  it('should detect and remove service with NO_MULTISIG', async () => {
    const corruptService = join(servicesDir, 'sc-no-multisig');
    await fs.mkdir(corruptService);
    
    const config = {
      name: 'test-service',
      chain_configs: {
        base: {
          chain_data: {
            multisig: 'NO_MULTISIG',
            token: -1
          }
        }
      }
    };
    
    await fs.writeFile(join(corruptService, 'config.json'), JSON.stringify(config));

    const wrapper = { 
      getMiddlewarePath: () => middlewarePath 
    } as any;
    const manager = new OlasServiceManager(wrapper, '/tmp/test.json', testDir);

    const result = await manager.cleanupCorruptServices();

    expect(result.cleaned).toContain('sc-no-multisig');
  });

  it('should detect and remove service with token ID -1', async () => {
    const corruptService = join(servicesDir, 'sc-unminted');
    await fs.mkdir(corruptService);
    
    const config = {
      name: 'test-service',
      chain_configs: {
        base: {
          chain_data: {
            multisig: '0x1234567890123456789012345678901234567890',
            token: -1
          }
        }
      }
    };
    
    await fs.writeFile(join(corruptService, 'config.json'), JSON.stringify(config));

    const wrapper = { 
      getMiddlewarePath: () => middlewarePath 
    } as any;
    const manager = new OlasServiceManager(wrapper, '/tmp/test.json', testDir);

    const result = await manager.cleanupCorruptServices();

    expect(result.cleaned).toContain('sc-unminted');
  });

  it('should keep valid service', async () => {
    const validService = join(servicesDir, 'sc-valid');
    await fs.mkdir(validService);
    
    const config = {
      name: 'valid-service',
      chain_configs: {
        base: {
          chain_data: {
            multisig: '0x1234567890123456789012345678901234567890',
            token: 149
          }
        }
      }
    };
    
    await fs.writeFile(join(validService, 'config.json'), JSON.stringify(config));

    const wrapper = { 
      getMiddlewarePath: () => middlewarePath 
    } as any;
    const manager = new OlasServiceManager(wrapper, '/tmp/test.json', testDir);

    const result = await manager.cleanupCorruptServices();

    expect(result.cleaned).not.toContain('sc-valid');
    
    // Verify directory still exists
    const exists = await fs.access(validService).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('should handle malformed JSON config', async () => {
    const corruptService = join(servicesDir, 'sc-bad-json');
    await fs.mkdir(corruptService);
    
    await fs.writeFile(join(corruptService, 'config.json'), '{ invalid json }');

    const wrapper = { 
      getMiddlewarePath: () => middlewarePath 
    } as any;
    const manager = new OlasServiceManager(wrapper, '/tmp/test.json', testDir);

    const result = await manager.cleanupCorruptServices();

    expect(result.cleaned).toContain('sc-bad-json');
  });

  it('should return empty result when no services exist', async () => {
    const wrapper = { 
      getMiddlewarePath: () => middlewarePath 
    } as any;
    const manager = new OlasServiceManager(wrapper, '/tmp/test.json', testDir);

    const result = await manager.cleanupCorruptServices();

    expect(result.cleaned).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
