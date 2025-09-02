-- Rollback: Remove transaction_requests table and related types
-- This rollback script reverses 20250905120000_create_transaction_requests.sql

-- Drop the trigger first
DROP TRIGGER IF EXISTS set_timestamp ON public.transaction_requests;

-- Drop the table (this will also drop constraints and indexes)
DROP TABLE IF EXISTS public.transaction_requests;

-- Drop the custom types (only if not used elsewhere)
-- Note: These might be used by other tables, so we check dependencies first
DO $$ 
DECLARE
    transaction_status_usage_count INTEGER;
    transaction_error_code_usage_count INTEGER;
BEGIN
    -- Check if transaction_status is used elsewhere
    SELECT COUNT(*) INTO transaction_status_usage_count
    FROM information_schema.columns 
    WHERE data_type = 'USER-DEFINED' 
    AND udt_name = 'transaction_status';
    
    -- Check if transaction_error_code is used elsewhere  
    SELECT COUNT(*) INTO transaction_error_code_usage_count
    FROM information_schema.columns 
    WHERE data_type = 'USER-DEFINED' 
    AND udt_name = 'transaction_error_code';
    
    -- Drop types only if not used elsewhere
    IF transaction_status_usage_count = 0 THEN
        DROP TYPE IF EXISTS transaction_status;
    END IF;
    
    IF transaction_error_code_usage_count = 0 THEN
        DROP TYPE IF EXISTS transaction_error_code;
    END IF;
END $$;
