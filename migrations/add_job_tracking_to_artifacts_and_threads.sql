-- Add job tracking to artifacts and threads tables
-- This migration adds created_by_job_id to track which job created each record

-- Add job tracking to artifacts table
ALTER TABLE artifacts 
ADD COLUMN created_by_job_id UUID REFERENCES job_board(id);

-- Add job tracking to threads table  
ALTER TABLE threads 
ADD COLUMN created_by_job_id UUID REFERENCES job_board(id);

-- Add indexes for performance
CREATE INDEX idx_artifacts_created_by_job_id ON artifacts(created_by_job_id);
CREATE INDEX idx_threads_created_by_job_id ON threads(created_by_job_id);

-- Add comments for documentation
COMMENT ON COLUMN artifacts.created_by_job_id IS 'The job ID that created this artifact';
COMMENT ON COLUMN threads.created_by_job_id IS 'The job ID that created this thread';