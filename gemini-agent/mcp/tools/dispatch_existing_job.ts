import { z } from 'zod';
import { graphQLRequest } from '../../../http/client.js';
import { marketplaceInteract } from '@jinn-network/mech-client-ts/dist/marketplace_interact.js';
import { getCurrentJobContext } from './shared/context.js';
import { getJobContextForDispatch } from './shared/job-context-utils.js';
import { getMechAddress, getMechChainConfig, getServicePrivateKey } from '../../../env/operate-profile.js';
import { getPonderGraphqlUrl } from './shared/env.js';
import { collectLocalCodeMetadata, ensureJobBranch } from '../../shared/code_metadata.js';
import { getCodeMetadataDefaultBaseBranch } from '../../../config/index.js';
import { ensureUniversalTools } from './shared/base-tools.js';

const dispatchExistingJobParamsBase = z.object({
  jobId: z.string().uuid().optional(),
  jobName: z.string().min(1).optional(),
  // Optional overrides for tools/blueprint if caller wants to tweak minor fields
  // If not provided, we use the values from the job definition as-is
  enabledTools: z.array(z.string()).optional(),
  prompt: z.string().optional().describe('DEPRECATED: Use blueprint instead. For backward compatibility only.'),
  message: z.string().optional(),
  workstreamId: z.string().optional().describe('Workstream ID to preserve when re-dispatching parent jobs. If provided, ensures the new request maintains the same workstream as the child that triggered it.'),
  responseTimeout: z.number().optional().default(300).describe('Response timeout in seconds for marketplace request. Defaults to 300 (5 minutes). Maximum allowed by marketplace is 300 seconds.'),
  additionalContext: z.record(z.unknown()).optional().describe('Additional context to pass to the job, as a key-value object.'),
});

export const dispatchExistingJobParams = dispatchExistingJobParamsBase.refine(
  (v) => !!v.jobId || !!v.jobName,
  { message: 'Provide jobId or jobName' },
);

export const dispatchExistingJobSchema = {
  description: `Dispatch an existing job definition by ID or name to the marketplace. ONLY use this if you know the job definition already exists in Ponder (e.g., you previously created it with dispatch_new_job). For new job definitions, use dispatch_new_job instead. This tool looks up the job in Ponder and posts a new request anchored to its jobDefinitionId. The job definition must have a blueprint; prompt-based jobs are no longer supported.

WHEN TO USE THIS TOOL:
- Re-running an existing job definition (iteration/retry)
- You want multiple requests to share the same job container and workstream
- Continuing work in an established job context
- You can reference by job definition ID or job name

WHEN NOT TO USE (use dispatch_new_job instead):
- Creating a new child job with a different purpose
- Breaking work into new sub-tasks that don't have job definitions yet`,
  inputSchema: dispatchExistingJobParamsBase.passthrough().shape,
};

export async function dispatchExistingJob(args: unknown) {
  if (process.env.MCP_DEBUG_MECH_CLIENT === '1') {
    try {
      const { createRequire } = await import('node:module');
      const r = (createRequire as any)(import.meta.url);
      const resolved = r.resolve('mech-client-ts/dist/marketplace_interact.js');
      console.error('[mcp-debug] mech-client resolve =', resolved);
    } catch { }
  }
  const parse = dispatchExistingJobParams.safeParse(args);
  if (!parse.success) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: parse.error.message } }) }] };
  }
  const { jobId, jobName, enabledTools: overridesTools, prompt: overridePrompt, message, workstreamId: explicitWorkstreamId, responseTimeout, additionalContext: extraContext } = parse.data;

  // Auto-populate workstreamId from context if not explicitly provided
  const context = getCurrentJobContext();
  const workstreamId = explicitWorkstreamId || context.workstreamId || undefined;

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
          blueprint?: string;
          codeMetadata?: any;
        } | null;
      }>({
        url: gqlUrl,
        query: `query($id: String!) { jobDefinition(id: $id) { id name enabledTools blueprint codeMetadata } }`,
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
            blueprint?: string;
            codeMetadata?: any;
          }>;
        };
      }>({
        url: gqlUrl,
        query: `query($name: String!) { jobDefinitions(where: { name: $name }, limit: 1) { items { id name enabledTools blueprint codeMetadata } } }`,
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
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'NOT_FOUND', message: `Job definition '${jobName || jobId}' not found in Ponder. Use dispatch_new_job to create it first.` } }) }] };
  }

  const jobDefinitionId: string = jobDef.id;
  const name: string = jobDef.name;
  const baseTools: string[] | undefined = Array.isArray(jobDef.enabledTools) ? jobDef.enabledTools : undefined;
  const baseBlueprint: string | undefined = typeof jobDef.blueprint === 'string' ? jobDef.blueprint : undefined;

  const requestedTools = overridesTools
    ? [...(baseTools ?? []), ...overridesTools]  // Merge: base tools + override tools
    : baseTools ?? [];
  const finalTools = ensureUniversalTools(requestedTools);
  const finalBlueprint = overridePrompt ?? baseBlueprint ?? '';
  if (!finalBlueprint) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'MISSING_BLUEPRINT', message: 'No blueprint content available to dispatch. Use dispatch_new_job to create a job definition with a blueprint first.' } }) }] };
  }

  // Build request payload mirroring post_marketplace_job expectations
  const lineageContext: Record<string, any> = {};

  // Always set sourceRequestId/sourceJobDefinitionId when available
  // This ensures proper hierarchy tracking even when workstreamId is preserved
  if (context.requestId) lineageContext.sourceRequestId = context.requestId;
  if (context.jobDefinitionId) lineageContext.sourceJobDefinitionId = context.jobDefinitionId;

  // Fetch job context for the existing job being dispatched
  const jobContext = await getJobContextForDispatch(jobDefinitionId, 3);

  // Build additionalContext with job context and message
  let additionalContext: any = {};
  if (extraContext) {
    if (typeof extraContext === 'string') {
      try {
        additionalContext = JSON.parse(extraContext);
      } catch {
        additionalContext = {};
      }
    } else if (typeof extraContext === 'object') {
      additionalContext = { ...extraContext };
    }
  }

  if (jobContext) {
    if (!additionalContext.hierarchy) {
      additionalContext.hierarchy = jobContext.hierarchy;
    }
    if (!additionalContext.summary) {
      additionalContext.summary = jobContext.summary;
    }
  }

  // Add message to additionalContext if provided
  // This is CRITICAL for Work Protocol - message must always be preserved
  if (message) {
    let messageObj: any = null;
    try {
      const parsed = JSON.parse(message);
      if (parsed && typeof parsed === 'object' && parsed.content) {
        messageObj = parsed;
      }
    } catch {
      // ignore
    }

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

  const deterministicArtifactCount = Array.isArray(additionalContext.completedChildRuns)
    ? additionalContext.completedChildRuns.reduce((sum: number, run: any) => {
      if (!Array.isArray(run?.artifacts)) return sum;
      return sum + run.artifacts.filter((artifact: any) => Boolean(artifact?.cid || artifact?.id)).length;
    }, 0)
    : 0;

  if (deterministicArtifactCount > 0) {
    if (!additionalContext.summary || typeof additionalContext.summary !== 'object') {
      additionalContext.summary = {
        totalJobs: jobContext?.hierarchy?.length ?? 0,
        completedJobs: jobContext?.summary?.completedJobs ?? 0,
        activeJobs: jobContext?.summary?.activeJobs ?? 0,
        totalArtifacts: deterministicArtifactCount,
        hasErrors: jobContext?.summary?.hasErrors ?? false,
      };
    } else {
      additionalContext.summary.totalArtifacts =
        (additionalContext.summary.totalArtifacts || 0) + deterministicArtifactCount;
    }
  }

  const baseBranch =
    context.branchName ||
    context.baseBranch ||
    context.branchName ||
    getCodeMetadataDefaultBaseBranch();

  let branchResult: any = null;
  let codeMetadata: any = null;

  // PRIORITY: Use existing codeMetadata from job definition if it has valid repo.remoteUrl
  // This avoids re-collecting git metadata which can fail if branches don't have upstream tracking
  // See Gotcha #32: Parent job looked in wrong location due to failed git remote fetch during re-dispatch
  const existingCodeMetadata = jobDef.codeMetadata;
  if (existingCodeMetadata?.repo?.remoteUrl) {
    codeMetadata = existingCodeMetadata;
    // Derive branchResult from existing metadata for IPFS payload consistency
    branchResult = {
      branchName: existingCodeMetadata.branch?.name,
      baseBranch: existingCodeMetadata.baseBranch,
      created: false,
      pushed: false,
    };
    console.log('[dispatch_existing_job] Using existing codeMetadata from job definition');
  } else {
    // Fall back to collecting fresh metadata (original dispatch or artifact-only jobs)
    try {
      branchResult = await ensureJobBranch({
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

      codeMetadata = await collectLocalCodeMetadata(metadataHints);
    } catch (codeMetadataError: any) {
      // Code metadata collection failed - this is acceptable for artifact-only jobs
      // Log the error but continue with dispatch
      console.error('[dispatch_existing_job] Code metadata collection skipped:', codeMetadataError.message);
    }
  }

  const lineage =
    context.requestId ||
      context.jobDefinitionId ||
      context.parentRequestId ||
      context.branchName ||
      context.baseBranch
      ? {
        dispatcherRequestId: context.requestId || undefined,
        dispatcherJobDefinitionId: context.jobDefinitionId || undefined,
        parentDispatcherRequestId: context.parentRequestId || undefined,
        dispatcherBranchName: context.branchName || undefined,
        dispatcherBaseBranch: context.baseBranch || undefined,
      }
      : undefined;

  const ipfsJsonContents: any[] = [{
    networkId: 'jinn', // Identify Jinn network requests for Ponder filtering
    blueprint: finalBlueprint,
    jobName: name,
    enabledTools: finalTools,
    jobDefinitionId,
    additionalContext,
    ...lineageContext,
  }];

  // Include workstreamId if provided (for parent re-dispatches)
  if (workstreamId) {
    ipfsJsonContents[0].workstreamId = workstreamId;
  }

  // Only include branch info if we successfully collected it
  if (branchResult) {
    ipfsJsonContents[0].branchName = branchResult.branchName;
    ipfsJsonContents[0].baseBranch = branchResult.baseBranch || getCodeMetadataDefaultBaseBranch();
  }

  if (lineage) {
    ipfsJsonContents[0].lineage = lineage;
  }

  if (codeMetadata) {
    ipfsJsonContents[0].codeMetadata = codeMetadata;
  }

  if (branchResult) {
    ipfsJsonContents[0].executionPolicy = {
      branch: branchResult.branchName,
      ensureTestsPass: true,
      description: 'Agent must execute work on the provided branch and pass required validations before finalizing.',
    };
  }

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
      prompts: [finalBlueprint],
      priorityMech,
      tools: finalTools,
      ipfsJsonContents,
      chainConfig,
      keyConfig: { source: 'value', value: privateKey },
      postOnly: true,
      responseTimeout,
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
