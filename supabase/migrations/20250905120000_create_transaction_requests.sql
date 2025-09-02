-- Migration: Create transaction_requests table for Zora integration
-- Created: 2025-09-05
-- Description: Database queue for on-chain transactions to be executed by worker via Gnosis Safe

-- Create enum types for transaction status and error codes (idempotent)
DO $$ BEGIN
    CREATE TYPE transaction_status AS ENUM ('PENDING', 'CLAIMED', 'CONFIRMED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE transaction_error_code AS ENUM (
        'ALLOWLIST_VIOLATION',
        'CHAIN_MISMATCH',
        'INVALID_PAYLOAD',
        'INSUFFICIENT_FUNDS',
        'RPC_FAILURE',
        'SAFE_TX_REVERT',
        'UNKNOWN'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create the transaction_requests table (idempotent)
CREATE TABLE IF NOT EXISTS public.transaction_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status transaction_status NOT NULL DEFAULT 'PENDING',
    attempt_count INT NOT NULL DEFAULT 0,
    payload_hash TEXT NOT NULL,
    
    -- Execution Tracking & Leasing
    worker_id TEXT,
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Transaction Data
    payload JSONB NOT NULL,
    chain_id BIGINT NOT NULL,
    
    -- Result Data
    safe_tx_hash TEXT,
    tx_hash TEXT,
    error_code transaction_error_code,
    error_message TEXT,
    
    -- Auditing
    source_job_id UUID REFERENCES public.job_board(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add constraints and indexes (idempotent)
DO $$ BEGIN
    ALTER TABLE public.transaction_requests ADD CONSTRAINT uq_payload_hash UNIQUE (payload_hash);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create index (idempotent)
CREATE INDEX IF NOT EXISTS idx_tx_requests_poll 
ON public.transaction_requests(status, created_at) 
WHERE status = 'PENDING';

-- Add table comment
COMMENT ON TABLE public.transaction_requests IS 'A queue for on-chain transactions to be executed by a worker via Gnosis Safe.';

-- Add the timestamp trigger (idempotent)
DO $$ BEGIN
    CREATE TRIGGER set_timestamp 
        BEFORE UPDATE ON public.transaction_requests 
        FOR EACH ROW 
        EXECUTE PROCEDURE trigger_set_timestamp();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
