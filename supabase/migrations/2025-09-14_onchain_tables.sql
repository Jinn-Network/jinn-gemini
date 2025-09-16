-- On-chain parallel tables to preserve legacy functionality

-- 1) Atomic claim table
CREATE TABLE IF NOT EXISTS public.onchain_request_claims (
  request_id     TEXT PRIMARY KEY,
  worker_address TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  claimed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_onchain_request_claims_worker ON public.onchain_request_claims(worker_address);
CREATE INDEX IF NOT EXISTS idx_onchain_request_claims_status ON public.onchain_request_claims(status);
CREATE INDEX IF NOT EXISTS idx_onchain_request_claims_claimed_at ON public.onchain_request_claims(claimed_at);

-- 2) On-chain job reports
CREATE TABLE IF NOT EXISTS public.onchain_job_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     TEXT NOT NULL,
  worker_address TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('COMPLETED','FAILED')),
  duration_ms    INTEGER NOT NULL,
  total_tokens   INTEGER NOT NULL DEFAULT 0,
  tools_called   JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_output   TEXT,
  error_message  TEXT,
  error_type     TEXT,
  raw_telemetry  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onchain_job_reports_request_id ON public.onchain_job_reports(request_id);
CREATE INDEX IF NOT EXISTS idx_onchain_job_reports_worker ON public.onchain_job_reports(worker_address);
CREATE INDEX IF NOT EXISTS idx_onchain_job_reports_status ON public.onchain_job_reports(status);
CREATE INDEX IF NOT EXISTS idx_onchain_job_reports_created_at ON public.onchain_job_reports(created_at);

-- 3) On-chain artifacts
CREATE TABLE IF NOT EXISTS public.onchain_artifacts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     TEXT NOT NULL,
  worker_address TEXT NOT NULL,
  cid            TEXT NOT NULL,
  topic          TEXT NOT NULL,
  content        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onchain_artifacts_request_id ON public.onchain_artifacts(request_id);
CREATE INDEX IF NOT EXISTS idx_onchain_artifacts_worker ON public.onchain_artifacts(worker_address);
CREATE INDEX IF NOT EXISTS idx_onchain_artifacts_topic ON public.onchain_artifacts(topic);
CREATE INDEX IF NOT EXISTS idx_onchain_artifacts_created_at ON public.onchain_artifacts(created_at);

-- 4) On-chain messages (optional)
CREATE TABLE IF NOT EXISTS public.onchain_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     TEXT NOT NULL,
  worker_address TEXT,
  content        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','READ')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onchain_messages_request_id ON public.onchain_messages(request_id);
CREATE INDEX IF NOT EXISTS idx_onchain_messages_status ON public.onchain_messages(status);
CREATE INDEX IF NOT EXISTS idx_onchain_messages_created_at ON public.onchain_messages(created_at);

-- 5) Enable RLS and basic backend policies
ALTER TABLE public.onchain_request_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onchain_job_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onchain_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onchain_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY onchain_request_claims_write ON public.onchain_request_claims
    FOR INSERT TO service_role WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN END $$;

DO $$ BEGIN
  CREATE POLICY onchain_request_claims_update ON public.onchain_request_claims
    FOR UPDATE TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN END $$;

DO $$ BEGIN
  CREATE POLICY onchain_job_reports_write ON public.onchain_job_reports
    FOR INSERT TO service_role WITH CHECK (request_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN END $$;

DO $$ BEGIN
  CREATE POLICY onchain_artifacts_write ON public.onchain_artifacts
    FOR INSERT TO service_role WITH CHECK (request_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN END $$;

DO $$ BEGIN
  CREATE POLICY onchain_messages_write ON public.onchain_messages
    FOR INSERT TO service_role WITH CHECK (request_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN END $$;


