/**
 * Comprehensive unit tests for the storage layer
 * 
 * Tests cover file permissions, atomic writes, locking mechanisms,
 * error handling, and edge cases for the wallet identity storage system.
 */

import { promises as fs, constants } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import {
  saveWalletIdentity,
  loadWalletIdentity,
  walletExists,
  acquireLock,
  releaseLock,
  withLock,
  getWalletPath,
  getLockPath,
  getTempPath,
} from '../storage.js';
import type { WalletIdentity } from '../types.js';
import { vi } from 'vitest';

describe('Storage Layer', () => {
  let testBasePath: string;
  let testIdentity: WalletIdentity;
  
  const testChainId = 8453;
  const testOwnerAddress = '0x742d35cc6b8a6f8f6b8e8b8e8b8e8b8e8b8e8b8e' as const;

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testBasePath = join(tmpdir(), `wallet-manager-test-${Date.now()}-${Math.random().toString(36).substring(2)}`);
    
    testIdentity = {
      ownerAddress: testOwnerAddress,
      safeAddress: '0x1234567890123456789012345678901234567890' as const,
      chainId: testChainId,
      createdAt: '2025-08-25T12:34:56Z',
      saltNonce: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const,
    };
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testBasePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Path Utilities', () => {
    it('should generate correct wallet path', () => {
      const path = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      const expected = join(testBasePath, testChainId.toString(), `${testOwnerAddress}.json`);
      expect(path).toBe(expected);
    });

    it('should generate correct lock path', () => {
      const walletPath = '/path/to/wallet.json';
      const lockPath = getLockPath(walletPath);
      expect(lockPath).toBe('/path/to/wallet.json.lock');
    });

    it('should generate correct temp path', () => {
      const walletPath = '/path/to/wallet.json';
      const tempPath = getTempPath(walletPath);
      expect(tempPath).toBe('/path/to/wallet.json.tmp');
    });
  });

  describe('File Locking', () => {
    it('should acquire and release locks successfully', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      
      // Acquire lock
      const lockResult = await acquireLock(walletPath);
      expect(lockResult.success).toBe(true);
      
      if (lockResult.success) {
        const lockHandle = lockResult.data;
        expect(lockHandle.acquired).toBe(true);
        expect(lockHandle.lockPath).toBe(getLockPath(walletPath));
        
        // Verify lock file exists
        const lockExists = await fs.access(lockHandle.lockPath, constants.F_OK)
          .then(() => true)
          .catch(() => false);
        expect(lockExists).toBe(true);
        
        // Release lock
        const releaseResult = await releaseLock(lockHandle);
        expect(releaseResult.success).toBe(true);
        expect(lockHandle.acquired).toBe(false);
        
        // Verify lock file is removed
        const lockExistsAfter = await fs.access(lockHandle.lockPath, constants.F_OK)
          .then(() => true)
          .catch(() => false);
        expect(lockExistsAfter).toBe(false);
      }
    });

    it('should detect and clean up stale locks', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      const lockPath = getLockPath(walletPath);
      
      // Create directory structure
      await fs.mkdir(dirname(lockPath), { recursive: true });
      
      // Create a stale lock file with a non-existent PID
      const staleLockInfo = {
        pid: 999999, // Very unlikely to exist
        acquiredAt: new Date().toISOString(),
        walletPath
      };
      await fs.writeFile(lockPath, JSON.stringify(staleLockInfo));
      
      // Should successfully acquire lock despite stale lock
      const lockResult = await acquireLock(walletPath);
      expect(lockResult.success).toBe(true);
      
      if (lockResult.success) {
        // Verify lock was acquired with current process PID
        const lockContent = await fs.readFile(lockResult.data.lockPath, 'utf8');
        const lockInfo = JSON.parse(lockContent);
        expect(lockInfo.pid).toBe(process.pid);
        
        await releaseLock(lockResult.data);
      }
    });

    it('should handle corrupted lock files', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      const lockPath = getLockPath(walletPath);
      
      // Create directory structure
      await fs.mkdir(dirname(lockPath), { recursive: true });
      
      // Create a corrupted lock file
      await fs.writeFile(lockPath, 'invalid json content');
      
      // Should successfully acquire lock despite corrupted lock file
      const lockResult = await acquireLock(walletPath);
      expect(lockResult.success).toBe(true);
      
      if (lockResult.success) {
        await releaseLock(lockResult.data);
      }
    });

    it('should prevent concurrent lock acquisition', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      
      // Acquire first lock
      const lock1Result = await acquireLock(walletPath);
      expect(lock1Result.success).toBe(true);
      
      // Try to acquire second lock - should fail
      const lock2Result = await acquireLock(walletPath);
      expect(lock2Result.success).toBe(false);
      if (!lock2Result.success) {
        expect(lock2Result.error).toBe('lock_already_held');
      }
      
      // Release first lock
      if (lock1Result.success) {
        await releaseLock(lock1Result.data);
        
        // Now second lock should succeed
        const lock3Result = await acquireLock(walletPath);
        expect(lock3Result.success).toBe(true);
        
        if (lock3Result.success) {
          await releaseLock(lock3Result.data);
        }
      }
    });

    it('should handle releasing already released locks gracefully', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      
      const lockResult = await acquireLock(walletPath);
      expect(lockResult.success).toBe(true);
      
      if (lockResult.success) {
        const lockHandle = lockResult.data;
        
        // Release lock twice
        const release1 = await releaseLock(lockHandle);
        expect(release1.success).toBe(true);
        
        const release2 = await releaseLock(lockHandle);
        expect(release2.success).toBe(true);
      }
    });

    it('should write lock information to lock file', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      
      const lockResult = await acquireLock(walletPath);
      expect(lockResult.success).toBe(true);
      
      if (lockResult.success) {
        const lockHandle = lockResult.data;
        
        // Read lock file content
        const lockContent = await fs.readFile(lockHandle.lockPath, 'utf8');
        const lockInfo = JSON.parse(lockContent);
        
        expect(lockInfo).toHaveProperty('pid');
        expect(lockInfo).toHaveProperty('acquiredAt');
        expect(lockInfo).toHaveProperty('walletPath');
        expect(lockInfo.walletPath).toBe(walletPath);
        expect(typeof lockInfo.pid).toBe('number');
        
        await releaseLock(lockHandle);
      }
    });
  });

  describe('withLock Helper', () => {
    it('should execute operation with automatic lock management', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      let executed = false;
      
      const result = await withLock(walletPath, async () => {
        executed = true;
        return 'success';
      });
      
      expect(result).toBe('success');
      expect(executed).toBe(true);
      
      // Verify lock is released
      const lockPath = getLockPath(walletPath);
      const lockExists = await fs.access(lockPath, constants.F_OK)
        .then(() => true)
        .catch(() => false);
      expect(lockExists).toBe(false);
    });

    it('should release lock even if operation throws', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      
      await expect(withLock(walletPath, async () => {
        throw new Error('Test error');
      })).rejects.toThrow('Test error');
      
      // Verify lock is still released
      const lockPath = getLockPath(walletPath);
      const lockExists = await fs.access(lockPath, constants.F_OK)
        .then(() => true)
        .catch(() => false);
      expect(lockExists).toBe(false);
    });

    it('should throw if lock acquisition fails after retries', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      
      // Acquire lock first
      const lockResult = await acquireLock(walletPath);
      expect(lockResult.success).toBe(true);
      
      // Try to use withLock - should fail after retries
      const startTime = Date.now();
      await expect(withLock(walletPath, async () => {
        return 'should not execute';
      })).rejects.toThrow('Failed to acquire lock after 10 attempts');
      
      // Should have taken some time due to retries with backoff
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThan(100); // At least base delay
      
      // Clean up
      if (lockResult.success) {
        await releaseLock(lockResult.data);
      }
    }, 30000); // Increase timeout to 30 seconds to account for exponential backoff

    it('should retry and succeed when lock becomes available', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      
      // Acquire lock first
      const lockResult = await acquireLock(walletPath);
      expect(lockResult.success).toBe(true);
      
      let operationExecuted = false;
      
      // Release lock after a short delay to simulate it becoming available
      setTimeout(async () => {
        if (lockResult.success) {
          await releaseLock(lockResult.data);
        }
      }, 100);
      
      // withLock should eventually succeed when lock becomes available
      const result = await withLock(walletPath, async () => {
        operationExecuted = true;
        return 'success';
      });
      
      expect(result).toBe('success');
      expect(operationExecuted).toBe(true);
    });
  });

  describe('Wallet Identity Persistence', () => {
    it('should save and load wallet identity successfully', async () => {
      const saveResult = await saveWalletIdentity(
        testChainId,
        testOwnerAddress,
        testIdentity,
        testBasePath
      );
      
      expect(saveResult.success).toBe(true);
      
      const loadResult = await loadWalletIdentity(
        testChainId,
        testOwnerAddress,
        testBasePath
      );
      
      expect(loadResult.success).toBe(true);
      if (loadResult.success) {
        expect(loadResult.data).toEqual(testIdentity);
      }
    });

    it('should create directory structure with correct permissions', async () => {
      const saveResult = await saveWalletIdentity(
        testChainId,
        testOwnerAddress,
        testIdentity,
        testBasePath
      );
      
      expect(saveResult.success).toBe(true);
      
      // Check directory permissions
      const dirPath = join(testBasePath, testChainId.toString());
      const dirStats = await fs.stat(dirPath);
      expect(dirStats.mode & 0o777).toBe(0o700);
    });

    it('should set correct file permissions', async () => {
      const saveResult = await saveWalletIdentity(
        testChainId,
        testOwnerAddress,
        testIdentity,
        testBasePath
      );
      
      expect(saveResult.success).toBe(true);
      
      // Check file permissions
      const filePath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      const fileStats = await fs.stat(filePath);
      expect(fileStats.mode & 0o777).toBe(0o600);
    });

    it('should perform atomic writes', async () => {
      // This test ensures that if we interrupt a write operation,
      // we don't end up with corrupted data
      
      const originalWrite = fs.writeFile;
      let writeCallCount = 0;
      
      // Mock fs.writeFile to fail on the first call (simulating interruption)
      const mockWriteFile = vi.fn(async (path: any, data: any, options: any) => {
        writeCallCount++;
        if (writeCallCount === 1 && path.includes('.tmp')) {
          throw new Error('Simulated write failure');
        }
        return originalWrite(path, data, options);
      });
      
      (fs as any).writeFile = mockWriteFile;
      
      try {
        const saveResult = await saveWalletIdentity(
          testChainId,
          testOwnerAddress,
          testIdentity,
          testBasePath
        );
        
        expect(saveResult.success).toBe(false);
        if (!saveResult.success) {
          expect(saveResult.error).toBe('atomic_write_failed');
        }
        
        // Verify no corrupted files exist (check for any .tmp files in directory)
        const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
        const dirPath = dirname(walletPath);
        
        const walletExists = await fs.access(walletPath, constants.F_OK)
          .then(() => true)
          .catch(() => false);
        expect(walletExists).toBe(false);
        
        // Check for any temp files
        try {
          const files = await fs.readdir(dirPath);
          const tempFiles = files.filter(f => f.includes('.tmp'));
          expect(tempFiles.length).toBe(0);
        } catch {
          // Directory might not exist, which is fine
        }
        
      } finally {
        // Restore original function
        (fs as any).writeFile = originalWrite;
      }
    });

    it('should use unique temporary filenames to prevent races', async () => {
      // Test that concurrent saves use different temp files
      const promises = Array.from({ length: 3 }, (_, i) => 
        saveWalletIdentity(
          testChainId,
          testOwnerAddress,
          { ...testIdentity, createdAt: `2025-08-25T12:34:${i.toString().padStart(2, '0')}Z` },
          testBasePath
        )
      );
      
      const results = await Promise.all(promises);
      
      // All operations should succeed since they use unique temp filenames
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      
      // Verify final state is consistent
      const loadResult = await loadWalletIdentity(
        testChainId,
        testOwnerAddress,
        testBasePath
      );
      
      expect(loadResult.success).toBe(true);
    });

    it('should handle file not found error', async () => {
      const loadResult = await loadWalletIdentity(
        testChainId,
        testOwnerAddress,
        testBasePath
      );
      
      expect(loadResult.success).toBe(false);
      if (!loadResult.success) {
        expect(loadResult.error).toBe('file_not_found');
      }
    });

    it('should validate loaded identity structure', async () => {
      // Save invalid JSON structure
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      await fs.mkdir(join(testBasePath, testChainId.toString()), { recursive: true });
      await fs.writeFile(walletPath, JSON.stringify({ incomplete: 'data' }));
      
      const loadResult = await loadWalletIdentity(
        testChainId,
        testOwnerAddress,
        testBasePath
      );
      
      expect(loadResult.success).toBe(false);
      if (!loadResult.success) {
        expect(loadResult.error).toBe('invalid_json');
      }
    });

    it('should validate identity parameters match request', async () => {
      // Save identity with different parameters
      const wrongIdentity = {
        ...testIdentity,
        chainId: 999, // Wrong chain ID
      };
      
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      await fs.mkdir(join(testBasePath, testChainId.toString()), { recursive: true });
      await fs.writeFile(walletPath, JSON.stringify(wrongIdentity));
      
      const loadResult = await loadWalletIdentity(
        testChainId,
        testOwnerAddress,
        testBasePath
      );
      
      expect(loadResult.success).toBe(false);
      if (!loadResult.success) {
        expect(loadResult.error).toBe('invalid_json');
        expect(loadResult.message).toContain('mismatch');
      }
    });

    it('should handle invalid JSON syntax', async () => {
      // Save malformed JSON
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      await fs.mkdir(join(testBasePath, testChainId.toString()), { recursive: true });
      await fs.writeFile(walletPath, '{ invalid json syntax');
      
      const loadResult = await loadWalletIdentity(
        testChainId,
        testOwnerAddress,
        testBasePath
      );
      
      expect(loadResult.success).toBe(false);
      if (!loadResult.success) {
        expect(loadResult.error).toBe('invalid_json');
      }
    });
  });

  describe('walletExists Helper', () => {
    it('should return true for existing wallet', async () => {
      await saveWalletIdentity(
        testChainId,
        testOwnerAddress,
        testIdentity,
        testBasePath
      );
      
      const exists = await walletExists(testChainId, testOwnerAddress, testBasePath);
      expect(exists).toBe(true);
    });

    it('should return false for non-existing wallet', async () => {
      const exists = await walletExists(testChainId, testOwnerAddress, testBasePath);
      expect(exists).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle permission errors gracefully', async () => {
      // Try to save to a read-only directory (simulate permission error)
      if (process.platform !== 'win32') { // Skip on Windows due to different permission model
        const readOnlyBase = join(testBasePath, 'readonly');
        await fs.mkdir(readOnlyBase, { recursive: true });
        await fs.chmod(readOnlyBase, 0o444); // Read-only
        
        const saveResult = await saveWalletIdentity(
          testChainId,
          testOwnerAddress,
          testIdentity,
          readOnlyBase
        );
        
        expect(saveResult.success).toBe(false);
        if (!saveResult.success) {
          expect(saveResult.error).toBe('permission_denied');
        }
        
        // Clean up
        await fs.chmod(readOnlyBase, 0o755);
      }
    });

    it('should provide meaningful error messages', async () => {
      const loadResult = await loadWalletIdentity(
        testChainId,
        testOwnerAddress,
        '/nonexistent/path'
      );
      
      expect(loadResult.success).toBe(false);
      if (!loadResult.success) {
        expect(loadResult.message).toBeTruthy();
        expect(typeof loadResult.message).toBe('string');
      }
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent save operations safely', async () => {
      const walletPath = getWalletPath(testChainId, testOwnerAddress, testBasePath);
      
      // Use Promise.allSettled to handle both successful and failed operations
      const promises = Array.from({ length: 5 }, (_, i) => 
        withLock(walletPath, async () => 
          saveWalletIdentity(
            testChainId,
            testOwnerAddress,
            { ...testIdentity, createdAt: `2025-08-25T12:34:${i.toString().padStart(2, '0')}Z` },
            testBasePath
          )
        ).catch(error => ({ success: false, error: error.message }))
      );
      
      const results = await Promise.all(promises);
      
      // At least one operation should succeed (the first to acquire the lock)
      const successfulResults = results.filter(result => result.success);
      expect(successfulResults.length).toBeGreaterThanOrEqual(1);
      
      // All successful operations should have the correct result structure
      successfulResults.forEach(result => {
        expect(result.success).toBe(true);
      });
      
      // Verify final state is consistent
      const loadResult = await loadWalletIdentity(
        testChainId,
        testOwnerAddress,
        testBasePath
      );
      
      expect(loadResult.success).toBe(true);
      if (loadResult.success) {
        // Should have a valid createdAt timestamp from one of the operations
        expect(loadResult.data.createdAt).toMatch(/2025-08-25T12:34:\d{2}Z/);
      }
    });
  });
});
