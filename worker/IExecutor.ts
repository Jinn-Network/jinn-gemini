/**
 * Transaction Executor Interface
 * 
 * This interface defines the contract that all transaction executors must implement
 * in the dual-rail execution architecture. It provides a common interface for both
 * EOA (Externally Owned Account) and Safe (Gnosis Safe) execution strategies.
 * 
 * @version 1.0.0
 * @since Phase 2 - Dual Rail Architecture
 */

import { TransactionRequest, ExecutionResult } from './types.js';

/**
 * Interface that all transaction executors must implement
 */
export interface ITransactionExecutor {
  /**
   * Process a single transaction request
   * 
   * This method handles the complete lifecycle of a transaction:
   * 1. Validates the transaction against security constraints
   * 2. Executes the transaction using the appropriate method (EOA or Safe)
   * 3. Updates the database with the result
   * 
   * @param request The transaction request to process
   */
  processTransactionRequest(request: TransactionRequest): Promise<void>;
}
