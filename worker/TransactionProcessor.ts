import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SafeExecutor } from './SafeExecutor.js';
import { EoaExecutor } from './EoaExecutor.js';
import { TransactionRequest } from './types.js';
import { logger } from './logger.js';

const txLogger = logger.child({ component: 'TransactionProcessor' });

export class TransactionProcessor {
    private supabase: SupabaseClient;
    private safeExecutor: SafeExecutor;
    private eoaExecutor: EoaExecutor;
    private workerId: string;

    constructor(supabaseUrl: string, supabaseKey: string, workerId: string) {
        this.supabase = createClient(supabaseUrl, supabaseKey);
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
            const { data, error } = await this.supabase.rpc('claim_transaction_request', { p_worker_id: this.workerId });
            if (error) {
                txLogger.error({ error }, "Database error claiming transaction");
                return null;
            }
            if (!data || data.length === 0) {
                return null;
            }
            const request = data[0] as TransactionRequest;
            txLogger.info({ requestId: request.id, strategy: request.execution_strategy }, "Claimed transaction request");
            return request;
        } catch (error) {
            txLogger.error({ error }, "Error claiming transaction request");
            return null;
        }
    }

    private async routeTransaction(request: TransactionRequest): Promise<void> {
        txLogger.info({ requestId: request.id, strategy: request.execution_strategy }, "Routing transaction");
        try {
            if (request.execution_strategy === 'SAFE') {
                await this.safeExecutor.processTransactionRequest(request);
            } else {
                // Default to EOA for any strategy that isn't explicitly SAFE
                if (request.execution_strategy !== 'EOA') {
                    txLogger.warn({ requestId: request.id, originalStrategy: request.execution_strategy }, "Unknown execution strategy, defaulting to EOA");
                    // Update the request's execution strategy to EOA so validation passes
                    request.execution_strategy = 'EOA';
                }
                await this.eoaExecutor.processTransactionRequest(request);
            }
        } catch (error) {
            txLogger.error({ requestId: request.id, error }, "Error processing transaction");
            await this.updateTransactionAsFailed(request.id, 'ROUTING_ERROR', `Transaction routing failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async updateTransactionAsFailed(requestId: string, errorCode: string, errorMessage: string): Promise<void> {
        try {
            const { error } = await this.supabase
                .from('transaction_requests')
                .update({
                    status: 'FAILED',
                    error_code: errorCode,
                    error_message: errorMessage,
                    completed_at: new Date().toISOString()
                })
                .eq('id', requestId);
            
            if (error) {
                txLogger.error({ requestId, error }, "Failed to update transaction status to FAILED");
            } else {
                txLogger.info({ requestId, errorCode, errorMessage }, "Transaction marked as FAILED");
            }
        } catch (error) {
            txLogger.error({ requestId, error }, "Error updating transaction status to FAILED");
        }
    }
}
