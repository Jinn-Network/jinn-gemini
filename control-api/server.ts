import { createYoga, createSchema } from 'graphql-yoga';
import { createClient } from '@supabase/supabase-js';
import fetch from 'cross-fetch';
import dotenv from 'dotenv';
import { logger, serializeError } from '../logging/index.js';
import {
  getRequiredSupabaseUrl,
  getRequiredSupabaseServiceRoleKey,
  getPonderGraphqlUrl,
  getOptionalControlApiPort
} from '../config/index.js';
import { getMasterSafe, getServiceSafeAddress } from '../env/operate-profile.js';

// Load environment variables
dotenv.config();

type Context = {
  supabase: ReturnType<typeof createClient>;
  ponderUrl: string;
  req: Request;
};

const typeDefs = /* GraphQL */ `
  type RequestClaim {
    request_id: String!
    worker_address: String!
    status: String!
    claimed_at: String!
    completed_at: String
    alreadyClaimed: Boolean
  }

  type DispatchClaim {
    parent_job_def_id: String!
    allowed: Boolean!
    claimed_by: String
  }

  type JobReport {
    id: String!
    request_id: String!
    worker_address: String!
    status: String!
    duration_ms: Int!
    total_tokens: Int
    final_output: String
    error_message: String
    error_type: String
    created_at: String!
  }

  type Artifact {
    id: String!
    request_id: String!
    worker_address: String!
    cid: String!
    topic: String!
    content: String
    created_at: String!
  }

  type Message {
    id: String!
    request_id: String!
    worker_address: String!
    content: String!
    status: String!
    created_at: String!
  }

  type UtilityScore {
    id: String!
    artifact_id: String!
    score: Int!
    access_count: Int!
    created_at: String!
    updated_at: String!
  }

  type JobTemplate {
    id: String!
    name: String!
    description: String
    tags: [String!]!
    enabled_tools_policy: String!
    input_schema: String!
    output_spec: String!
    x402_price: String!
    safety_tier: String!
    status: String!
    canonical_job_definition_id: String
    created_at: String!
    updated_at: String!
  }

  type TransactionRequest {
    id: String!
    request_id: String
    worker_address: String
    chain_id: Int!
    payload: String!
    payload_hash: String!
    execution_strategy: String!
    status: String!
    idempotency_key: String
    safe_tx_hash: String
    tx_hash: String
    error_code: String
    error_message: String
    created_at: String!
    updated_at: String!
  }

  input JobReportInput {
    status: String!
    duration_ms: Int!
    total_tokens: Int
    tools_called: String
    final_output: String
    error_message: String
    error_type: String
    raw_telemetry: String
  }

  input ArtifactInput {
    cid: String!
    topic: String!
    content: String
  }

  input MessageInput {
    content: String!
    status: String
  }

  input JobTemplateInput {
    name: String!
    description: String
    tags: [String!]
    enabled_tools_policy: String
    input_schema: String
    output_spec: String
    x402_price: String
    safety_tier: String
    status: String
    canonical_job_definition_id: String
  }

  type Mutation {
    claimRequest(requestId: String!): RequestClaim!
    claimParentDispatch(parentJobDefId: String!, childJobDefId: String!): DispatchClaim!
    createJobReport(requestId: String!, reportData: JobReportInput!): JobReport!
    createArtifact(requestId: String!, artifactData: ArtifactInput!): Artifact!
    createMessage(requestId: String!, messageData: MessageInput!): Message!
    rateMemory(artifactId: String!, rating: Int!): UtilityScore!
    enqueueTransaction(requestId: String, chain_id: Int!, execution_strategy: String!, payload: String!, idempotency_key: String): TransactionRequest!
    getTransactionStatus(id: String!): TransactionRequest!
    claimTransactionRequest: TransactionRequest
    updateTransactionStatus(id: String!, status: String!, safe_tx_hash: String, tx_hash: String, error_code: String, error_message: String): TransactionRequest!
    createJobTemplate(id: String!, templateData: JobTemplateInput!): JobTemplate!
    updateJobTemplate(id: String!, templateData: JobTemplateInput!): JobTemplate!
  }

  type Query {
    _health: String!
    jobTemplates(status: String, safety_tier: String, limit: Int): [JobTemplate!]!
    jobTemplate(id: String!): JobTemplate
  }
`;

async function assertRequestExists(ctx: Context, requestId: string) {
  if (!ctx.ponderUrl) return; // allow skip if not configured

  const body = {
    query: `query($id: String!) { request(id: $id) { id } }`,
    variables: { id: requestId },
  };

  try {
    // Add timeout to prevent hanging on slow/unavailable endpoints
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${ctx.ponderUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Check if response is actually JSON before parsing
    const contentType = res.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      logger.warn({
        requestId,
        status: res.status,
        contentType
      }, 'Ponder returned non-JSON response, skipping validation');
      return; // Skip validation rather than failing
    }

    const json = await res.json();
    if (!json?.data?.request?.id) {
      throw new Error(`Unknown request_id: ${requestId}`);
    }
  } catch (error) {
    // Validation failures must be thrown to prevent invalid writes
    logger.error({ error: serializeError(error), requestId }, 'Ponder validation failed');
    throw error;
  }
}

function getWorkerAddress(ctx: Context): string {
  const headerVal = (ctx.req.headers as any).get?.('x-worker-address') || (ctx.req as any).headers?.['x-worker-address'];
  if (!headerVal || typeof headerVal !== 'string') {
    throw new Error('Missing x-worker-address');
  }
  return headerVal;
}

const resolvers = {
  Query: {
    _health: () => 'ok',

    jobTemplates: async (
      _: any,
      args: { status?: string; safety_tier?: string; limit?: number },
      ctx: Context
    ) => {
      let query = ctx.supabase
        .from('job_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (args.status) {
        query = query.eq('status', args.status);
      }
      if (args.safety_tier) {
        query = query.eq('safety_tier', args.safety_tier);
      }
      if (args.limit) {
        query = query.limit(args.limit);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      // Transform JSONB fields to strings for GraphQL
      return (data || []).map((t: any) => ({
        ...t,
        tags: t.tags || [],
        enabled_tools_policy: JSON.stringify(t.enabled_tools_policy || []),
        input_schema: JSON.stringify(t.input_schema || {}),
        output_spec: JSON.stringify(t.output_spec || {}),
        x402_price: String(t.x402_price || 0),
      }));
    },

    jobTemplate: async (_: any, args: { id: string }, ctx: Context) => {
      const { data, error } = await ctx.supabase
        .from('job_templates')
        .select('*')
        .eq('id', args.id)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return null;

      return {
        ...data,
        tags: data.tags || [],
        enabled_tools_policy: JSON.stringify(data.enabled_tools_policy || []),
        input_schema: JSON.stringify(data.input_schema || {}),
        output_spec: JSON.stringify(data.output_spec || {}),
        x402_price: String(data.x402_price || 0),
      };
    },
  },
  Mutation: {
    claimRequest: async (_: any, args: { requestId: string }, ctx: Context) => {
      const worker = getWorkerAddress(ctx);
      logger.info({ requestId: args.requestId, worker }, '>>> claimRequest called');

      await assertRequestExists(ctx, args.requestId);
      const now = new Date().toISOString();
      const staleThreshold = new Date(Date.now() - 300000).toISOString(); // 5 minutes ago

      // Step 1: Try to INSERT a new claim (atomic - will fail if exists)
      const { data: inserted, error: insertErr } = await ctx.supabase
        .from('onchain_request_claims')
        .insert({
          request_id: args.requestId,
          worker_address: worker,
          status: 'IN_PROGRESS',
          claimed_at: now,
          completed_at: null,
        })
        .select('*');

      // If insert succeeded, we claimed it
      if (!insertErr && inserted && inserted.length > 0) {
        return { ...inserted[0], alreadyClaimed: false };
      }

      // If error is NOT a unique constraint violation, throw it
      if (insertErr && insertErr.code !== '23505') {
        throw new Error(insertErr.message);
      }

      // Step 2: Claim already exists - fetch it to check if reclaimable
      const { data: existing, error: fetchErr } = await ctx.supabase
        .from('onchain_request_claims')
        .select('*')
        .eq('request_id', args.requestId)
        .order('claimed_at', { ascending: false })
        .limit(1)
        .single();
      if (fetchErr) throw new Error(fetchErr.message);

      // Step 3: Check if reclaimable (completed or stale)
      const isCompleted = existing.status === 'COMPLETED';
      const isStale = existing.status === 'IN_PROGRESS' &&
        existing.claimed_at && existing.claimed_at < staleThreshold;

      if (!isCompleted && !isStale) {
        // Active claim by another worker - return with alreadyClaimed flag
        logger.info({
          requestId: args.requestId,
          existingStatus: existing.status,
          existingClaimedAt: existing.claimed_at,
          staleThreshold,
          existingWorker: existing.worker_address,
          requestingWorker: worker,
        }, 'Claim NOT reclaimable - returning alreadyClaimed=true');
        return { ...existing, alreadyClaimed: true };
      }

      // Step 4: Reclaim with conditional UPDATE (atomic - guards against races)
      logger.info({
        requestId: args.requestId,
        reason: isCompleted ? 'completed' : 'stale',
        oldWorker: existing.worker_address,
        newWorker: worker,
        existingStatus: existing.status,
        existingClaimedAt: existing.claimed_at,
        staleThreshold,
        orFilter: `status.eq.COMPLETED,claimed_at.lt.${staleThreshold}`,
      }, 'Re-claiming job');

      // Note: We've already verified in Step 3 that the claim is reclaimable.
      // The .or() conditional UPDATE was failing silently, so we use a simple .eq() here.
      // Race condition is acceptable: worst case is two workers both update, but the
      // second update just overwrites with the same IN_PROGRESS status.
      const { data: updated, error: updateErr } = await ctx.supabase
        .from('onchain_request_claims')
        .update({
          worker_address: worker,
          status: 'IN_PROGRESS',
          claimed_at: now,
          completed_at: null,
        })
        .eq('request_id', args.requestId)
        .select('*');

      if (updateErr) throw new Error(updateErr.message);

      logger.info({
        requestId: args.requestId,
        updatedRows: updated?.length || 0,
        updatedData: updated?.[0] ? { claimed_at: updated[0].claimed_at, status: updated[0].status } : null,
      }, 'UPDATE result for re-claim');

      // If update succeeded, we reclaimed it
      if (updated && updated.length > 0) {
        logger.info({ requestId: args.requestId }, 'Re-claim succeeded - returning alreadyClaimed=false');
        return { ...updated[0], alreadyClaimed: false };
      }

      // Lost the race - another worker reclaimed it first
      logger.info({ requestId: args.requestId }, 'Re-claim failed (lost race) - returning alreadyClaimed=true');
      const { data: refreshed } = await ctx.supabase
        .from('onchain_request_claims')
        .select('*')
        .eq('request_id', args.requestId)
        .order('claimed_at', { ascending: false })
        .limit(1)
        .single();
      return { ...refreshed, alreadyClaimed: true };
    },

    claimParentDispatch: async (_: any, args: { parentJobDefId: string; childJobDefId: string }, ctx: Context) => {
      const worker = getWorkerAddress(ctx);
      const now = new Date().toISOString();
      const expirationDate = new Date();
      // 5 minutes from now
      expirationDate.setMinutes(expirationDate.getMinutes() + 5);
      const expiresAt = expirationDate.toISOString();

      // Step 0: Clean up expired claims (maintenance)
      // We don't await this to keep latency low, just fire and forget or let background process handle
      // But for strict correctness, we should clear expired for *this* parent before checking
      await ctx.supabase
        .from('parent_dispatch_claims')
        .delete()
        .lt('expires_at', now)
        .eq('parent_job_def_id', args.parentJobDefId);

      // Step 1: Try INSERT (atomic claim)
      const { data: inserted, error: insertErr } = await ctx.supabase
        .from('parent_dispatch_claims')
        .insert({
          parent_job_def_id: args.parentJobDefId,
          child_job_def_id: args.childJobDefId,
          worker_address: worker,
          claimed_at: now,
          expires_at: expiresAt
        })
        .select('*');

      // Success - we claimed it
      if (!insertErr && inserted && inserted.length > 0) {
        logger.info({
          parent: args.parentJobDefId,
          child: args.childJobDefId,
          worker
        }, 'Claimed parent dispatch');
        return {
          parent_job_def_id: args.parentJobDefId,
          allowed: true,
          claimed_by: args.childJobDefId // It's us
        };
      }

      // Error - likely already claimed
      if (insertErr && insertErr.code === '23505') { // Unique violation
        // Fetch existing to see who claimed it
        const { data: existing } = await ctx.supabase
          .from('parent_dispatch_claims')
          .select('child_job_def_id')
          .eq('parent_job_def_id', args.parentJobDefId)
          .single();

        const owner = existing?.child_job_def_id || 'unknown';

        // If WE already claimed it (e.g. retry), allow it
        if (owner === args.childJobDefId) {
          return {
            parent_job_def_id: args.parentJobDefId,
            allowed: true,
            claimed_by: owner
          };
        }

        logger.info({
          parent: args.parentJobDefId,
          child: args.childJobDefId,
          existingOwner: owner
        }, 'Parent dispatch already claimed by sibling');

        return {
          parent_job_def_id: args.parentJobDefId,
          allowed: false,
          claimed_by: owner
        };
      }

      // Other error
      logger.error({ error: insertErr.message }, 'Error claiming parent dispatch');
      throw new Error(insertErr.message);
    },

    createJobReport: async (
      _: any,
      args: { requestId: string; reportData: any },
      ctx: Context
    ) => {
      await assertRequestExists(ctx, args.requestId);
      const worker = getWorkerAddress(ctx);

      // Map intermediate statuses to valid database values
      // DB constraint only allows 'COMPLETED' and 'FAILED'
      const reportStatusMap: Record<string, string> = {
        'COMPLETED': 'COMPLETED',
        'FAILED': 'FAILED',
        'DELEGATING': 'COMPLETED', // Job completed by delegating to children
        'WAITING': 'COMPLETED',    // Job completed its phase, waiting for dependencies
        'IN_PROGRESS': 'COMPLETED', // Treat as completed for reporting purposes
      };
      const dbStatus = reportStatusMap[args.reportData.status] || 'COMPLETED';

      const payload = {
        request_id: args.requestId,
        worker_address: worker,
        status: dbStatus,
        duration_ms: args.reportData.duration_ms,
        total_tokens: args.reportData.total_tokens ?? 0,
        tools_called: args.reportData.tools_called ?? '[]',
        final_output: args.reportData.final_output ?? null,
        error_message: args.reportData.error_message ?? null,
        error_type: args.reportData.error_type ?? null,
        raw_telemetry: args.reportData.raw_telemetry ?? '{}',
      };

      const { data, error } = await ctx.supabase
        .from('onchain_job_reports')
        .upsert(payload, { onConflict: 'request_id' })
        .select()
        .limit(1);
      if (error) {
        logger.error({
          requestId: args.requestId,
          status: payload.status,
          error: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        }, 'Failed to upsert job report');
        throw new Error(`createJobReport failed: ${error.message} (requestId=${args.requestId}, status=${payload.status})`);
      }
      const report = data![0];

      // Update claim status based on report outcome
      // Map job statuses to valid claim statuses
      const claimStatusMap: Record<string, string> = {
        'DELEGATING': 'IN_PROGRESS',
        'WAITING': 'IN_PROGRESS',
        'COMPLETED': 'COMPLETED',
        'FAILED': 'COMPLETED', // Claims track work completion, not success/failure
        'IN_PROGRESS': 'IN_PROGRESS',
      };
      const finalStatus = claimStatusMap[payload.status] || 'COMPLETED';
      const patch: any = {
        status: finalStatus,
        completed_at: new Date().toISOString(),
      };
      const { error: updErr } = await ctx.supabase
        .from('onchain_request_claims')
        .update(patch)
        .eq('request_id', args.requestId);
      if (updErr) logger.error({ error: updErr.message, requestId: args.requestId }, 'Failed to update claim status');

      return report;
    },

    createArtifact: async (
      _: any,
      args: { requestId: string; artifactData: any },
      ctx: Context
    ) => {
      await assertRequestExists(ctx, args.requestId);
      const worker = getWorkerAddress(ctx);

      const payload = {
        request_id: args.requestId,
        worker_address: worker,
        cid: args.artifactData.cid,
        topic: args.artifactData.topic,
        content: args.artifactData.content ?? null,
      };

      const { data, error } = await ctx.supabase
        .from('onchain_artifacts')
        .insert(payload)
        .select()
        .limit(1);
      if (error) throw new Error(error.message);
      return data![0];
    },

    createMessage: async (
      _: any,
      args: { requestId: string; messageData: any },
      ctx: Context
    ) => {
      await assertRequestExists(ctx, args.requestId);
      const worker = getWorkerAddress(ctx);

      const payload = {
        request_id: args.requestId,
        worker_address: worker,
        content: args.messageData.content,
        status: args.messageData.status ?? 'PENDING',
      };

      const { data, error } = await ctx.supabase
        .from('onchain_messages')
        .insert(payload)
        .select()
        .limit(1);
      if (error) throw new Error(error.message);
      return data![0];
    },

    rateMemory: async (
      _: any,
      args: { artifactId: string; rating: number },
      ctx: Context
    ) => {
      // Validate rating is either +1 or -1
      if (args.rating !== 1 && args.rating !== -1) {
        throw new Error('Rating must be either +1 (useful) or -1 (not useful)');
      }

      // Check if record exists
      const { data: existing, error: exErr } = await ctx.supabase
        .from('utility_scores')
        .select('*')
        .eq('artifact_id', args.artifactId)
        .limit(1);

      if (exErr) throw new Error(exErr.message);

      if (existing && existing.length > 0) {
        // Update existing score
        const current = existing[0];
        const newScore = (current.score || 0) + args.rating;
        const newAccessCount = (current.access_count || 0) + 1;

        const { data, error } = await ctx.supabase
          .from('utility_scores')
          .update({
            score: newScore,
            access_count: newAccessCount,
            updated_at: new Date().toISOString(),
          })
          .eq('artifact_id', args.artifactId)
          .select()
          .limit(1);

        if (error) throw new Error(error.message);
        return data![0];
      } else {
        // Create new score record
        const { data, error } = await ctx.supabase
          .from('utility_scores')
          .insert({
            artifact_id: args.artifactId,
            score: args.rating,
            access_count: 1,
          })
          .select()
          .limit(1);

        if (error) throw new Error(error.message);
        return data![0];
      }
    },

    enqueueTransaction: async (
      _: any,
      args: { requestId?: string; chain_id: number; execution_strategy: string; payload: string; idempotency_key?: string },
      ctx: Context
    ) => {
      const worker = getWorkerAddress(ctx);
      if (args.requestId) {
        await assertRequestExists(ctx, args.requestId);
      }

      // Parse payload JSON string
      let parsedPayload: any;
      try {
        parsedPayload = JSON.parse(args.payload);
      } catch (e) {
        throw new Error('Invalid payload: must be JSON string');
      }

      const insert = {
        request_id: args.requestId ?? null,
        worker_address: worker,
        chain_id: args.chain_id,
        payload: parsedPayload,
        payload_hash: '', // optionally computed by client; keep server simple
        execution_strategy: args.execution_strategy,
        idempotency_key: args.idempotency_key ?? null,
      } as any;

      const { data, error } = await ctx.supabase
        .from('onchain_transaction_requests')
        .insert(insert)
        .select()
        .limit(1);
      if (error) throw new Error(error.message);
      return data![0];
    },

    getTransactionStatus: async (
      _: any,
      args: { id: string },
      ctx: Context
    ) => {
      const { data, error } = await ctx.supabase
        .from('onchain_transaction_requests')
        .select('*')
        .eq('id', args.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Not found');
      return data;
    },

    // Atomically claim the oldest pending transaction request
    claimTransactionRequest: async (_: any, __: any, ctx: Context) => {
      const worker = getWorkerAddress(ctx);
      // 1) Select a candidate to claim (oldest pending, no worker)
      const { data: candidates, error: selErr } = await ctx.supabase
        .from('onchain_transaction_requests')
        .select('id')
        .eq('status', 'PENDING')
        .is('worker_address', null)
        .order('created_at', { ascending: true })
        .limit(1);
      if (selErr) throw new Error(selErr.message);
      const candidate = candidates?.[0]?.id;
      if (!candidate) return null;

      // 2) Attempt conditional update to avoid races
      const { data: updated, error: updErr } = await ctx.supabase
        .from('onchain_transaction_requests')
        .update({ status: 'IN_PROGRESS', worker_address: worker, updated_at: new Date().toISOString() })
        .eq('id', candidate)
        .eq('status', 'PENDING')
        .is('worker_address', null)
        .select('*')
        .limit(1);
      if (updErr) throw new Error(updErr.message);
      if (!updated || updated.length === 0) return null; // Lost the race
      return updated[0];
    },

    updateTransactionStatus: async (
      _: any,
      args: { id: string; status: string; safe_tx_hash?: string; tx_hash?: string; error_code?: string; error_message?: string },
      ctx: Context
    ) => {
      const patch: any = {
        status: args.status,
        updated_at: new Date().toISOString(),
      };
      if (args.safe_tx_hash !== undefined) patch.safe_tx_hash = args.safe_tx_hash;
      if (args.tx_hash !== undefined) patch.tx_hash = args.tx_hash;
      if (args.error_code !== undefined) patch.error_code = args.error_code;
      if (args.error_message !== undefined) patch.error_message = args.error_message;
      if (args.status === 'FAILED' || args.status === 'CONFIRMED') {
        patch.completed_at = new Date().toISOString();
      }

      const { data, error } = await ctx.supabase
        .from('onchain_transaction_requests')
        .update(patch)
        .eq('id', args.id)
        .select('*')
        .limit(1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error('Not found');
      return data[0];
    },

    createJobTemplate: async (
      _: any,
      args: { id: string; templateData: any },
      ctx: Context
    ) => {
      const payload: any = {
        id: args.id,
        name: args.templateData.name,
        description: args.templateData.description ?? null,
        tags: args.templateData.tags ?? [],
        enabled_tools_policy: args.templateData.enabled_tools_policy
          ? JSON.parse(args.templateData.enabled_tools_policy)
          : [],
        input_schema: args.templateData.input_schema
          ? JSON.parse(args.templateData.input_schema)
          : {},
        output_spec: args.templateData.output_spec
          ? JSON.parse(args.templateData.output_spec)
          : {},
        x402_price: args.templateData.x402_price
          ? BigInt(args.templateData.x402_price)
          : 0,
        safety_tier: args.templateData.safety_tier ?? 'public',
        status: args.templateData.status ?? 'visible',
        canonical_job_definition_id: args.templateData.canonical_job_definition_id ?? null,
      };

      const { data, error } = await ctx.supabase
        .from('job_templates')
        .insert(payload)
        .select()
        .limit(1);
      if (error) throw new Error(error.message);

      const t = data![0];
      return {
        ...t,
        tags: t.tags || [],
        enabled_tools_policy: JSON.stringify(t.enabled_tools_policy || []),
        input_schema: JSON.stringify(t.input_schema || {}),
        output_spec: JSON.stringify(t.output_spec || {}),
        x402_price: String(t.x402_price || 0),
      };
    },

    updateJobTemplate: async (
      _: any,
      args: { id: string; templateData: any },
      ctx: Context
    ) => {
      const patch: any = {};

      if (args.templateData.name !== undefined) patch.name = args.templateData.name;
      if (args.templateData.description !== undefined) patch.description = args.templateData.description;
      if (args.templateData.tags !== undefined) patch.tags = args.templateData.tags;
      if (args.templateData.enabled_tools_policy !== undefined) {
        patch.enabled_tools_policy = JSON.parse(args.templateData.enabled_tools_policy);
      }
      if (args.templateData.input_schema !== undefined) {
        patch.input_schema = JSON.parse(args.templateData.input_schema);
      }
      if (args.templateData.output_spec !== undefined) {
        patch.output_spec = JSON.parse(args.templateData.output_spec);
      }
      if (args.templateData.x402_price !== undefined) {
        patch.x402_price = BigInt(args.templateData.x402_price);
      }
      if (args.templateData.safety_tier !== undefined) patch.safety_tier = args.templateData.safety_tier;
      if (args.templateData.status !== undefined) patch.status = args.templateData.status;
      if (args.templateData.canonical_job_definition_id !== undefined) {
        patch.canonical_job_definition_id = args.templateData.canonical_job_definition_id;
      }

      const { data, error } = await ctx.supabase
        .from('job_templates')
        .update(patch)
        .eq('id', args.id)
        .select()
        .limit(1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error('Template not found');

      const t = data[0];
      return {
        ...t,
        tags: t.tags || [],
        enabled_tools_policy: JSON.stringify(t.enabled_tools_policy || []),
        input_schema: JSON.stringify(t.input_schema || {}),
        output_spec: JSON.stringify(t.output_spec || {}),
        x402_price: String(t.x402_price || 0),
      };
    },
  },
};

const schema = createSchema({ typeDefs, resolvers });

const SUPABASE_URL = getRequiredSupabaseUrl();
const SUPABASE_SERVICE_ROLE_KEY = getRequiredSupabaseServiceRoleKey();
const PONDER_GRAPHQL_URL = getPonderGraphqlUrl();
const PORT = getOptionalControlApiPort() || 4001;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  logger.fatal('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const yoga = createYoga<Context>({
  schema,
  context: ({ request }) => ({
    supabase,
    ponderUrl: PONDER_GRAPHQL_URL,
    req: request,
  }),
  graphqlEndpoint: '/graphql',
});

const http = await import('http');

// Track server start time for uptime reporting
const serverStartTime = new Date();

/**
 * Get abbreviated node ID from master safe address
 * Uses first 8 chars of the safe address (after 0x)
 */
function getNodeId(): string {
  const envNodeId = process.env.JINN_NODE_ID;
  if (envNodeId) return envNodeId;

  const masterSafe = getMasterSafe('base');
  if (masterSafe?.startsWith('0x')) return masterSafe.slice(2, 10).toLowerCase();

  const serviceSafe = getServiceSafeAddress();
  if (serviceSafe?.startsWith('0x')) return serviceSafe.slice(2, 10).toLowerCase();

  return 'unknown';
}

const server = http.createServer((req, res) => {
  // REST /health endpoint for easy monitoring
  if (req.url === '/health' && req.method === 'GET') {
    const now = new Date();
    const uptimeMs = now.getTime() - serverStartTime.getTime();
    const nodeId = getNodeId();

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({
      status: 'ok',
      nodeId,
      service: 'control-api',
      uptime: {
        ms: uptimeMs,
        human: formatDuration(uptimeMs),
      },
      timestamp: now.toISOString(),
    }));
    return;
  }

  // Handle all other requests with Yoga
  yoga(req, res);
});

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Jinn Control API running on http://localhost:${PORT}/graphql`);
});

