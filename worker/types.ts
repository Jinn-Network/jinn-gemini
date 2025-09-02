/**
 * Shared Types for Transaction Execution System
 * 
 * This module contains type definitions shared across all transaction executors
 * and related components in the dual-rail execution architecture.
 * 
 * @version 1.0.0
 * @since Phase 2 - Dual Rail Architecture
 */

/**
 * Transaction payload structure
 */
export interface TransactionPayload {
  /** Target contract address */
  to: string;
  
  /** Transaction data (function call encoded) */
  data: string;
  
  /** Transaction value in wei (as string to handle big numbers) */
  value: string;
}

/**
 * Execution strategy for transaction processing
 */
export type ExecutionStrategy = 'EOA' | 'SAFE';

/**
 * Transaction request status
 */
export type TransactionStatus = 'PENDING' | 'CLAIMED' | 'CONFIRMED' | 'FAILED';

/**
 * Complete transaction request record from the database
 */
export interface TransactionRequest {
  /** Unique identifier for the transaction request */
  id: string;
  
  /** Current status of the transaction */
  status: TransactionStatus;
  
  /** Number of execution attempts made */
  attempt_count: number;
  
  /** Hash of the payload for deduplication */
  payload_hash: string;
  
  /** ID of the worker currently processing this transaction */
  worker_id: string | null;
  
  /** Timestamp when the transaction was claimed by a worker */
  claimed_at: string | null;
  
  /** Timestamp when the transaction was completed */
  completed_at: string | null;
  
  /** The transaction payload */
  payload: TransactionPayload;
  
  /** Chain ID where the transaction should be executed */
  chain_id: number;
  
  /** Execution strategy to use for this transaction */
  execution_strategy: ExecutionStrategy;
  
  /** Optional idempotency key for duplicate prevention */
  idempotency_key: string | null;
  
  /** Safe transaction hash (if executed via Safe) */
  safe_tx_hash: string | null;
  
  /** Blockchain transaction hash */
  tx_hash: string | null;
  
  /** Error code if transaction failed */
  error_code: string | null;
  
  /** Error message if transaction failed */
  error_message: string | null;
  
  /** ID of the job that created this transaction request */
  source_job_id: string | null;
  
  /** Timestamp when the record was created */
  created_at: string;
  
  /** Timestamp when the record was last updated */
  updated_at: string;
}

/**
 * Result of a transaction execution attempt
 */
export interface ExecutionResult {
  /** Whether the execution was successful */
  success: boolean;
  
  /** Transaction hash from the blockchain (for both EOA and Safe transactions) */
  txHash?: string;
  
  /** Safe transaction hash (only present for Safe executions) */
  safeTxHash?: string;
  
  /** Error code for categorizing failures */
  errorCode?: string;
  
  /** Human-readable error message */
  errorMessage?: string;
}

export interface JobBoard {
  id: string;
  status: string;
  worker_id?: string;
  input_prompt: string;
  input_context: string | null;
  enabled_tools: string[];
  model_settings: Record<string, any>;
  job_definition_id: string;
  job_name: string;
}
