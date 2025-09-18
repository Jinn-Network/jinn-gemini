/**
 * Safe Transaction Executor for Dual-Rail Architecture
 * 
 * This module provides secure transaction execution through Gnosis Safe for
 * the Jinn agent system. It implements the ITransactionExecutor interface
 * and handles Safe-specific transaction execution with multi-signature support.
 * 
 * ## Security Features
 * 
 * - Allowlist-based contract and function validation
 * - Chain ID verification
 * - Payload integrity checks
 * - Multi-signature transaction execution
 * - Comprehensive error categorization
 * 
 * ## Architecture
 * 
 * This executor is part of the dual-rail execution system and specifically
 * handles transactions that require Safe execution for security or protocol
 * compatibility reasons.
 * 
 * @version 2.0.0
 * @since Phase 3 - Dual Rail Architecture
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import Safe from '@safe-global/protocol-kit';
import { ethers } from 'ethers';
import { logger } from './logger.js';
import { ITransactionExecutor } from './IExecutor.js';
import { TransactionRequest, ExecutionResult } from './types.js';
import { validateTransaction } from './validation.js';
import { updateTransactionStatus } from './control_api_client.js';

// Create a child logger for Safe executor operations
const safeLogger = logger.child({ component: 'SAFE-EXECUTOR' });

// Remove local interfaces - now using shared types from types.js

export class SafeExecutor implements ITransactionExecutor {
  private workerId: string;
  private provider: ethers.providers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private chainId: number;
  private safeAddress: string;
  private safe: Safe | null = null;
  private txConfirmations: number;

  constructor() {
    // Initialize worker configuration
    this.workerId = process.env.WORKER_ID || `worker-${Date.now()}`;
    this.chainId = parseInt(process.env.CHAIN_ID || '8453', 10); // Default to Base mainnet
    this.txConfirmations = parseInt(process.env.WORKER_TX_CONFIRMATIONS || '3', 10);
    
    // Initialize blockchain connection
    const rpcUrl = process.env.RPC_URL;
    const privateKey = process.env.WORKER_PRIVATE_KEY;
    
    if (!rpcUrl || !privateKey) {
      throw new Error('Missing RPC_URL or WORKER_PRIVATE_KEY environment variables');
    }

    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.signer = new ethers.Wallet(privateKey, this.provider);
    
    // Load Safe address from wallet identity
    this.safeAddress = this.loadSafeAddressFromWalletIdentity();
    
    safeLogger.info('SafeExecutor initialized');
  }

  /**
   * Load Safe address from wallet identity file
   */
  private loadSafeAddressFromWalletIdentity(): string {
    try {
      // Get owner address from the signer
      const ownerAddress = this.signer.address;
      
      // Use custom storage path if provided, otherwise default
      const storageBasePath = process.env.JINN_WALLET_STORAGE_PATH || join(homedir(), '.jinn', 'wallets');
      const walletPath = join(storageBasePath, this.chainId.toString(), `${ownerAddress}.json`);
      
      if (!existsSync(walletPath)) {
        throw new Error(`Wallet identity file not found at ${walletPath}. Please run wallet bootstrap first.`);
      }
      
      const identity = JSON.parse(readFileSync(walletPath, 'utf8'));
      
      // Validate the identity matches our configuration
      if (identity.chainId !== this.chainId) {
        throw new Error(`Wallet identity chain ID mismatch: expected ${this.chainId}, got ${identity.chainId}`);
      }
      
      if (identity.ownerAddress !== ownerAddress) {
        throw new Error(`Wallet identity owner address mismatch: expected ${ownerAddress}, got ${identity.ownerAddress}`);
      }
      
      if (!identity.safeAddress) {
        throw new Error('Safe address not found in wallet identity file');
      }
      
      safeLogger.info({ safeAddress: identity.safeAddress }, 'Loaded Safe address from wallet identity');
      return identity.safeAddress;
      
    } catch (error) {
      safeLogger.error({ error }, 'Failed to load Safe address from wallet identity');
      throw new Error(`Failed to load Safe address from wallet identity: ${error instanceof Error ? error.message : String(error)}`);
    }
  }



  /**
   * Initialize the Safe SDK instance
   */
  private async initializeSafe(): Promise<void> {
    if (this.safe) return;

    safeLogger.info({ safeAddress: this.safeAddress, chainId: this.chainId }, 'Initializing Safe SDK');
    
    try {
      // For Safe SDK v6, pass the provider directly as string and signer as private key
      this.safe = await Safe.init({
        provider: this.provider.connection.url,
        signer: this.signer.privateKey,
        safeAddress: this.safeAddress
      });

      const connectedChainId = await this.safe.getChainId();
      if (connectedChainId !== BigInt(this.chainId)) {
          throw new Error(`Safe is connected to chain ${connectedChainId}, but worker is configured for chain ${this.chainId}.`);
      }

      safeLogger.info({ address: await this.safe.getAddress() }, 'Safe SDK initialized successfully');
    } catch (error: any) {
      safeLogger.error({ error: error.message }, 'Failed to initialize Safe SDK');
      throw error; // Re-throw to prevent worker from starting with a faulty configuration
    }
  }





  /**
   * Execute a transaction using the Gnosis Safe SDK
   */
  async executeSafeTransaction(request: TransactionRequest): Promise<{ safeTxHash: string; txHash: string; gasUsed: bigint }> {
    await this.initializeSafe();
    if (!this.safe) throw new Error('Safe SDK not initialized');

    const safeTransactionData = {
      to: request.payload.to,
      data: request.payload.data,
      value: request.payload.value // Already validated to be '0'
    };

    safeLogger.info({ requestId: request.id, payload: safeTransactionData }, 'Creating Safe transaction');

    const safeTransaction = await this.safe.createTransaction({ transactions: [safeTransactionData] });
    const encodedTxData = await this.safe.getEncodedTransaction(safeTransaction);

    const gasLimit = await this.provider.estimateGas({
        to: this.safeAddress,
        from: this.signer.address,
        data: encodedTxData,
        value: '0'
    });

    const safeTxHash = await this.safe.getTransactionHash(safeTransaction);
    
    safeLogger.info({ requestId: request.id, safeTxHash, gasLimit: gasLimit.toString() }, 'Signing Safe transaction');
    const signedSafeTransaction = await this.safe.signTransaction(safeTransaction);

    safeLogger.info({ requestId: request.id, safeTxHash }, 'Executing Safe transaction');
    const executeTxResponse = await this.safe.executeTransaction(signedSafeTransaction, {
      gasLimit: gasLimit.toString()
    });

    const txResponse = executeTxResponse.transactionResponse as any;
    if (!txResponse) {
      throw new Error('No transaction response received after execution.');
    }

    const receipt = await txResponse.wait(this.txConfirmations);
    if (!receipt) {
      throw new Error('Failed to get transaction receipt after execution.');
    }

    safeLogger.info({ requestId: request.id, txHash: receipt.transactionHash }, 'Transaction confirmed on-chain');

    return {
      safeTxHash,
      txHash: receipt.transactionHash,
      gasUsed: BigInt(receipt.gasUsed.toString())
    };
  }

  /**
   * Execute transaction through Gnosis Safe
   */
  private async executeTransaction(request: TransactionRequest): Promise<ExecutionResult> {
    try {
      const result = await this.executeSafeTransaction(request);
      
      safeLogger.info({ requestId: request.id }, 'Safe transaction executed');

      return {
        success: true,
        safeTxHash: result.safeTxHash,
        txHash: result.txHash
      };

    } catch (error: any) {
      safeLogger.error({ requestId: request.id, error: error.message, stack: error.stack }, 'Transaction execution failed');

      // Categorize the error
      let errorCode = 'UNKNOWN';
      let errorMessage = error.message || 'Unknown error occurred';

      if (error.message?.includes('insufficient funds')) {
        errorCode = 'INSUFFICIENT_FUNDS';
      } else if (error.message?.includes('revert')) {
        errorCode = 'SAFE_TX_REVERT';
      } else if (error.message?.includes('network') || error.message?.includes('rpc')) {
        errorCode = 'RPC_FAILURE';
      }

      return {
        success: false,
        errorCode,
        errorMessage
      };
    }
  }

  /**
   * Update transaction request status in database
   */
  private async updateTransactionStatus(
    requestId: string, 
    status: 'CONFIRMED' | 'FAILED',
    result: ExecutionResult
  ): Promise<void> {
    try {
      if (result.success) {
        await updateTransactionStatus({ id: requestId, status, safe_tx_hash: result.safeTxHash, tx_hash: result.txHash });
      } else {
        await updateTransactionStatus({ id: requestId, status, error_code: result.errorCode, error_message: result.errorMessage });
      }
      safeLogger.info('Transaction status updated via Control API');
    } catch (error) {
      safeLogger.error({ error }, 'Error updating transaction status via Control API');
    }
  }

  /**
   * Process a single transaction request (implements ITransactionExecutor interface)
   */
  async processTransactionRequest(request: TransactionRequest): Promise<void> {
    safeLogger.info({ requestId: request.id }, 'Processing Safe transaction request');

    // Validate the transaction with SAFE execution context
    const validation = validateTransaction(request, {
      workerChainId: this.chainId,
      executionStrategy: 'SAFE'
    });
    
    if (!validation.valid) {
      safeLogger.warn({ requestId: request.id, error: validation.errorMessage }, 'Safe transaction validation failed');

      await this.updateTransactionStatus(request.id, 'FAILED', {
        success: false,
        errorCode: validation.errorCode,
        errorMessage: validation.errorMessage
      });
      return;
    }

    // Execute the transaction
    const result = await this.executeTransaction(request);
    
    // Update status based on result
    const status = result.success ? 'CONFIRMED' : 'FAILED';
    await this.updateTransactionStatus(request.id, status, result);
  }


}

/**
 * Factory function to create and configure a SafeExecutor
 */
export function createSafeExecutor(): SafeExecutor {
  return new SafeExecutor();
}
