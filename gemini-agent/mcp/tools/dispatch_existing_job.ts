import { z } from 'zod';
import { graphQLRequest } from '../../../http/client.js';
import { marketplaceInteract } from '@jinn-network/mech-client-ts/dist/marketplace_interact.js';
import { getCurrentJobContext } from './shared/context.js';
import { getJobContextForDispatch } from './shared/job-context-utils.js';
import { getMechAddress, getMechChainConfig, getServicePrivateKey } from '../../../env/operate-profile.js';
import { getPonderGraphqlUrl } from './shared/env.js';
import { collectLocalCodeMetadata, ensureJobBranch } from '../../shared/code_metadata.js';
import { getCodeMetadataDefaultBaseBranch } from '../../../config/index.js';

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

  const gqlUrl = getPonderGraphqlUrl();

  // Find job definition by id or name
  let jobDef: any | null = null;
  try {
    if (jobId) {
      const result = await graphQLRequest<{
        jobDefinition: {
          id: string;
          name: string;
          enabledTools?: string;
          promptContent?: string;
        } | null;
      }>({
        url: gqlUrl,
        query: `query($id: String!) { jobDefinition(id: $id) { id name enabledTools promptContent } }`,
        variables: { id: jobId },
        maxRetries: 1,
        context: { operation: 'getJobById', jobId }
      });
      jobDef = result?.jobDefinition || null;
    } else if (jobName) {
      const result = await graphQLRequest<{
        jobDefinitions: {
          items: Array<{
            id: string;
            name: string;
            enabledTools?: string;
            promptContent?: string;
          }>;
        };
      }>({
        url: gqlUrl,
        query: `query($name: String!) { jobDefinitions(where: { name: $name }, limit: 1) { items { id name enabledTools promptContent } } }`,
        variables: { name: jobName },
        maxRetries: 1,
        context: { operation: 'getJobByName', jobName }
      });
      jobDef = result?.jobDefinitions?.items?.[0] || null;
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

  const baseBranch =
    (context as any)?.baseBranch ||
    getCodeMetadataDefaultBaseBranch();

  const branchResult = await ensureJobBranch({
    jobDefinitionId,
    jobName: name,
    baseBranch,
  });

  const metadataHints = {
    jobDefinitionId,
    parent:
      context.jobDefinitionId || context.requestId
        ? {
            jobDefinitionId: context.jobDefinitionId || undefined,
            requestId: context.requestId || undefined,
          }
        : undefined,
    baseBranch,
    branchName: branchResult.branchName,
  };

  const codeMetadata = await collectLocalCodeMetadata(metadataHints);

  const ipfsJsonContents: any[] = [{
    prompt: finalPrompt,
    jobName: name,
    enabledTools: finalTools,
    jobDefinitionId,
    additionalContext,
    branchName: branchResult.branchName,
    baseBranch,
    ...lineageContext,
  }];

  if (codeMetadata) {
    ipfsJsonContents[0].codeMetadata = codeMetadata;
  }

  ipfsJsonContents[0].executionPolicy = {
    branch: branchResult.branchName,
    ensureTestsPass: true,
    description: 'Agent must execute work on the provided branch and pass required validations before finalizing.',
  };

    try {
      const priorityMech = getMechAddress();
      const privateKey = getServicePrivateKey();
      const chainConfig = getMechChainConfig();

      if (!priorityMech) {
        throw new Error('Service target mech address not configured. Check .operate service config (MECH_TO_CONFIG).');
      }

      if (!privateKey) {
        throw new Error('Service agent private key not found. Check .operate/keys directory.');
      }

      const result = await marketplaceInteract({
        prompts: [finalPrompt],
        priorityMech,
        tools: finalTools,
        ipfsJsonContents,
        chainConfig,
        keyConfig: { source: 'value', value: privateKey },
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
