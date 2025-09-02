-- Migration: Add dual-rail execution support
-- Created: 2025-09-01
-- Description: Adds execution_strategy column and claim_transaction_request function for dual-rail architecture

-- Add execution strategy enum type (idempotent)
DO $$ BEGIN
    CREATE TYPE execution_strategy AS ENUM ('EOA', 'SAFE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add execution_strategy column to transaction_requests table (idempotent)
DO $$ BEGIN
    ALTER TABLE public.transaction_requests 
    ADD COLUMN execution_strategy execution_strategy NOT NULL DEFAULT 'SAFE';
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add idempotency_key column to transaction_requests table (idempotent)
DO $$ BEGIN
    ALTER TABLE public.transaction_requests 
    ADD COLUMN idempotency_key TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Update error codes enum to include dual-rail specific errors (idempotent)
DO $$ BEGIN
    ALTER TYPE transaction_error_code ADD VALUE IF NOT EXISTS 'UNKNOWN_STRATEGY';
    ALTER TYPE transaction_error_code ADD VALUE IF NOT EXISTS 'ROUTING_ERROR';
    ALTER TYPE transaction_error_code ADD VALUE IF NOT EXISTS 'EXECUTION_STRATEGY_VIOLATION';
    ALTER TYPE transaction_error_code ADD VALUE IF NOT EXISTS 'EXECUTION_STRATEGY_MISMATCH';
EXCEPTION
    WHEN others THEN null;
END $$;

-- Create or replace the claim_transaction_request function
-- This function atomically claims any pending transaction regardless of strategy
CREATE OR REPLACE FUNCTION public.claim_transaction_request(p_worker_id TEXT)
RETURNS TABLE (
    id UUID,
    status transaction_status,
    attempt_count INT,
    payload_hash TEXT,
    worker_id TEXT,
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    payload JSONB,
    chain_id BIGINT,
    execution_strategy execution_strategy,
    idempotency_key TEXT,
    safe_tx_hash TEXT,
    tx_hash TEXT,
    error_code transaction_error_code,
    error_message TEXT,
    source_job_id UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
    lease_timeout_minutes INT := 15; -- 15 minute lease timeout
BEGIN
    -- Atomically claim the oldest pending transaction
    RETURN QUERY
    UPDATE public.transaction_requests
    SET 
        status = 'CLAIMED',
        worker_id = p_worker_id,
        claimed_at = now(),
        attempt_count = attempt_count + 1,
        updated_at = now()
    WHERE public.transaction_requests.id = (
        SELECT tr.id 
        FROM public.transaction_requests tr
        WHERE tr.status = 'PENDING'
           OR (tr.status = 'CLAIMED' 
               AND tr.claimed_at < now() - INTERVAL '1 minute' * lease_timeout_minutes)
        ORDER BY tr.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING 
        public.transaction_requests.id,
        public.transaction_requests.status,
        public.transaction_requests.attempt_count,
        public.transaction_requests.payload_hash,
        public.transaction_requests.worker_id,
        public.transaction_requests.claimed_at,
        public.transaction_requests.completed_at,
        public.transaction_requests.payload,
        public.transaction_requests.chain_id,
        public.transaction_requests.execution_strategy,
        public.transaction_requests.idempotency_key,
        public.transaction_requests.safe_tx_hash,
        public.transaction_requests.tx_hash,
        public.transaction_requests.error_code,
        public.transaction_requests.error_message,
        public.transaction_requests.source_job_id,
        public.transaction_requests.created_at,
        public.transaction_requests.updated_at;
END;
$$;

-- Create or replace cleanup function for expired leases
CREATE OR REPLACE FUNCTION public.cleanup_expired_transaction_leases()
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    lease_timeout_minutes INT := 15; -- 15 minute lease timeout
    affected_rows INT;
BEGIN
    -- Reset expired claimed transactions back to PENDING
    UPDATE public.transaction_requests
    SET 
        status = 'PENDING',
        worker_id = NULL,
        claimed_at = NULL,
        updated_at = now()
    WHERE status = 'CLAIMED' 
      AND claimed_at < now() - INTERVAL '1 minute' * lease_timeout_minutes;
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows;
END;
$$;

-- Add index for execution strategy filtering (idempotent)
CREATE INDEX IF NOT EXISTS idx_tx_requests_strategy_poll 
ON public.transaction_requests(status, execution_strategy, created_at) 
WHERE status IN ('PENDING', 'CLAIMED');

-- Add comments for new columns
COMMENT ON COLUMN public.transaction_requests.execution_strategy IS 'Execution strategy: EOA for direct signing, SAFE for Gnosis Safe multi-sig';
COMMENT ON COLUMN public.transaction_requests.idempotency_key IS 'Optional idempotency key for duplicate prevention';
