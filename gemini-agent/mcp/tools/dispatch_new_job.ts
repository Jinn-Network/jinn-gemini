import { z } from 'zod';
import { graphQLRequest } from '../../../http/client.js';
import { randomUUID } from 'node:crypto';
import { marketplaceInteract } from '@jinn-network/mech-client-ts/dist/marketplace_interact.js';
import { getCurrentJobContext } from './shared/context.js';
import { getMechAddress, getMechChainConfig, getServicePrivateKey } from '../../../env/operate-profile.js';
import { getPonderGraphqlUrl } from './shared/env.js';
import { collectLocalCodeMetadata, ensureJobBranch } from '../../shared/code_metadata.js';
import { getCodeMetadataDefaultBaseBranch, getOptionalMechModel } from '../../../config/index.js';
import { ensureUniversalTools } from './shared/base-tools.js';

// Blueprint assertion schema matching the style guide
const blueprintAssertionSchema = z.object({
  id: z.string().describe('Unique identifier for this assertion (e.g., "TST-001")'),
  assertion: z.string().min(10).describe('Brief, declarative statement defining a principle, requirement, or constraint'),
  examples: z.object({
    do: z.array(z.string()).min(1).describe('Positive examples showing correct application'),
    dont: z.array(z.string()).min(1).describe('Negative examples showing violation or anti-pattern'),
  }).describe('Two-column guidance with concrete positive and negative examples'),
  commentary: z.string().min(10).describe('Human-readable context explaining the rationale, background, or implications'),
});

const blueprintStructureSchema = z.object({
  assertions: z.array(blueprintAssertionSchema).min(1).describe('Array of assertions defining the job requirements'),
});

const dispatchNewJobParamsBase = z.object({
  jobName: z.string().min(1).describe('Name for this job definition'),
  blueprint: z.string().optional().describe('JSON string containing structured blueprint with assertions array. Each assertion must have: id, assertion, examples (do/dont arrays), and commentary.'),
  model: z.string().optional().describe('Gemini model to use for this job (e.g., "gemini-2.5-flash", "gemini-2.5-pro"). Defaults to MECH_MODEL env var or "gemini-2.5-flash" if not specified.'),
  enabledTools: z.array(z.string()).optional().describe('Array of tool names to enable for this job'),
  message: z.string().optional().describe('Optional message to include in the job request'),
  dependencies: z.array(z.string()).optional().describe('Array of job definition UUIDs (not job names) that must have at least one delivered request before this job can execute. Use get_details or search_jobs to find job definition IDs. Example: ["4eac1570-7980-4e2b-afc7-3f5159e99ea5"]'),
  skipBranch: z.boolean().optional().default(false).describe('If true, skip branch creation and code metadata collection (for artifact-only jobs)'),
  responseTimeout: z.number().optional().default(300).describe('Response timeout in seconds for marketplace request. Defaults to 300 (5 minutes). Maximum allowed by marketplace is 300 seconds.'),
});

export const dispatchNewJobParams = dispatchNewJobParamsBase;

export const dispatchNewJobSchema = {
  description: `Create a new job definition and dispatch a new marketplace request using a structured JSON blueprint.

IMPORTANT: This tool ALWAYS creates a new job definition with a unique ID and posts a new on-chain marketplace request.
- Each call creates a distinct job instance (node in the work graph)
- To re-run an existing job, use dispatch_existing_job instead

BLUEPRINT FORMAT (REQUIRED):
The blueprint must be a JSON string with the following structure:
{
  "assertions": [
    {
      "id": "UNIQUE-ID",
      "assertion": "Brief declarative statement of requirement",
      "examples": {
        "do": ["Positive example 1", "Positive example 2"],
        "dont": ["Negative example 1", "Negative example 2"]
      },
      "commentary": "Explanation of why this assertion exists and its implications"
    }
  ]
}

PARAMETERS:
- jobName: (required) Name for this job definition
- blueprint: (required) JSON string containing structured assertions array as defined above
- model: (optional) Gemini model to use (defaults to MECH_MODEL env var or "gemini-2.5-flash")
- enabledTools: (optional) Array of tool names to enable
- message: (optional) Additional message to include in the job request
- dependencies: (optional) Array of job definition UUIDs (not job names) that must have at least one delivered request before this job executes. Use get_details or search_jobs to find job definition IDs.
- responseTimeout: (optional) Response timeout in seconds for marketplace request (defaults to 300, max 300)

The blueprint is validated and made directly available to the agent in GEMINI.md context.`,
  inputSchema: dispatchNewJobParamsBase.shape,
};

function ensureUuid(): string {
  if (typeof randomUUID === 'function') return randomUUID();
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  throw new Error('crypto.randomUUID not available; cannot generate strict UUID');
}

function getCompletedChildRequestIdsFromEnv(): string[] {
  const raw = process.env.JINN_COMPLETED_CHILDREN;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id: unknown) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function requireChildReviewIfNeeded(): string | null {
  const completedChildIds = getCompletedChildRequestIdsFromEnv();
  if (completedChildIds.length === 0) {
    return null;
  }
  if (process.env.JINN_CHILD_WORK_REVIEWED === 'true') {
    return null;
  }
  const previewIds = completedChildIds.slice(0, 3).join(', ');
  return `Completed child job(s) already exist (${previewIds}). Use the get_details tool with those request IDs (and resolve_ipfs=true) to review their artifacts before dispatching new work.`;
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

    const childReviewMessage = requireChildReviewIfNeeded();
    if (childReviewMessage) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'CHILD_REVIEW_REQUIRED', message: childReviewMessage },
          }),
        }],
      };
    }

    const { jobName, blueprint, model, enabledTools: requestedTools, message, dependencies, skipBranch, responseTimeout } = parsed.data;

    if (!blueprint) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'VALIDATION_ERROR', message: 'blueprint is required and cannot be empty' },
          }),
        }],
      };
    }

    // Validate blueprint structure
    let blueprintObj: any;
    try {
      blueprintObj = JSON.parse(blueprint);
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { 
              ok: false, 
              code: 'INVALID_BLUEPRINT', 
              message: `blueprint must be valid JSON: ${error instanceof Error ? error.message : 'Parse error'}` 
            },
          }),
        }],
      };
    }

    const blueprintValidation = blueprintStructureSchema.safeParse(blueprintObj);
    if (!blueprintValidation.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { 
              ok: false, 
              code: 'INVALID_BLUEPRINT_STRUCTURE', 
              message: `blueprint structure is invalid: ${blueprintValidation.error.message}` 
            },
          }),
        }],
      };
    }

    const finalBlueprint = blueprint;
    const enabledTools = ensureUniversalTools(requestedTools);

    const gqlUrl = getPonderGraphqlUrl();

    // Always create a new job definition with a unique ID
    // Each dispatch_new_job call creates a distinct job instance (node in the work graph)
    const jobDefinitionId: string = ensureUuid();
    const context = getCurrentJobContext();
    const lineageContext: Record<string, any> = {};
    if (context.requestId) lineageContext.sourceRequestId = context.requestId;
    if (context.jobDefinitionId) lineageContext.sourceJobDefinitionId = context.jobDefinitionId;
    if (context.workstreamId) lineageContext.workstreamId = context.workstreamId;

    // Build additionalContext with message if provided
    // Blueprint and dependencies are now stored at root level, not in additionalContext
    let additionalContext: Record<string, any> = {};
    if (message) {
      let messageObj: any = null;
      try {
        const parsedMessage = JSON.parse(message);
        if (parsedMessage && typeof parsedMessage === 'object' && parsedMessage.content) {
          messageObj = parsedMessage;
        }
      } catch {
        // ignore parse error
      }

      additionalContext = {
        message: messageObj || {
          content: message,
          to: jobDefinitionId,
          from: context.jobDefinitionId || undefined,
        }
      };
    }

    const baseBranch =
      context.branchName ||
      context.baseBranch ||
      context.branchName ||
      getCodeMetadataDefaultBaseBranch();

    let branchResult;
    let codeMetadata;
    if (!skipBranch) {
      try {
        branchResult = await ensureJobBranch({
          jobDefinitionId,
          jobName,
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
      } catch (branchError: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              data: null,
              meta: {
                ok: false,
                code: 'BRANCH_ERROR',
                message: `Failed to create job branch or collect metadata: ${branchError.message}`,
              },
            }),
          }],
        };
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

    // IPFS metadata structure: blueprint at root level (not prompt)
    const ipfsJsonContents: any[] = [{
      blueprint: finalBlueprint,
      jobName,
      model: model || getOptionalMechModel() || 'gemini-2.5-flash',
      enabledTools,
      jobDefinitionId,
      nonce: ensureUuid(),
      additionalContext,
      ...(branchResult ? { branchName: branchResult.branchName, baseBranch } : {}),
      ...lineageContext,
    }];

    // Add dependencies at root level if provided
    if (dependencies && dependencies.length > 0) {
      // Validate that all dependencies are UUIDs (not job names)
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const invalidDeps = dependencies.filter(dep => !UUID_REGEX.test(dep));
      
      if (invalidDeps.length > 0) {
        console.error('[dispatch_new_job] Invalid dependencies - must be UUIDs, not job names:', invalidDeps);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              data: null,
              meta: {
                ok: false,
                code: 'INVALID_DEPENDENCIES',
                message: `Dependencies must be job definition UUIDs, not job names. Invalid: ${invalidDeps.join(', ')}. Use get_details or search_jobs to find job definition IDs.`,
              },
            }),
          }],
        };
      }
      
      ipfsJsonContents[0].dependencies = dependencies;
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
        description: 'Agent must work on the provided branch and pass required validations before finalizing.',
      };
    }

    try {
      const mechAddress = getMechAddress();
      const chainConfig = getMechChainConfig();
      const privateKey = getServicePrivateKey();
      
      if (!mechAddress) {
        throw new Error('Service target mech address not configured. Check .operate service config (MECH_TO_CONFIG).');
      }
      
      if (!privateKey) {
        throw new Error('Service agent private key not found. Check .operate/keys directory.');
      }

      // Note: marketplaceInteract still expects 'prompts' parameter for on-chain data field
      // But the actual job specification comes from blueprint in IPFS metadata
      const result = await marketplaceInteract({
        prompts: [finalBlueprint],
        priorityMech: mechAddress,
        tools: enabledTools || [],
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
            try {
              const lookupResult = await graphQLRequest<{
                request: { ipfsHash?: string } | null;
              }>({
                url: gqlUrl,
                query,
                variables: { id: firstRequestId },
                maxRetries: 0,
                context: { operation: 'pollIpfsHash', requestId: firstRequestId, attempt }
              });
              const ipfsHash = lookupResult?.request?.ipfsHash;
              if (ipfsHash) {
                ipfsGatewayUrl = `https://gateway.autonolas.tech/ipfs/${ipfsHash}`;
                break;
              }
            } catch {
              continue;
            }
          }
        }
      } catch (lookupError) {
        // IPFS enrichment is best-effort
      }

      const enriched = {
        ...result,
        jobDefinitionId,
        ipfs_gateway_url: ipfsGatewayUrl,
      };

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            data: enriched, 
            meta: { ok: true } 
          }),
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
