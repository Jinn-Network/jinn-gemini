-- Alter the transaction_requests table to remove the source_job_id column and its foreign key constraint.
-- This change decouples transaction enqueuing from the job system, allowing for requests
-- to be submitted from contexts where a job ID is not available (e.g., interactive sessions, external triggers).

ALTER TABLE public.transaction_requests
DROP COLUMN IF EXISTS source_job_id;
