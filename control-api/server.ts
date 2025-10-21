import { createYoga, createSchema } from 'graphql-yoga';
import { createClient } from '@supabase/supabase-js';
import fetch from 'cross-fetch';
import dotenv from 'dotenv';
import { logger, serializeError } from '../logging/index.js';

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

  type Mutation {
    claimRequest(requestId: String!): RequestClaim!
    createJobReport(requestId: String!, reportData: JobReportInput!): JobReport!
    createArtifact(requestId: String!, artifactData: ArtifactInput!): Artifact!
    createMessage(requestId: String!, messageData: MessageInput!): Message!
    enqueueTransaction(requestId: String, chain_id: Int!, execution_strategy: String!, payload: String!, idempotency_key: String): TransactionRequest!
    getTransactionStatus(id: String!): TransactionRequest!
    claimTransactionRequest: TransactionRequest
    updateTransactionStatus(id: String!, status: String!, safe_tx_hash: String, tx_hash: String, error_code: String, error_message: String): TransactionRequest!
  }

  type Query {
    _health: String!
  }
`;

async function assertRequestExists(ctx: Context, requestId: string) {
  if (!ctx.ponderUrl) return; // allow skip if not configured
  const body = {
    query: `query($id: String!) { request(id: $id) { id } }`,
    variables: { id: requestId },
  };
  try {
    const res = await fetch(`${ctx.ponderUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json?.data?.request?.id) {
      throw new Error(`Unknown request_id: ${requestId}`);
    }
  } catch (error) {
    logger.error({ error: serializeError(error) }, 'Ponder validation failed');
    throw new Error(`Request validation failed: ${error instanceof Error ? error.message : String(error)}`);
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
  },
  Mutation: {
    claimRequest: async (_: any, args: { requestId: string }, ctx: Context) => {
      await assertRequestExists(ctx, args.requestId);
      const worker = getWorkerAddress(ctx);

      // Fetch existing claim
      const { data: existing, error: exErr } = await ctx.supabase
        .from('onchain_request_claims')
        .select('*')
        .eq('request_id', args.requestId)
        .limit(1)
        .maybeSingle();
      if (exErr) throw new Error(exErr.message);

      // If already claimed and not completed, return existing (do not re-claim)
      if (existing && existing.status !== 'COMPLETED') {
        return existing;
      }

      // Otherwise, (re)claim for this worker
      const insertPayload = {
        request_id: args.requestId,
        worker_address: worker,
        status: 'IN_PROGRESS',
        claimed_at: new Date().toISOString(),
        completed_at: null,
      } as any;

      const { data: created, error: insErr } = await ctx.supabase
        .from('onchain_request_claims')
        .upsert(insertPayload, { onConflict: 'request_id' })
        .select('*')
        .limit(1);
      if (insErr) throw new Error(insErr.message);
      return created![0];
    },

    createJobReport: async (
      _: any,
      args: { requestId: string; reportData: any },
      ctx: Context
    ) => {
      await assertRequestExists(ctx, args.requestId);
      const worker = getWorkerAddress(ctx);

      const payload = {
        request_id: args.requestId,
        worker_address: worker,
        status: args.reportData.status,
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
      if (error) throw new Error(error.message);
      const report = data![0];

      // Update claim status based on report outcome
      const finalStatus = payload.status && payload.status !== 'IN_PROGRESS' ? payload.status : 'COMPLETED';
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
  },
};

const schema = createSchema({ typeDefs, resolvers });

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || `http://localhost:${process.env.PONDER_PORT || '42069'}/graphql`;
const PORT = parseInt(process.env.CONTROL_API_PORT || '4001', 10);

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
const server = http.createServer(yoga);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Jinn Control API running on http://localhost:${PORT}/graphql`);
});


