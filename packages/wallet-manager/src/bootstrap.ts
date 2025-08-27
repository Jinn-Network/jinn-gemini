/**
 * Core wallet bootstrap logic for Gnosis Safe deployment and identity management.
 * 
 * This module implements the "find-or-create" bootstrap process that ensures each
 * worker has a deterministically generated 1-of-1 Gnosis Safe wallet. The process
 * is idempotent and includes comprehensive pre-flight checks and error handling.
 */

import { 
  createPublicClient, 
  http, 
  keccak256,
  encodePacked,
  parseUnits
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import Safe, { PredictedSafeProps, SafeAccountConfig } from '@safe-global/protocol-kit';
import { getChainConfig, SAFE_VERSION } from './chains.js';
import { 
  loadWalletIdentity, 
  saveWalletIdentity, 
  getWalletPath,
  withLock,
  type StorageError,
  type StorageResult
} from './storage.js';
import type { 
  WalletManagerConfig, 
  BootstrapResult, 
  WalletIdentity, 
  BootstrapOptions,
  DryRunReport,
  NeedsFundingResult
} from './types.js';

/**
 * Helper function to access error message from failed StorageResult
 */
function getStorageErrorMessage(result: StorageResult<any>): string {
  if (result.success) {
    throw new Error('Cannot get error message from successful result');
  }
  return (result as { success: false; error: StorageError; message: string }).message;
}

/**
 * Helper function to access error code from failed StorageResult
 */
function getStorageErrorCode(result: StorageResult<any>): StorageError {
  if (result.success) {
    throw new Error('Cannot get error code from successful result');
  }
  return (result as { success: false; error: StorageError; message: string }).error;
}

/**
 * Minimal Safe ABI for verification operations
 */
export const SAFE_ABI = [
  {
    "constant": true,
    "inputs": [],
    "name": "getOwners",
    "outputs": [{ "name": "", "type": "address[]" }],
    "payable": false, 
    "stateMutability": "view", 
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "getThreshold",
    "outputs": [{ "name": "", "type": "uint256" }],
    "payable": false, 
    "stateMutability": "view", 
    "type": "function"
  }
] as const;

/**
 * On-chain Safe verification states for internal use
 */
type OnChainSafeState = 'NOT_DEPLOYED' | 'VALID_DEPLOYED' | 'INVALID_CONFIG';

/**
 * On-chain Safe state information for the new helper function contract
 */
type OnChainSafeStateInfo = {
  exists: boolean;
  owners?: `0x${string}`[];
  threshold?: number;
};

/**
 * Default deployment configuration for Gnosis Safe
 */
const DEFAULT_SAFE_CONFIG: Omit<SafeAccountConfig, 'owners'> = {
  threshold: 1,
};

/**
 * Checks the on-chain state of a predicted Safe address.
 * Helper function contract as specified in Phase 1 requirements.
 * 
 * @param predictedAddress - The predicted Safe address to check
 * @returns An object describing the on-chain state
 */
async function getOnChainSafeStateInfo(
  publicClient: any,
  predictedAddress: `0x${string}`
): Promise<OnChainSafeStateInfo> {
  try {
    // First check if code exists at the Safe address (indicates deployment)
    const code = await publicClient.getBytecode({ address: predictedAddress });
    if (!code || code === '0x') {
      return { exists: false };
    }
    
    // Verify Safe configuration by checking owners and threshold
    const [owners, threshold] = await Promise.all([
      publicClient.readContract({
        address: predictedAddress,
        abi: SAFE_ABI,
        functionName: 'getOwners',
        args: []
      } as any),
      publicClient.readContract({
        address: predictedAddress,
        abi: SAFE_ABI,
        functionName: 'getThreshold',
        args: []
      } as any)
    ]);
    
    return {
      exists: true,
      owners: owners as `0x${string}`[],
      threshold: Number(threshold)
    };
    
  } catch (error: any) {
    console.warn(`Failed to verify Safe on-chain at ${predictedAddress}: ${error.message}`);
    // If we can't verify, assume it doesn't exist
    return { exists: false };
  }
}

/**
 * Estimates deployment cost and checks if the owner EOA is funded.
 * Helper function contract as specified in Phase 1 requirements.
 * 
 * @returns An object describing the funding status and requirements
 */
async function checkFundingStatus(
  publicClient: any,
  config: WalletManagerConfig,
  ownerAddress: `0x${string}`,
  saltNonce: `0x${string}`
): Promise<{
  isFunded: boolean;
  required: NeedsFundingResult['required'];
  estimatedCostWei: bigint;
}> {
  // Estimate gas for Safe deployment
  const gasEstimate = await estimateSafeDeploymentGas(publicClient, config, ownerAddress, saltNonce);
  
  // Get current gas prices
  const feeData = await publicClient.estimateFeesPerGas();
  
  // Calculate total required ETH (gas limit * max fee per gas)
  const maxFeePerGas = feeData.maxFeePerGas || parseUnits('20', 9); // 20 gwei fallback
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || parseUnits('2', 9); // 2 gwei fallback
  
  const estimatedCostWei = gasEstimate * maxFeePerGas;
  const minRecommendedWei = (estimatedCostWei * 15n) / 10n; // 1.5x margin using BigInt
  
  const required: NeedsFundingResult['required'] = {
    gasLimit: gasEstimate,
    maxFeePerGas,
    maxPriorityFeePerGas,
    minRecommendedWei
  };
  
  // Check current balance
  const currentBalance = await publicClient.getBalance({ address: ownerAddress });
  
  return {
    isFunded: currentBalance >= minRecommendedWei,
    required,
    estimatedCostWei
  };
}

/**
 * Bootstrap a Gnosis Safe wallet for the configured EOA.
 * 
 * This is the main entry point for wallet provisioning. It implements a
 * comprehensive "find-or-create" process that is idempotent and safe from
 * concurrency issues.
 * 
 * @param config - Wallet manager configuration
 * @param options - Bootstrap options including dry run mode
 * @returns Bootstrap result indicating success, failure, or funding needs
 */
export async function bootstrap(
  config: WalletManagerConfig,
  options: BootstrapOptions = {}
): Promise<BootstrapResult> {
  const startTime = Date.now();
  const { dryRun = false } = options;
  
  try {
    // Validate configuration and set up clients
    const { publicClient, account } = await setupClients(config);
    
    // Derive the owner address from the private key
    const ownerAddress = account.address as `0x${string}`;
    
    // Generate deterministic salt nonce for prediction
    const saltNonce = generateDeterministicSaltNonce(ownerAddress, config.chainId);
    
    // Predict the Safe address
    const predictedSafeAddress = await predictSafeAddress(config, ownerAddress, saltNonce);
    
    // --- Dry Run Pre-computation ---
    // All necessary read-only data should be gathered here.
    const onChainState = await getOnChainSafeStateInfo(publicClient, predictedSafeAddress);
    const { isFunded, required, estimatedCostWei } = await checkFundingStatus(publicClient, config, ownerAddress, saltNonce);

    if (dryRun) {
      const report: DryRunReport = {
        ownerAddress,
        predictedSafeAddress,
        onChainState: onChainState.exists
          ? onChainState.owners?.length === 1 && onChainState.threshold === 1
            ? 'exists_valid'
            : 'exists_invalid_config'
          : 'not_deployed',
        isFunded,
        ...(isFunded ? {} : { requiredFundingWei: required.minRecommendedWei }),
        estimatedDeploymentCostWei: estimatedCostWei,
        actions: []
      };

      // Determine what actions would be taken
      if (!onChainState.exists) {
        if (isFunded) {
          report.actions.push({
            type: 'DEPLOY_SAFE',
            details: `Deploy new 1-of-1 Gnosis Safe to ${predictedSafeAddress}`
          });
          report.actions.push({
            type: 'WRITE_IDENTITY_FILE',
            details: `Save identity to ~/.jinn/wallets/${config.chainId}/${ownerAddress}.json`
          });
        } else {
          report.actions.push({
            type: 'DEPLOY_SAFE',
            details: `Deploy new 1-of-1 Gnosis Safe to ${predictedSafeAddress} (pending funding)`
          });
        }
      } else if (onChainState.owners?.length === 1 && onChainState.threshold === 1) {
        // Explicit adoption action for clarity
        report.actions.push({
          type: 'DEPLOY_SAFE', // Using same type but with adoption semantics
          details: `Adopt existing 1-of-1 Gnosis Safe at ${predictedSafeAddress}`
        });
        report.actions.push({
          type: 'WRITE_IDENTITY_FILE',
          details: `Save existing Safe identity to ~/.jinn/wallets/${config.chainId}/${ownerAddress}.json`
        });
      }

      return { status: 'dry_run', report };
    }

    // Get the wallet file path for locking
    const walletPath = getWalletPath(config.chainId, ownerAddress, config.options?.storageBasePath);
    
    // Execute bootstrap process with file-based locking to prevent race conditions
    return await withLock(walletPath, async () => {
      // Phase 1: Check if identity already exists locally
      const existingIdentity = await checkExistingIdentity(config.chainId, ownerAddress, config.options?.storageBasePath);
      if (existingIdentity) {
        // Verify the existing Safe on-chain
        const isValid = await verifySafeOnChain(publicClient, existingIdentity);
        if (isValid) {
          return {
            status: 'exists' as const,
            identity: existingIdentity,
            metrics: {
              durationMs: Date.now() - startTime
            }
          };
        }
        
        // Log warning about invalid existing identity but continue with fresh deployment
        console.warn(`Local identity file points to an invalid on-chain Safe. Re-evaluating state to determine next steps.`);
      }
      
      // Phase 2: Re-fetch on-chain state and funding after acquiring lock
      // This ensures we have fresh data for decision making, preventing race conditions
      const freshOnChainState = await getOnChainSafeStateInfo(publicClient, predictedSafeAddress);
      const freshFundingStatus = await checkFundingStatus(publicClient, config, ownerAddress, saltNonce);
      
      // Phase 3: Check on-chain state first (blockchain is source of truth)
      // Convert the fresh state info to the legacy format for compatibility
      const onChainStateFormatted = !freshOnChainState.exists 
        ? 'NOT_DEPLOYED' as const
        : freshOnChainState.owners?.length === 1 && 
          freshOnChainState.owners[0].toLowerCase() === ownerAddress.toLowerCase() && 
          freshOnChainState.threshold === 1
          ? 'VALID_DEPLOYED' as const
          : 'INVALID_CONFIG' as const;
      
      if (onChainStateFormatted === 'VALID_DEPLOYED') {
        // Safe already exists with correct configuration - adopt it
        const identity: WalletIdentity = {
          ownerAddress,
          safeAddress: predictedSafeAddress,
          chainId: config.chainId,
          createdAt: new Date().toISOString(),
          saltNonce
        };
        
        const saveResult = await saveWalletIdentity(
          config.chainId,
          ownerAddress,
          identity,
          config.options?.storageBasePath
        );
        
        if (!saveResult.success) {
          return {
            status: 'failed' as const,
            error: `Failed to save wallet identity: ${getStorageErrorMessage(saveResult)}`,
            code: 'deployment_failed' as const
          };
        }
        
        return {
          status: 'exists' as const,
          identity,
          metrics: {
            durationMs: Date.now() - startTime
          }
        };
      } else if (onChainStateFormatted === 'INVALID_CONFIG') {
        // Safe exists but has wrong configuration
        return {
          status: 'failed' as const,
          error: `Safe at ${predictedSafeAddress} exists but has incorrect configuration (wrong owners or threshold)`,
          code: 'safe_config_mismatch' as const
        };
      }
      
      // Safe is not deployed on-chain, check Transaction Service as advisory
      const txServiceExists = await checkSafeInTransactionService(config, predictedSafeAddress);
      if (txServiceExists.exists && txServiceExists.configValid) {
        // Double-check on-chain state in case service is stale
        const reCheckState = await getOnChainSafeState(publicClient, predictedSafeAddress, ownerAddress);
        if (reCheckState === 'VALID_DEPLOYED') {
          // Service was correct, adopt the Safe
          const identity: WalletIdentity = {
            ownerAddress,
            safeAddress: predictedSafeAddress,
            chainId: config.chainId,
            createdAt: new Date().toISOString(),
            saltNonce
          };
          
          const saveResult = await saveWalletIdentity(
            config.chainId,
            ownerAddress,
            identity,
            config.options?.storageBasePath
          );
          
          if (!saveResult.success) {
            return {
              status: 'failed' as const,
              error: `Failed to save wallet identity: ${getStorageErrorMessage(saveResult)}`,
              code: 'deployment_failed' as const
            };
          }
          
          return {
            status: 'exists' as const,
            identity,
            metrics: {
              durationMs: Date.now() - startTime
            }
          };
        }
      }
      
      // Phase 4: Check funding using fresh values from inside the lock
      if (!freshFundingStatus.isFunded) {
        return {
          status: 'needs_funding' as const,
          address: ownerAddress,
          required: freshFundingStatus.required
        };
      }
      
      // Phase 5: Deploy the Safe
      const deploymentResult = await deploySafe(
        config, 
        publicClient,
        ownerAddress, 
        saltNonce
      );
      
      if (deploymentResult.status === 'failed') {
        return deploymentResult;
      }
      
      // Phase 5: Save identity and return success
      const identity: WalletIdentity = {
        ownerAddress,
        safeAddress: deploymentResult.safeAddress,
        chainId: config.chainId,
        createdAt: new Date().toISOString(),
        saltNonce
      };
      
      const saveResult = await saveWalletIdentity(
        config.chainId,
        ownerAddress,
        identity,
        config.options?.storageBasePath
      );
      
      if (!saveResult.success) {
        return {
          status: 'failed' as const,
          error: `Failed to save wallet identity: ${getStorageErrorMessage(saveResult)}`,
          code: 'deployment_failed' as const
        };
      }
      
      return {
        status: 'created' as const,
        identity,
        metrics: {
          gasUsed: deploymentResult.gasUsed,
          txHash: deploymentResult.txHash,
          durationMs: Date.now() - startTime
        }
      };
    });
    
  } catch (error: any) {
    let code: import('./types.js').BootstrapError = 'deployment_failed';
    const message: string = error.message || 'Unknown error during bootstrap';
    
    if (message.includes('Unsupported CHAIN_ID')) {
      code = 'unsupported_chain';
    } else if (message.includes('RPC validation failed')) {
      code = 'rpc_error';
    } else if (message.includes('Chain ID mismatch')) {
      code = 'chain_id_mismatch';
    } else if (message.includes('workerPrivateKey') || message.includes('private key')) {
      code = 'invalid_config';
    }
    
    return {
      status: 'failed' as const,
      error: message,
      code: code,
    };
  }
}

/**
 * Set up Viem clients and validate configuration
 */
export async function setupClients(config: WalletManagerConfig) {
  // Validate private key format
  if (!config.workerPrivateKey || !config.workerPrivateKey.startsWith('0x') || config.workerPrivateKey.length !== 66) {
    throw new Error('Invalid workerPrivateKey: must be a 64-character hexadecimal string with 0x prefix');
  }
  
  // Validate chain support
  const chainConfig = getChainConfig(config.chainId);
  
  // Create Viem account from private key
  let account;
  try {
    account = privateKeyToAccount(config.workerPrivateKey);
  } catch (error: any) {
    throw new Error(`Invalid workerPrivateKey format: ${error.message}`);
  }
  
  // Create public client for reading blockchain state
  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(config.rpcUrl)
  });
  
  // Verify chain ID matches RPC endpoint
  try {
    const actualChainId = await publicClient.getChainId();
    if (actualChainId !== config.chainId) {
      throw new Error(
        `Chain ID mismatch: expected ${config.chainId}, got ${actualChainId} from RPC ${config.rpcUrl}`
      );
    }
  } catch (error: any) {
    if (error.message.includes('Chain ID mismatch')) {
      // Re-throw chain ID mismatch errors as-is for proper categorization
      throw error;
    }
    throw new Error(`RPC validation failed: ${error.message}`);
  }
  
  return { publicClient, account, chainConfig };
}

/**
 * Check if wallet identity already exists and is valid
 */
async function checkExistingIdentity(
  chainId: number, 
  ownerAddress: `0x${string}`, 
  basePath?: string
): Promise<WalletIdentity | null> {
  const loadResult = await loadWalletIdentity(chainId, ownerAddress, basePath);
  
  if (loadResult.success) {
    return loadResult.data;
  }
  
  // Identity doesn't exist or is invalid
  if (!loadResult.success) {
    if (getStorageErrorCode(loadResult) === 'file_not_found') {
      return null;
    }
    // Log other errors but don't fail the bootstrap
    console.warn(`Failed to load existing identity: ${getStorageErrorMessage(loadResult)}`);
  }
  return null;
}

/**
 * Get the on-chain state of a Safe at the predicted address
 */
async function getOnChainSafeState(
  publicClient: any,
  predictedAddress: `0x${string}`,
  expectedOwnerAddress: `0x${string}`
): Promise<OnChainSafeState> {
  try {
    // First check if code exists at the Safe address (indicates deployment)
    const code = await publicClient.getBytecode({ address: predictedAddress });
    if (!code || code === '0x') {
      return 'NOT_DEPLOYED';
    }
    
    // Verify Safe configuration by checking owners and threshold
    const [owners, threshold] = await Promise.all([
      publicClient.readContract({
        address: predictedAddress,
        abi: SAFE_ABI,
        functionName: 'getOwners',
        args: []
      } as any),
      publicClient.readContract({
        address: predictedAddress,
        abi: SAFE_ABI,
        functionName: 'getThreshold',
        args: []
      } as any)
    ]);
    
    const isOwnerCorrect = owners.length === 1 && owners[0].toLowerCase() === expectedOwnerAddress.toLowerCase();
    const isThresholdCorrect = threshold === 1n;
    
    if (isOwnerCorrect && isThresholdCorrect) {
      return 'VALID_DEPLOYED';
    } else {
      console.warn(`On-chain Safe config mismatch at ${predictedAddress}. Expected: owner=${expectedOwnerAddress}, threshold=1. Found: owners=[${owners.join(', ')}], threshold=${threshold}`);
      return 'INVALID_CONFIG';
    }
    
  } catch (error: any) {
    console.warn(`Failed to verify Safe on-chain at ${predictedAddress}: ${error.message}`);
    // If we can't verify, assume it's not deployed to allow deployment attempt
    return 'NOT_DEPLOYED';
  }
}

/**
 * Verify that a Safe exists on-chain and has the correct configuration
 */
async function verifySafeOnChain(
  publicClient: any, 
  identity: WalletIdentity
): Promise<boolean> {
  const state = await getOnChainSafeState(publicClient, identity.safeAddress, identity.ownerAddress);
  return state === 'VALID_DEPLOYED';
}

/**
 * Generate deterministic salt nonce from owner address and chain ID
 */
function generateDeterministicSaltNonce(
  ownerAddress: `0x${string}`, 
  chainId: number
): `0x${string}` {
  // Pack ownerAddress (20 bytes) and chainId (32 bytes) and hash
  const packed = encodePacked(
    ['address', 'uint256'],
    [ownerAddress, BigInt(chainId)]
  );
  
  return keccak256(packed);
}


/**
 * Estimate gas required for Safe deployment using dynamic on-chain estimation
 */
async function estimateSafeDeploymentGas(
  publicClient: any,
  config: WalletManagerConfig,
  ownerAddress: `0x${string}`,
  saltNonce: `0x${string}`
): Promise<bigint> {
  try {
    // Create Safe account configuration
    const safeAccountConfig: SafeAccountConfig = {
      ...DEFAULT_SAFE_CONFIG,
      owners: [ownerAddress]
    };
    
    // Create predicted Safe properties  
    const predictedSafe: PredictedSafeProps = {
      safeAccountConfig,
      safeDeploymentConfig: {
        saltNonce,
        safeVersion: SAFE_VERSION
      }
    };
    
    // Initialize Safe with predicted properties to get deployment transaction
    const protocolKit = await Safe.init({
      provider: config.rpcUrl,
      signer: config.workerPrivateKey,
      predictedSafe
    });
    
    // Create the deployment transaction
    const deploymentTransaction = await protocolKit.createSafeDeploymentTransaction();
    
    // Estimate gas using the actual deployment transaction
    const gasEstimate = await publicClient.estimateGas({
      to: deploymentTransaction.to as `0x${string}`,
      value: BigInt(deploymentTransaction.value),
      data: deploymentTransaction.data as `0x${string}`,
      account: ownerAddress
    });
    
    // Apply 20% safety margin
    return (gasEstimate * 12n) / 10n;
    
  } catch (error: any) {
    // Fallback to a conservative estimate if dynamic estimation fails
    console.warn(`Dynamic gas estimation failed, using fallback: ${error.message}`);
    return 600000n; // Conservative fallback
  }
}

/**
 * Deploy a new Gnosis Safe with the specified configuration
 */
async function deploySafe(
  config: WalletManagerConfig,
  publicClient: any,
  ownerAddress: `0x${string}`,
  saltNonce: `0x${string}`
): Promise<{ status: 'success'; safeAddress: `0x${string}`; gasUsed: bigint; txHash: `0x${string}` } | { status: 'failed'; error: string; code: import('./types.js').BootstrapError }> {
  try {
    // Create Safe account configuration
    const safeAccountConfig: SafeAccountConfig = {
      ...DEFAULT_SAFE_CONFIG,
      owners: [ownerAddress]
    };
    
    // Create predicted Safe properties  
    const predictedSafe: PredictedSafeProps = {
      safeAccountConfig,
      safeDeploymentConfig: {
        saltNonce,
        safeVersion: SAFE_VERSION
      }
    };
    
    console.log(`[PHASE 4] Safe deployment configuration:`, {
      owners: safeAccountConfig.owners,
      threshold: safeAccountConfig.threshold,
      saltNonce,
      chainId: config.chainId,
      safeVersion: SAFE_VERSION
    });
    
    // Initialize Safe with predicted properties
    let protocolKit = await Safe.init({
      provider: config.rpcUrl,
      signer: config.workerPrivateKey,
      predictedSafe
    });
    
    // Get the predicted address before deployment
    const predictedAddress = await protocolKit.getAddress();
    
    // Create the deployment transaction
    const deploymentTransaction = await protocolKit.createSafeDeploymentTransaction();
    
    console.log(`[PHASE 4] Deploying Safe to predicted address: ${predictedAddress}`);
    
    // Get the external signer to execute the transaction
    const externalSigner = await protocolKit.getSafeProvider().getExternalSigner();
    
    if (!externalSigner) {
      return {
        status: 'failed',
        error: 'Failed to get external signer for deployment',
        code: 'deployment_failed'
      };
    }
    
    let txHash: `0x${string}`;
    let txReceipt: any;
    
    try {
      // Execute the deployment transaction
      txHash = await (externalSigner as any).sendTransaction({
        to: deploymentTransaction.to as `0x${string}`,
        value: BigInt(deploymentTransaction.value),
        data: deploymentTransaction.data as `0x${string}`
      });
      
      // Wait for transaction receipt
      txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      
      if (txReceipt.status !== 'success') {
        // Transaction failed, but check if Safe was deployed by another process
        console.warn(`Safe deployment transaction failed: ${txHash}, checking if Safe exists...`);
        const postFailureState = await getOnChainSafeState(publicClient, predictedAddress as `0x${string}`, ownerAddress);
        
        if (postFailureState === 'VALID_DEPLOYED') {
          console.log(`Safe was deployed by another process during race condition at ${predictedAddress}`);
          // Another process won the race, treat as success
          return {
            status: 'success',
            safeAddress: predictedAddress as `0x${string}`,
            gasUsed: 0n, // We didn't use gas since another process deployed it
            txHash
          };
        }
        
        return {
          status: 'failed',
          error: `Safe deployment transaction failed: ${txHash}`,
          code: 'deployment_failed'
        };
      }
    } catch (deployError: any) {
      // Deployment transaction might have reverted due to race condition
      console.warn(`Safe deployment error: ${deployError.message}, checking if Safe exists...`);
      const postErrorState = await getOnChainSafeState(publicClient, predictedAddress as `0x${string}`, ownerAddress);
      
      if (postErrorState === 'VALID_DEPLOYED') {
        console.log(`Safe was deployed by another process during race condition at ${predictedAddress}`);
        // Another process won the race, treat as success
        return {
          status: 'success',
          safeAddress: predictedAddress as `0x${string}`,
          gasUsed: 0n, // We didn't use gas since another process deployed it
          txHash: '0x0000000000000000000000000000000000000000000000000000000000000000' // Placeholder
        };
      }
      
      return {
        status: 'failed',
        error: `Safe deployment failed: ${deployError.message}`,
        code: 'deployment_failed'
      };
    }
    
    // Reconnect to the deployed Safe
    protocolKit = await protocolKit.connect({ safeAddress: predictedAddress });
    
    // Verify deployment was successful
    const isDeployed = await protocolKit.isSafeDeployed();
    if (!isDeployed) {
      return {
        status: 'failed',
        error: `Safe deployment verification failed at address ${predictedAddress}`,
        code: 'deployment_failed'
      };
    }
    
    // Additional verification: check owners and threshold
    const [actualOwners, actualThreshold] = await Promise.all([
      protocolKit.getOwners(),
      protocolKit.getThreshold()
    ]);
    
    const expectedOwnerAddress = ownerAddress.toLowerCase();
    const isConfigValid = 
      actualOwners.length === 1 &&
      actualOwners[0].toLowerCase() === expectedOwnerAddress &&
      actualThreshold === 1;
    
    if (!isConfigValid) {
      return {
        status: 'failed',
        error: `Deployed Safe has incorrect configuration. Expected: [${expectedOwnerAddress}], threshold=1. Got: [${actualOwners.join(', ')}], threshold=${actualThreshold}`,
        code: 'deployment_failed'
      };
    }
    
    console.log(`[PHASE 4] Safe successfully deployed at ${predictedAddress}`);
    
    return {
      status: 'success',
      safeAddress: predictedAddress as `0x${string}`,
      gasUsed: txReceipt.gasUsed,
      txHash
    };
    
  } catch (error: any) {
    console.error(`[PHASE 4] Safe deployment failed:`, error);
    return {
      status: 'failed',
      error: `Safe deployment failed: ${error.message}`,
      code: 'deployment_failed'
    };
  }
}

/**
 * Predict the Safe address that would be deployed with the given parameters
 */
export async function predictSafeAddress(
  config: WalletManagerConfig,
  ownerAddress: `0x${string}`,
  saltNonce: `0x${string}`
): Promise<`0x${string}`> {
  try {
    getChainConfig(config.chainId); // Validate chain support
    
    // Create Safe account configuration
    const safeAccountConfig: SafeAccountConfig = {
      ...DEFAULT_SAFE_CONFIG,
      owners: [ownerAddress]
    };
    
    // Create predicted Safe properties
    const predictedSafe: PredictedSafeProps = {
      safeAccountConfig,
      safeDeploymentConfig: {
        saltNonce,
        safeVersion: SAFE_VERSION
      }
    };
    
    // Initialize Safe with predicted properties
    const protocolKit = await Safe.init({
      provider: config.rpcUrl,
      signer: config.workerPrivateKey,
      predictedSafe
    });
    
    // Get the predicted address
    const address = await protocolKit.getAddress();
    return address as `0x${string}`;
    
  } catch (error: any) {
    throw new Error(`Failed to predict Safe address: ${error.message}`);
  }
}

/**
 * Check if a Safe exists in the Safe Transaction Service and validate its configuration
 */
async function checkSafeInTransactionService(
  config: WalletManagerConfig,
  safeAddress: `0x${string}`
): Promise<{ exists: boolean; configValid?: boolean }> {
  // Skip STS checks if disabled (useful for Virtual TestNets)
  if (config.options?.disableTxServiceChecks) {
    console.warn('Safe Transaction Service checks disabled - skipping pre-existence check');
    return { exists: false };
  }
  
  try {
    const chainConfig = getChainConfig(config.chainId);
    const txServiceUrl = config.options?.txServiceUrl || chainConfig.txServiceUrl;
    
    // Query Safe Transaction Service API
    const response = await fetch(`${txServiceUrl}api/v1/safes/${safeAddress}/`);
    
    if (response.status === 404) {
      // Safe doesn't exist in the service
      return { exists: false };
    }
    
    if (!response.ok) {
      console.warn(`Safe Transaction Service query failed: ${response.status} ${response.statusText}`);
      return { exists: false };
    }
    
    const safeInfo = await response.json();
    
    // Validate Safe configuration
    const actualOwners = safeInfo.owners || [];
    const expectedThreshold = 1;
    const actualThreshold = safeInfo.threshold;
    
    // Derive owner address from private key for comparison
    const account = privateKeyToAccount(config.workerPrivateKey);
    const expectedOwnerAddress = account.address.toLowerCase();
    
    const configValid = 
      actualOwners.length === 1 &&
      actualOwners[0].toLowerCase() === expectedOwnerAddress &&
      actualThreshold === expectedThreshold;
    
    return { exists: true, configValid };
    
  } catch (error: any) {
    console.warn(`Failed to check Safe Transaction Service: ${error.message}`);
    // Fallback to false on service errors to allow deployment to proceed
    return { exists: false };
  }
}
