/**
 * Acceptance Criteria D: Security
 * 
 * Tests to verify that private keys are not persisted and file permissions 
 * are secure. These are network-independent tests focused on local security.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { WalletManager } from '../index.js';
import { loadWalletIdentity } from '../storage.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('Acceptance Criteria D: Security', () => {
  const testPrivateKey = process.env.WORKER_PRIVATE_KEY as `0x${string}`;
  const tenderly_rpc_url = process.env.TENDERLY_RPC_URL as string;
  const chainId = 8453; // Base mainnet
  
  // Use unique storage path for test isolation
  const testStorageBasePath = join(homedir(), '.jinn-test', `wallets-test-d-${Date.now()}`);
  
  let walletManager: WalletManager;

  beforeAll(() => {
    if (!testPrivateKey) {
      throw new Error('WORKER_PRIVATE_KEY environment variable is required');
    }
    if (!tenderly_rpc_url) {
      throw new Error('TENDERLY_RPC_URL environment variable is required');
    }

    walletManager = new WalletManager({
      workerPrivateKey: testPrivateKey,
      chainId,
      rpcUrl: tenderly_rpc_url,
      options: {
        storageBasePath: testStorageBasePath
      }
    });
  });

  afterAll(async () => {
    // Clean up test storage directory
    try {
      await fs.rm(testStorageBasePath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Private Key Security', () => {
    test('Private key is not persisted to wallet.json file', async () => {
      // Run bootstrap to create wallet identity file
      const result = await walletManager.bootstrap();
      
      // Verify bootstrap succeeded (either created or exists)
      expect(['created', 'exists']).toContain(result.status);
      
      if (result.status === 'created' || result.status === 'exists') {
        const { identity } = result;
        
        // Read the wallet.json file contents
        const walletPath = join(testStorageBasePath, chainId.toString(), `${identity.ownerAddress}.json`);
        const walletFileContent = await fs.readFile(walletPath, 'utf8');
        
        // Parse the JSON content
        const walletData = JSON.parse(walletFileContent);
        
        // Assert private key is NOT in the file content
        expect(walletFileContent).not.toContain(testPrivateKey);
        expect(walletFileContent).not.toContain(testPrivateKey.slice(2)); // Without 0x prefix
        
        // Assert private key is not in any field of the parsed JSON
        expect(walletData.workerPrivateKey).toBeUndefined();
        expect(walletData.privateKey).toBeUndefined();
        expect(walletData.key).toBeUndefined();
        
        // Verify only expected public fields are present
        expect(walletData).toHaveProperty('ownerAddress');
        expect(walletData).toHaveProperty('safeAddress');
        expect(walletData).toHaveProperty('chainId');
        expect(walletData).toHaveProperty('createdAt');
        expect(walletData).toHaveProperty('saltNonce');
        
        // Verify no unexpected fields that could contain sensitive data
        const allowedFields = ['ownerAddress', 'safeAddress', 'chainId', 'createdAt', 'saltNonce'];
        const actualFields = Object.keys(walletData);
        const unexpectedFields = actualFields.filter(field => !allowedFields.includes(field));
        expect(unexpectedFields).toHaveLength(0);
      }
    }, 30000);

    test('Private key is not persisted in any storage operation result', async () => {
      // Run bootstrap to ensure identity exists
      const result = await walletManager.bootstrap();
      expect(['created', 'exists']).toContain(result.status);
      
      if (result.status === 'created' || result.status === 'exists') {
        const { identity } = result;
        
        // Load the identity using storage function
        const loadResult = await loadWalletIdentity(
          chainId,
          identity.ownerAddress,
          testStorageBasePath
        );
        
        expect(loadResult.success).toBe(true);
        
        if (loadResult.success) {
          const loadedIdentity = loadResult.data;
          
          // Convert to string to check for private key
          const identityString = JSON.stringify(loadedIdentity);
          
          // Assert private key is not in the loaded identity
          expect(identityString).not.toContain(testPrivateKey);
          expect(identityString).not.toContain(testPrivateKey.slice(2));
          
          // Verify the loaded identity structure doesn't have private key fields
          expect((loadedIdentity as any).workerPrivateKey).toBeUndefined();
          expect((loadedIdentity as any).privateKey).toBeUndefined();
          expect((loadedIdentity as any).key).toBeUndefined();
        }
      }
    }, 15000);
  });

  describe('File System Permissions', () => {
    test('Wallet directory has correct permissions (0700)', async () => {
      // Run bootstrap to create wallet directory
      const result = await walletManager.bootstrap();
      expect(['created', 'exists']).toContain(result.status);
      
      if (result.status === 'created' || result.status === 'exists') {
        const { identity } = result;
        
        // Check the chain-specific directory permissions
        const chainDir = join(testStorageBasePath, chainId.toString());
        const dirStats = await fs.stat(chainDir);
        
        // Extract permission bits (last 3 octal digits)
        const permissions = dirStats.mode & 0o777;
        
        // Assert directory has 0700 permissions (owner read/write/execute only)
        expect(permissions).toBe(0o700);
        
        // Also check the parent directory permissions
        const parentDirStats = await fs.stat(testStorageBasePath);
        const parentPermissions = parentDirStats.mode & 0o777;
        expect(parentPermissions).toBe(0o700);
      }
    }, 15000);

    test('Wallet file has correct permissions (0600)', async () => {
      // Run bootstrap to create wallet file
      const result = await walletManager.bootstrap();
      expect(['created', 'exists']).toContain(result.status);
      
      if (result.status === 'created' || result.status === 'exists') {
        const { identity } = result;
        
        // Check the wallet file permissions
        const walletPath = join(testStorageBasePath, chainId.toString(), `${identity.ownerAddress}.json`);
        const fileStats = await fs.stat(walletPath);
        
        // Extract permission bits (last 3 octal digits)
        const permissions = fileStats.mode & 0o777;
        
        // Assert file has 0600 permissions (owner read/write only)
        expect(permissions).toBe(0o600);
      }
    }, 15000);

    test('No sensitive data in file system beyond wallet directory', async () => {
      // Run bootstrap to create files
      const result = await walletManager.bootstrap();
      expect(['created', 'exists']).toContain(result.status);
      
      // Check that no private key data exists in any temp files or logs
      // This is a best-effort check for any accidentally created files
      const baseDir = testStorageBasePath;
      
      async function searchForPrivateKeyInDir(dir: string): Promise<string[]> {
        const foundFiles: string[] = [];
        
        try {
          const items = await fs.readdir(dir, { withFileTypes: true });
          
          for (const item of items) {
            const fullPath = join(dir, item.name);
            
            if (item.isDirectory()) {
              // Recursively search subdirectories
              const subResults = await searchForPrivateKeyInDir(fullPath);
              foundFiles.push(...subResults);
            } else if (item.isFile()) {
              try {
                // Skip binary files by checking common extensions
                if (item.name.endsWith('.json') || item.name.endsWith('.txt') || item.name.endsWith('.log')) {
                  const content = await fs.readFile(fullPath, 'utf8');
                  if (content.includes(testPrivateKey) || content.includes(testPrivateKey.slice(2))) {
                    foundFiles.push(fullPath);
                  }
                }
              } catch (readError) {
                // Skip files we can't read
              }
            }
          }
        } catch (dirError) {
          // Skip directories we can't read
        }
        
        return foundFiles;
      }
      
      const filesWithPrivateKey = await searchForPrivateKeyInDir(baseDir);
      
      // Assert no files contain the private key
      expect(filesWithPrivateKey).toHaveLength(0);
      
      if (filesWithPrivateKey.length > 0) {
        console.error('Private key found in files:', filesWithPrivateKey);
      }
    }, 20000);
  });

  describe('Memory Security', () => {
    test('Private key is not exposed in error messages', async () => {
      // Test with invalid configuration to trigger errors
      const invalidManager = new WalletManager({
        workerPrivateKey: testPrivateKey,
        chainId: 99999, // Unsupported chain
        rpcUrl: 'https://invalid-rpc-url.example.com',
        options: {
          storageBasePath: testStorageBasePath
        }
      });

      const result = await invalidManager.bootstrap();
      
      expect(result.status).toBe('failed');
      
      if (result.status === 'failed') {
        // Assert private key is not in error message
        expect(result.error).not.toContain(testPrivateKey);
        expect(result.error).not.toContain(testPrivateKey.slice(2));
        
        // Assert the error is still meaningful
        expect(result.error).toBeTruthy();
        expect(result.error.length).toBeGreaterThan(0);
      }
    }, 10000);
  });
});
