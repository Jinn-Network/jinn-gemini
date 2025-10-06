import { z } from 'zod';
import fetch from 'cross-fetch';
import { randomUUID } from 'node:crypto';
import { marketplaceInteract } from 'mech-client-ts/dist/marketplace_interact.js';
import { getCurrentJobContext } from './shared/context.js';

const dispatchNewJobParamsBase = z.object({
  objective: z.string().min(10).describe('Clear, specific statement of what needs to be accomplished'),
  context: z.string().min(20).describe('Why this work is needed and how it fits into the broader goal. Include relevant background from parent job.'),
  deliverables: z.string().optional().describe('Expected outputs or artifacts to be created'),
  acceptanceCriteria: z.string().min(10).describe('Specific, measurable criteria for successful completion (what "done" looks like)'),
  constraints: z.string().optional().describe('Limitations, requirements, dependencies, or important considerations'),
  jobName: z.string().min(1),
  enabledTools: z.array(z.string()).optional(),
  updateExisting: z.boolean().optional().default(false),
  message: z.string().optional(),
});

export const dispatchNewJobParams = dispatchNewJobParamsBase;

export const dispatchNewJobSchema = {
  description: `Create or update a job definition and dispatch a marketplace request using structured prompt fields for high-quality work delegation.

STRUCTURED PROMPT FIELDS (all required except deliverables/constraints):
- objective: Clear, specific statement of what needs to be accomplished (min 10 chars)
- context: Why this work is needed and how it fits the broader goal. Include relevant background from parent job. (min 20 chars)
- deliverables: (optional) Expected outputs or artifacts to be created
- acceptanceCriteria: Specific, measurable criteria for successful completion - what "done" looks like (min 10 chars)
- constraints: (optional) Limitations, requirements, dependencies, or important considerations

These fields are assembled into a well-structured prompt that preserves context through delegation levels.`,
  inputSchema: dispatchNewJobParamsBase.shape,
};

function ensureUuid(): string {
  if (typeof randomUUID === 'function') return randomUUID();
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  throw new Error('crypto.randomUUID not available; cannot generate strict UUID');
}

function constructPrompt(params: {
  objective: string;
  context: string;
  deliverables?: string;
  acceptanceCriteria: string;
  constraints?: string;
}): string {
  let prompt = `# Objective
${params.objective}

# Context
${params.context}`;

  if (params.deliverables) {
    prompt += `\n\n# Deliverables\n${params.deliverables}`;
  }

  prompt += `\n\n# Acceptance Criteria
${params.acceptanceCriteria}`;

  if (params.constraints) {
    prompt += `\n\n# Constraints\n${params.constraints}`;
  }

  return prompt;
}

export async function dispatchNewJob(args: unknown) {
  try {
    if (process.env.MCP_DEBUG_MECH_CLIENT === '1') {
      try {
        const { createRequire } = await import('node:module');
        const r = (createRequire as any)(import.meta.url);
        const resolved = r.resolve('mech-client-ts/dist/marketplace_interact.js');
        console.error('[mcp-debug] mech-client resolve =', resolved);
      } catch {}
    }
    const parsed = dispatchNewJobParams.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message },
          }),
        }],
      };
    }

    const { objective, context: promptContext, deliverables, acceptanceCriteria, constraints, jobName, enabledTools, updateExisting, message } = parsed.data;

    // Assemble structured fields into a single prompt string for IPFS storage
    const prompt = constructPrompt({ objective, context: promptContext, deliverables, acceptanceCriteria, constraints });

    const gqlUrl = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';

    let existingJob: any | null = null;
    try {
      const resp = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query($name: String!) { jobDefinitions(where: { name: { equals: $name } }, limit: 1) { items { id name enabledTools promptContent } } }`,
          variables: { name: jobName },
        }),
      });
      const json = await resp.json();
      existingJob = json?.data?.jobDefinitions?.items?.[0] || null;
    } catch (error) {
      // Duplicate detection is best-effort; ignore lookup failures
      console.warn('dispatch_new_job: subgraph lookup failed', error);
    }

    if (existingJob && !updateExisting) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: existingJob,
            meta: {
              ok: true,
              code: 'JOB_EXISTS',
              message: 'Job already exists. Set updateExisting=true to reuse or call dispatch_existing_job.',
            },
          }),
        }],
      };
    }

    const jobDefinitionId: string = existingJob?.id || ensureUuid();
    const context = getCurrentJobContext();
    const lineageContext: Record<string, any> = {};
    if (context.requestId) lineageContext.sourceRequestId = context.requestId;
    if (context.jobDefinitionId) lineageContext.sourceJobDefinitionId = context.jobDefinitionId;

    // Build additionalContext with message if provided
    // Always initialize as object to ensure it's included in IPFS even if empty
    let additionalContext: Record<string, any> = {};
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
      additionalContext = {
        message: messageObj || {
          content: message,
          to: jobDefinitionId,
          from: context.jobDefinitionId || undefined,
        }
      };
    }

    const ipfsJsonContents = [{
      prompt,
      jobName,
      enabledTools,
      jobDefinitionId,
      nonce: ensureUuid(),
      additionalContext,
      ...lineageContext,
    }];

    try {
      const result = await (marketplaceInteract as any)({
        prompts: [prompt],
        priorityMech: '0xaB15F8d064b59447Bd8E9e89DD3FA770aBF5EEb7',
        tools: enabledTools || [],
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
                message: 'Marketplace dispatch did not return any request IDs. Verify MECH configuration, funding, and private key setup.',
              },
            }),
          }],
        };
      }

      let ipfsGatewayUrl: string | null = null;
      try {
        const firstRequestId = Array.isArray(result?.request_ids) ? result.request_ids[0] : undefined;
        if (firstRequestId && gqlUrl) {
          const query = `query ($id: String!) { request(id: $id) { ipfsHash } }`;
          for (let attempt = 0; attempt < 5; attempt++) {
            if (attempt > 0) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
            const lookup = await fetch(gqlUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query, variables: { id: firstRequestId } }),
            });
            if (!lookup.ok) continue;
            const json = await lookup.json();
            const ipfsHash = json?.data?.request?.ipfsHash as string | undefined;
            if (ipfsHash) {
              ipfsGatewayUrl = `https://gateway.autonolas.tech/ipfs/${ipfsHash}`;
              break;
            }
          }
        }
      } catch (lookupError) {
        console.warn('dispatch_new_job: ipfs enrichment failed', lookupError);
      }

      const enriched = {
        ...result,
        jobDefinitionId,
        ipfs_gateway_url: ipfsGatewayUrl,
      };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ data: enriched, meta: { ok: true } }),
        }],
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'EXECUTION_ERROR', message: error?.message || String(error) },
          }),
        }],
      };
    }
  } catch (error: any) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: null,
          meta: { ok: false, code: 'UNEXPECTED_ERROR', message: error?.message || String(error) },
        }),
      }],
    };
  }
}
