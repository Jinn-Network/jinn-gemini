import { z } from 'zod';
import fetch from 'cross-fetch';
import { marketplaceInteract } from '../../../packages/mech-client-ts/dist/marketplace_interact.js';
import { getCurrentJobContext } from './shared/context.js';
import { getJobContextForDispatch } from './shared/job-context-utils.js';

const dispatchExistingJobParamsBase = z.object({
  jobId: z.string().uuid().optional(),
  jobName: z.string().min(1).optional(),
  // Optional overrides for tools/prompt if caller wants to tweak minor fields
  // If not provided, we use the values from the job definition as-is
  enabledTools: z.array(z.string()).optional(),
  prompt: z.string().optional(),
  message: z.string().optional(),
});

export const dispatchExistingJobParams = dispatchExistingJobParamsBase.refine(
  (v) => !!v.jobId || !!v.jobName,
  { message: 'Provide jobId or jobName' },
);

export const dispatchExistingJobSchema = {
  description: 'Dispatch an existing job definition by ID or name to the marketplace. Looks up the job in the subgraph and posts a new request anchored to its jobDefinitionId.',
  inputSchema: dispatchExistingJobParamsBase.shape,
};

export async function dispatchExistingJob(args: unknown) {
  if (process.env.MCP_DEBUG_MECH_CLIENT === '1') {
    try {
      const { createRequire } = await import('node:module');
      const r = (createRequire as any)(import.meta.url);
      const resolved = r.resolve('mech-client-ts/dist/marketplace_interact.js');
      console.error('[mcp-debug] mech-client resolve =', resolved);
    } catch {}
  }
  const parse = dispatchExistingJobParams.safeParse(args);
  if (!parse.success) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: parse.error.message } }) }] };
  }
  const { jobId, jobName, enabledTools: overridesTools, prompt: overridePrompt, message } = parse.data;

  const gqlUrl = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';

  // Find job definition by id or name
  let jobDef: any | null = null;
  try {
    if (jobId) {
      const res = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query($id: String!) { jobDefinition(id: $id) { id name enabledTools promptContent } }`,
          variables: { id: jobId },
        }),
      });
      const json = await res.json();
      jobDef = json?.data?.jobDefinition || null;
    } else if (jobName) {
      const res = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query($name: String!) { jobDefinitions(where: { name: { equals: $name } }, limit: 1) { items { id name enabledTools promptContent } } }`,
          variables: { name: jobName },
        }),
      });
      const json = await res.json();
      jobDef = json?.data?.jobDefinitions?.items?.[0] || null;
    }
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'SUBGRAPH_ERROR', message: e?.message || String(e) } }) }] };
  }

  if (!jobDef) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'NOT_FOUND', message: 'Job definition not found' } }) }] };
  }

  const jobDefinitionId: string = jobDef.id;
  const name: string = jobDef.name;
  const baseTools: string[] | undefined = Array.isArray(jobDef.enabledTools) ? jobDef.enabledTools : undefined;
  const basePrompt: string | undefined = typeof jobDef.promptContent === 'string' ? jobDef.promptContent : undefined;

  const finalTools = overridesTools ?? baseTools ?? [];
  const finalPrompt = overridePrompt ?? basePrompt ?? '';
  if (!finalPrompt) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'MISSING_PROMPT', message: 'No prompt content available to dispatch.' } }) }] };
  }

  // Build request payload mirroring post_marketplace_job expectations
  const context = getCurrentJobContext();
  const lineageContext: Record<string, any> = {};
  if (context.requestId) lineageContext.sourceRequestId = context.requestId;
  if (context.jobDefinitionId) lineageContext.sourceJobDefinitionId = context.jobDefinitionId;

  // Fetch job context for the existing job being dispatched
  const jobContext = await getJobContextForDispatch(jobDefinitionId, 3);

  // Build additionalContext with job context and message
  let additionalContext: any = {};

  // Include hierarchy and summary if job context was successfully fetched
  if (jobContext) {
    additionalContext.hierarchy = jobContext.hierarchy;
    additionalContext.summary = jobContext.summary;
  }

  // Add message to additionalContext if provided
  // This is CRITICAL for Work Protocol - message must always be preserved
  if (message) {
    // Try to parse message as JSON (for structured messages from worker)
    let messageObj: any = null;
    try {
      const parsed = JSON.parse(message);
      // If it's already a structured message with content/to/from, use it directly
      if (parsed && typeof parsed === 'object' && parsed.content) {
        messageObj = parsed;
      }
    } catch {
      // Not JSON, treat as plain string
    }

    // Use parsed structure if available, otherwise create envelope
    if (messageObj) {
      additionalContext.message = messageObj;
    } else {
      additionalContext.message = {
        content: message,
        to: jobDefinitionId,
        from: context.jobDefinitionId || undefined,
      };
    }
  }

  const ipfsJsonContents = [{
    prompt: finalPrompt,
    jobName: name,
    enabledTools: finalTools,
    jobDefinitionId,
    additionalContext,
    ...lineageContext,
  }];

  try {
    const result = await (marketplaceInteract as any)({
      prompts: [finalPrompt],
      priorityMech: '0xaB15F8d064b59447Bd8E9e89DD3FA770aBF5EEb7',
      tools: finalTools,
      ipfsJsonContents,
      chainConfig: 'base',
      postOnly: true,
    });

    if (!result || !Array.isArray(result.request_ids) || result.request_ids.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: result ?? null,
            meta: {
              ok: false,
              code: 'DISPATCH_FAILED',
              message: 'Marketplace dispatch did not return any request IDs. Check RPC quota, funding, or mech configuration.',
            },
          }),
        }],
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ data: { ...result, jobDefinitionId }, meta: { ok: true } }),
      }],
    };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'EXECUTION_ERROR', message: e?.message || String(e) } }) }] };
  }
}

