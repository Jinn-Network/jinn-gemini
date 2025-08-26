/**
 * Storage layer for wallet identity persistence
 * 
 * This module handles the secure storage and retrieval of wallet identity data
 * in local JSON files with atomic write operations and file-based concurrency
 * control to prevent race conditions.
 */

import { promises as fs, constants } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import type { WalletIdentity } from './types.js';

/**
 * Default base path for wallet storage
 */
const DEFAULT_STORAGE_BASE = join(homedir(), '.jinn', 'wallets');

/**
 * Lock file suffix for concurrency control
 */
const LOCK_SUFFIX = '.lock';

/**
 * Temporary file suffix for atomic writes
 */
const TEMP_SUFFIX = '.tmp';

/**
 * File permissions for directories (owner read/write/execute only)
 */
const DIR_PERMISSIONS = 0o700;

/**
 * File permissions for wallet files (owner read/write only)
 */
const FILE_PERMISSIONS = 0o600;

/**
 * Storage error types
 */
export type StorageError = 
  | 'lock_acquisition_failed'
  | 'lock_already_held'
  | 'atomic_write_failed'
  | 'permission_denied'
  | 'file_not_found'
  | 'invalid_json'
  | 'filesystem_error'
  | 'directory_creation_failed';

/**
 * Storage operation result
 */
export type StorageResult<T> = 
  | { success: true; data: T }
  | { success: false; error: StorageError; message: string };

/**
 * Lock handle for cleanup
 */
export interface LockHandle {
  lockPath: string;
  acquired: boolean;
}

/**
 * Build the deterministic file path for a wallet identity
 */
export function getWalletPath(
  chainId: number, 
  ownerAddress: `0x${string}`, 
  basePath?: string
): string {
  const base = basePath || DEFAULT_STORAGE_BASE;
  return join(base, chainId.toString(), `${ownerAddress}.json`);
}

/**
 * Build the lock file path for a given wallet path
 */
export function getLockPath(walletPath: string): string {
  return `${walletPath}${LOCK_SUFFIX}`;
}

/**
 * Build the temporary file path for atomic writes
 * @deprecated Use generateUniqueTempPath instead for better concurrency safety
 */
export function getTempPath(walletPath: string): string {
  return `${walletPath}${TEMP_SUFFIX}`;
}

/**
 * Generate a unique temporary file path to prevent race conditions
 */
function generateUniqueTempPath(walletPath: string): string {
  const dir = dirname(walletPath);
  const filename = basename(walletPath);
  const uniqueSuffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return join(dir, `.${filename}.tmp.${uniqueSuffix}`);
}

/**
 * Ensure the directory structure exists with proper permissions
 */
async function ensureDirectory(dirPath: string): Promise<StorageResult<void>> {
  try {
    await fs.mkdir(dirPath, { recursive: true, mode: DIR_PERMISSIONS });
    
    // Ensure permissions are correct even if directory already existed
    await fs.chmod(dirPath, DIR_PERMISSIONS);
    
    return { success: true, data: undefined };
  } catch (error: any) {
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return {
        success: false,
        error: 'permission_denied',
        message: `Permission denied creating directory: ${dirPath}`
      };
    }
    
    return {
      success: false,
      error: 'filesystem_error',
      message: `Failed to create directory ${dirPath}: ${error.message}`
    };
  }
}

/**
 * Check if a process is still alive by sending signal 0
 */
async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    // process.kill(pid, 0) throws if the process doesn't exist
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error.code === 'ESRCH') {
      // No such process
      return false;
    }
    // EPERM means the process exists but we can't signal it
    return true;
  }
}

/**
 * Attempt to acquire a lock, with stale lock detection and cleanup
 */
async function tryAcquireLock(lockPath: string, walletPath: string): Promise<StorageResult<LockHandle>> {
  try {
    // Attempt atomic lock creation with exclusive write flag
    // This will fail if the file already exists, ensuring atomicity
    const handle = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, FILE_PERMISSIONS);
    
    // Write process info to lock file for debugging
    const lockInfo = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      walletPath
    };
    
    await handle.writeFile(JSON.stringify(lockInfo, null, 2));
    await handle.close();
    
    return {
      success: true,
      data: { lockPath, acquired: true }
    };
    
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      // Lock file exists - check if it's stale
      let isStale = false;
      
      try {
        const lockContent = await fs.readFile(lockPath, 'utf8');
        const lockInfo = JSON.parse(lockContent);
        const pid = lockInfo.pid;
        
        if (typeof pid === 'number' && pid > 0) {
          isStale = !(await isProcessAlive(pid));
        } else {
          // Invalid or missing PID - consider stale
          isStale = true;
        }
      } catch (readError: any) {
        if (readError.code === 'ENOENT') {
          // Lock file disappeared between EEXIST and read - try again
          return tryAcquireLock(lockPath, walletPath);
        } else if (readError instanceof SyntaxError) {
          // Corrupted lock file - consider stale
          isStale = true;
        }
        // Other read errors - assume lock is active
      }
      
      if (isStale) {
        try {
          await fs.unlink(lockPath);
          // Retry acquisition after cleaning up stale lock
          return tryAcquireLock(lockPath, walletPath);
        } catch (unlinkError: any) {
          if (unlinkError.code === 'ENOENT') {
            // Lock file disappeared - try again
            return tryAcquireLock(lockPath, walletPath);
          }
          // Failed to clean up stale lock
          return {
            success: false,
            error: 'lock_acquisition_failed',
            message: `Failed to clean up stale lock ${lockPath}: ${unlinkError.message}`
          };
        }
      }
      
      // Lock is active
      return {
        success: false,
        error: 'lock_already_held',
        message: `Lock file already exists: ${lockPath}`
      };
    }
    
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return {
        success: false,
        error: 'permission_denied',
        message: `Permission denied creating lock: ${lockPath}`
      };
    }
    
    return {
      success: false,
      error: 'lock_acquisition_failed',
      message: `Failed to acquire lock ${lockPath}: ${error.message}`
    };
  }
}

/**
 * Acquire a file-based lock using atomic flag creation
 * 
 * Uses the `wx` flag to ensure atomic lock acquisition - the operation
 * will fail if the lock file already exists, preventing race conditions.
 * Includes stale lock detection and cleanup for crashed processes.
 */
export async function acquireLock(walletPath: string): Promise<StorageResult<LockHandle>> {
  const lockPath = getLockPath(walletPath);
  
  // Ensure the directory exists before attempting to create the lock
  const dirResult = await ensureDirectory(dirname(lockPath));
  if (!dirResult.success) {
    return { 
      success: false, 
      error: 'directory_creation_failed', 
      message: `Failed to create directory for lock: ${lockPath}` 
    };
  }
  
  return tryAcquireLock(lockPath, walletPath);
}

/**
 * Release a file-based lock by removing the lock file
 */
export async function releaseLock(lockHandle: LockHandle): Promise<StorageResult<void>> {
  if (!lockHandle.acquired) {
    return { success: true, data: undefined };
  }
  
  try {
    await fs.unlink(lockHandle.lockPath);
    lockHandle.acquired = false;
    
    return { success: true, data: undefined };
  } catch (error: any) {
    // If the file doesn't exist, consider it successfully released
    if (error.code === 'ENOENT') {
      lockHandle.acquired = false;
      return { success: true, data: undefined };
    }
    
    return {
      success: false,
      error: 'filesystem_error',
      message: `Failed to release lock ${lockHandle.lockPath}: ${error.message}`
    };
  }
}

/**
 * Save wallet identity using atomic write operation
 * 
 * Writes to a temporary file first, then atomically renames it to the
 * target location to prevent corruption from partial writes.
 * Uses unique temporary filenames to prevent race conditions.
 */
export async function saveWalletIdentity(
  chainId: number,
  ownerAddress: `0x${string}`,
  identity: WalletIdentity,
  basePath?: string
): Promise<StorageResult<void>> {
  const walletPath = getWalletPath(chainId, ownerAddress, basePath);
  const tempPath = generateUniqueTempPath(walletPath);
  
  try {
    // Ensure directory exists with proper permissions
    const dirResult = await ensureDirectory(dirname(walletPath));
    if (!dirResult.success) {
      return dirResult;
    }
    
    // Write to temporary file first with proper permissions
    const jsonContent = JSON.stringify(identity, null, 2);
    await fs.writeFile(tempPath, jsonContent, { mode: FILE_PERMISSIONS });
    
    // Atomic rename - this is the critical operation that ensures consistency
    await fs.rename(tempPath, walletPath);
    
    // Attempt to ensure final file has correct permissions
    // This is a safeguard - failure here should not fail the entire operation
    // since the atomic write has already succeeded
    try {
      await fs.chmod(walletPath, FILE_PERMISSIONS);
    } catch (chmodError: any) {
      // Log as warning but don't fail the operation
      console.warn(`Could not set permissions on ${walletPath}:`, chmodError.message);
    }
    
    return { success: true, data: undefined };
    
  } catch (error: any) {
    // Clean up temporary file if it was created
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return {
        success: false,
        error: 'permission_denied',
        message: `Permission denied writing wallet file: ${walletPath}`
      };
    }
    
    return {
      success: false,
      error: 'atomic_write_failed',
      message: `Failed to save wallet identity: ${error.message}`
    };
  }
}

/**
 * Load wallet identity from storage
 */
export async function loadWalletIdentity(
  chainId: number,
  ownerAddress: `0x${string}`,
  basePath?: string
): Promise<StorageResult<WalletIdentity>> {
  const walletPath = getWalletPath(chainId, ownerAddress, basePath);
  
  try {
    const jsonContent = await fs.readFile(walletPath, 'utf8');
    const identity = JSON.parse(jsonContent) as WalletIdentity;
    
    // Basic validation of loaded identity
    if (!identity.ownerAddress || !identity.safeAddress || !identity.chainId || !identity.saltNonce) {
      return {
        success: false,
        error: 'invalid_json',
        message: `Invalid wallet identity structure in ${walletPath}`
      };
    }
    
    // Verify the identity matches the requested parameters
    if (identity.chainId !== chainId || identity.ownerAddress !== ownerAddress) {
      return {
        success: false,
        error: 'invalid_json',
        message: `Wallet identity mismatch: expected chainId=${chainId}, ownerAddress=${ownerAddress}`
      };
    }
    
    return { success: true, data: identity };
    
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return {
        success: false,
        error: 'file_not_found',
        message: `Wallet identity file not found: ${walletPath}`
      };
    }
    
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return {
        success: false,
        error: 'permission_denied',
        message: `Permission denied reading wallet file: ${walletPath}`
      };
    }
    
    if (error instanceof SyntaxError) {
      return {
        success: false,
        error: 'invalid_json',
        message: `Invalid JSON in wallet file: ${walletPath}`
      };
    }
    
    return {
      success: false,
      error: 'filesystem_error',
      message: `Failed to load wallet identity: ${error.message}`
    };
  }
}

/**
 * Check if a wallet identity file exists
 */
export async function walletExists(
  chainId: number,
  ownerAddress: `0x${string}`,
  basePath?: string
): Promise<boolean> {
  const walletPath = getWalletPath(chainId, ownerAddress, basePath);
  
  try {
    await fs.access(walletPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Retry configuration for withLock
 */
const LOCK_RETRY_CONFIG = {
  MAX_RETRIES: 10, // Increased from 5
  BASE_DELAY_MS: 100, // Increased from 50
  MAX_DELAY_MS: 2000, // Cap maximum delay at 2 seconds
} as const;

/**
 * Calculate delay with exponential backoff and jitter, capped at maximum
 */
function calculateRetryDelay(attempt: number): number {
  const exponentialDelay = LOCK_RETRY_CONFIG.BASE_DELAY_MS * (2 ** attempt);
  const cappedDelay = Math.min(exponentialDelay, LOCK_RETRY_CONFIG.MAX_DELAY_MS);
  const jitter = Math.random() * LOCK_RETRY_CONFIG.BASE_DELAY_MS;
  return cappedDelay + jitter;
}

/**
 * Helper function to execute an operation with automatic lock management
 * 
 * Acquires a lock, executes the operation, and ensures the lock is released
 * in the finally block to prevent deadlocks. Includes retry mechanism with
 * exponential backoff for improved resilience under contention.
 */
export async function withLock<T>(
  walletPath: string,
  operation: () => Promise<T>
): Promise<T> {
  let lastError: StorageError | string = '';
  
  for (let attempt = 0; attempt < LOCK_RETRY_CONFIG.MAX_RETRIES; attempt++) {
    const lockResult = await acquireLock(walletPath);
    
    if (lockResult.success) {
      const lockHandle = lockResult.data;
      
      try {
        return await operation();
      } finally {
        await releaseLock(lockHandle);
      }
    }
    
    // Store the error for potential throwing (we know lockResult.success is false here)
    if (!lockResult.success) {
      const failedResult = lockResult as { success: false; error: StorageError; message: string };
      lastError = failedResult.error;
      
      // If it's not a contention error, or this is the final attempt, don't retry
      if (failedResult.error !== 'lock_already_held' || attempt === LOCK_RETRY_CONFIG.MAX_RETRIES - 1) {
        break;
      }
    }
    
    // Wait before retrying with exponential backoff and jitter
    const delay = calculateRetryDelay(attempt);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  // All retries exhausted
  throw new Error(`Failed to acquire lock after ${LOCK_RETRY_CONFIG.MAX_RETRIES} attempts: ${lastError}`);
}
