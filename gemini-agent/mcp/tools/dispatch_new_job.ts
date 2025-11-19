import { z } from 'zod';
import { graphQLRequest } from '../../../http/client.js';
import { randomUUID } from 'node:crypto';
import { marketplaceInteract } from '@jinn-network/mech-client-ts/dist/marketplace_interact.js';
import { getCurrentJobContext } from './shared/context.js';
import { getMechAddress, getMechChainConfig, getServicePrivateKey } from '../../../env/operate-profile.js';
import { getPonderGraphqlUrl } from './shared/env.js';
import { collectLocalCodeMetadata, ensureJobBranch } from '../../shared/code_metadata.js';
import { getCodeMetadataDefaultBaseBranch, getOptionalMechModel } from '../../../config/index.js';

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
  dependencies: z.array(z.string()).optional().describe('Array of job definition IDs that must be fully completed (all requests and child jobs delivered) before this job can execute. Use this to enforce execution order for related job definitions.'),
  skipBranch: z.boolean().optional().default(false).describe('If true, skip branch creation and code metadata collection (for artifact-only jobs)'),
  responseTimeout: z.number().optional().default(3600).describe('Response timeout in seconds for marketplace request. Defaults to 3600 (1 hour). Set higher for long-running jobs with recognition/reflection phases or complex web fetches.'),
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
- dependencies: (optional) Array of job definition IDs that must be fully completed before this job can execute
- responseTimeout: (optional) Response timeout in seconds for marketplace request (defaults to 3600). Set higher for long-running jobs

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

    const { jobName, blueprint, model, enabledTools, message, dependencies, skipBranch, responseTimeout } = parsed.data;

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

    const gqlUrl = getPonderGraphqlUrl();

    // Always create a new job definition with a unique ID
    // Each dispatch_new_job call creates a distinct job instance (node in the work graph)
    const jobDefinitionId: string = ensureUuid();
    const context = getCurrentJobContext();
    const lineageContext: Record<string, any> = {};
    if (context.requestId) lineageContext.sourceRequestId = context.requestId;
    if (context.jobDefinitionId) lineageContext.sourceJobDefinitionId = context.jobDefinitionId;

    // Build additionalContext with message if provided
    // Blueprint and dependencies are now stored at root level, not in additionalContext
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

    const baseBranch =
      (context as any)?.baseBranch ||
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
        console.error('[dispatch_new_job] Branch/metadata collection failed:', branchError.message);
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
      ipfsJsonContents[0].dependencies = dependencies;
    }

    console.error('[dispatch_new_job] codeMetadata check:', {
      hasCodeMetadata: !!codeMetadata,
      hasBranchResult: !!branchResult,
      branchName: branchResult?.branchName,
    });

    if (codeMetadata) {
      ipfsJsonContents[0].codeMetadata = codeMetadata;
    } else if (!skipBranch) {
      console.error('[dispatch_new_job] WARNING: No codeMetadata - job will fail in worker!');
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
      
      console.error('[dispatch_new_job] Calling marketplaceInteract with:', {
        blueprintLength: finalBlueprint.length,
        mech: mechAddress,
        chainConfig,
        toolsCount: (enabledTools || []).length,
        hasIpfsContents: !!ipfsJsonContents,
        hasDependencies: !!(dependencies && dependencies.length > 0),
        env_MECHX_CHAIN_RPC: process.env.MECHX_CHAIN_RPC,
        env_RPC_URL: process.env.RPC_URL,
        env__ENV_LOADED: process.env.__ENV_LOADED,
        env_VITEST: process.env.VITEST,
      });
      
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
      console.error('[dispatch_new_job] marketplaceInteract call completed');

      console.error('[dispatch_new_job] marketplaceInteract result:', {
        hasResult: !!result,
        requestIdsType: result ? typeof result.request_ids : 'n/a',
        requestIdsIsArray: result ? Array.isArray(result.request_ids) : false,
        requestIdsLength: result?.request_ids?.length ?? 0,
        resultKeys: result ? Object.keys(result) : []
      });

      if (!result || !Array.isArray(result.request_ids) || result.request_ids.length === 0) {
        console.error('[dispatch_new_job] Failed - result:', result);
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
          text: JSON.stringify({ 
            data: enriched, 
            meta: { ok: true } 
          }),
        }],
      };
    } catch (error: any) {
      console.error('[dispatch_new_job] EXECUTION_ERROR caught:', {
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
        name: error?.name,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      });
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
