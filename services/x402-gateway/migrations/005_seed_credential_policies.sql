-- Seed initial credential policies
-- These define which providers auto-grant to operators at each trust tier.
--
-- Run after 004_credential_management.sql

-- Static providers: auto-grant to staked operators (no Nango needed)
INSERT INTO credential_policies (provider, min_trust_tier, auto_grant, default_price, max_requests_per_minute)
VALUES
  ('github', 'staked', true, '0', 30),
  ('telegram', 'staked', true, '0', 20),
  ('openai', 'trusted', true, '0', 10),
  ('supabase', 'staked', true, '0', 30),
  ('railway', 'trusted', true, '0', 10),
  ('civitai', 'trusted', true, '0', 10),
  ('fireflies', 'trusted', true, '0', 10),
  ('umami', 'staked', true, '0', 20)
ON CONFLICT (provider) DO NOTHING;

-- OAuth providers: require approval (venture owner must explicitly grant)
INSERT INTO credential_policies (provider, min_trust_tier, auto_grant, requires_approval, default_price, max_requests_per_minute)
VALUES
  ('twitter', 'trusted', false, true, '0', 10)
ON CONFLICT (provider) DO NOTHING;
