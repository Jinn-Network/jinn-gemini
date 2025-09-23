import { SafeExecutor } from './SafeExecutor.js';
import { EoaExecutor } from './EoaExecutor.js';
import { TransactionRequest } from './types.js';
import { logger } from './logger.js';
import { ITransactionQueue } from './queue/index.js';
import type { TransactionRequest as QueueTransactionRequest } from './queue/types.js';
import { claimTransactionRequest, updateTransactionStatus } from './control_api_client.js';

const txLogger = logger.child({ component: 'TransactionProcessor' });

export class TransactionProcessor {
    private queue: ITransactionQueue;
    private safeExecutor: SafeExecutor;
    private eoaExecutor: EoaExecutor;
    private workerId: string;

    constructor(queue: ITransactionQueue, workerId: string) {
        this.queue = queue;
        this.safeExecutor = new SafeExecutor();
        this.eoaExecutor = new EoaExecutor();
        this.workerId = workerId;
        txLogger.info("TransactionProcessor initialized");
    }

    public async processPendingTransaction(): Promise<boolean> {
        const request = await this.claimPendingTransaction();
        if (!request) {
            return false;
        }

        await this.routeTransaction(request);
        return true;
    }

    private async claimPendingTransaction(): Promise<TransactionRequest | null> {
        try {
<<<<<<< HEAD
            const queueRequest = await this.queue.claim(this.workerId);
            if (!queueRequest) {
                return null;
            }

            // Convert queue request to worker request format
            const request: TransactionRequest = {
                ...queueRequest,
                // Ensure timestamps are properly formatted
                claimed_at: queueRequest.claimed_at || new Date().toISOString(),
                completed_at: queueRequest.completed_at,
                created_at: queueRequest.created_at,
                updated_at: queueRequest.updated_at
            };

            txLogger.info({ requestId: request.id, strategy: request.execution_strategy }, "Claimed transaction request");
            return request;
        } catch (error) {
            txLogger.error({ error }, "Error claiming transaction request via Control API");
            return null;
        }
    }

    private async routeTransaction(request: TransactionRequest): Promise<void> {
        txLogger.info({ requestId: request.id, strategy: request.execution_strategy }, "Routing transaction");
        try {
            if (request.execution_strategy === 'SAFE') {
                await this.safeExecutor.processTransactionRequest(request, this.queue);
            } else {
                // Default to EOA for any strategy that isn't explicitly SAFE
                if (request.execution_strategy !== 'EOA') {
                    txLogger.warn({ requestId: request.id, originalStrategy: request.execution_strategy }, "Unknown execution strategy, defaulting to EOA");
                    // Update the request's execution strategy to EOA so validation passes
                    request.execution_strategy = 'EOA';
                }
                await this.eoaExecutor.processTransactionRequest(request, this.queue);
            }
        } catch (error) {
            txLogger.error({ requestId: request.id, error }, "Error processing transaction");
            await this.updateTransactionAsFailed(request.id, 'ROUTING_ERROR', `Transaction routing failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async updateTransactionAsFailed(requestId: string, errorCode: string, errorMessage: string): Promise<void> {
        try {
<<<<<<< HEAD
            await this.queue.updateStatus(requestId, 'FAILED', {
                error_code: errorCode,
                error_message: errorMessage,
                completed_at: new Date().toISOString()
            });
            
            txLogger.info({ requestId, errorCode, errorMessage }, "Transaction marked as FAILED");
        } catch (error) {
            txLogger.error({ requestId, error }, "Error updating transaction status to FAILED via Control API");
        }
    }
}
