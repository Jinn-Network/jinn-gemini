import { z } from 'zod';
import { graphQLRequest } from '../../../http/client.js';
import { randomUUID } from 'node:crypto';
import { marketplaceInteract } from '@jinn-network/mech-client-ts/dist/marketplace_interact.js';
import { getCurrentJobContext } from './shared/context.js';
import { getMechAddress, getMechChainConfig, getServicePrivateKey } from '../../../env/operate-profile.js';
import { getPonderGraphqlUrl } from './shared/env.js';
import { buildIpfsPayload } from '../../shared/ipfs-payload-builder.js';
import { validateInvariantsStrict } from '../../../worker/prompt/invariant-validator.js';
import { buildAnnotatedTools } from '../../shared/template-tools.js';
import { blueprintStructureSchema } from '../../shared/blueprint-schema.js';
import { BASE_UNIVERSAL_TOOLS } from '../../toolPolicy.js';

const dispatchNewJobParamsBase = z.object({
  jobName: z.string().min(1).describe('Name for this job definition'),
  blueprint: z.string().optional().describe('JSON string containing structured blueprint with invariants array. Each invariant must have: id, type (FLOOR/CEILING/RANGE/BOOLEAN), assessment, and type-specific fields (metric+min for FLOOR, metric+max for CEILING, metric+min+max for RANGE, condition for BOOLEAN). Optional: examples.'),
  model: z.string().optional().describe('Gemini model to use for this job (e.g., "gemini-3-flash-preview", "gemini-2.5-pro"). Defaults to "gemini-3-flash-preview" if not specified.'),
  enabledTools: z.array(z.string()).optional().describe('Array of tool names to enable for this job'),
  message: z.string().optional().describe('Optional message to include in the job request'),
  dependencies: z.array(z.string()).optional().describe('Array of job definition UUIDs (not job names) that must have at least one delivered request before this job can execute. Use get_details or search_jobs to find job definition IDs. Example: ["4eac1570-7980-4e2b-afc7-3f5159e99ea5"]'),
  skipBranch: z.boolean().optional().default(false).describe('If true, skip branch creation and code metadata collection. Auto-detected: branches are automatically skipped when CODE_METADATA_REPO_ROOT is not set and no parent branch context exists (artifact-only mode).'),
  responseTimeout: z.number().optional().default(300).describe('Response timeout in seconds for marketplace request. Defaults to 300 (5 minutes). Maximum allowed by marketplace is 300 seconds.'),
  inputSchema: z.record(z.any()).optional().describe('Input schema for template defaults. Used by x402 gateway to substitute default values for optional fields.'),
});

export const dispatchNewJobParams = dispatchNewJobParamsBase;

export const dispatchNewJobSchema = {
  description: `Create a new job definition and dispatch a new marketplace request using a structured JSON blueprint.

IMPORTANT: This tool ALWAYS creates a new job definition with a unique ID and posts a new on-chain marketplace request.
- Each call creates a distinct job instance (node in the work graph)
- To re-run an existing job, use dispatch_existing_job instead

WHEN TO USE THIS TOOL:
- Creating a new child job with a different purpose than existing jobs
- Breaking work into new sub-tasks that don't have job definitions yet
- Each call creates a brand new job definition with a new UUID

WHEN NOT TO USE (use dispatch_existing_job instead):
- Re-running an existing job definition (iteration/retry)
- You want multiple requests to share the same job container and workstream
- Continuing work in an established job context

BLUEPRINT FORMAT (REQUIRED):
The blueprint must be a JSON string with an invariants array. Each invariant has:
- id: Unique identifier (e.g., "JOB-001")
- type: One of "FLOOR", "CEILING", "RANGE", or "BOOLEAN"
- assessment: How to verify/measure this invariant
- Type-specific fields:
  - FLOOR: metric (string), min (number) - "metric must be at least min"
  - CEILING: metric (string), max (number) - "metric must be at most max"
  - RANGE: metric (string), min (number), max (number) - "metric must be between min and max"
  - BOOLEAN: condition (string) - "condition must be true"

Example with all four types:
{
  "invariants": [
    {
      "id": "QUAL-001",
      "type": "FLOOR",
      "metric": "content_quality_score",
      "min": 70,
      "assessment": "Rate 0-100 based on originality and depth"
    },
    {
      "id": "COST-001",
      "type": "CEILING",
      "metric": "compute_cost_usd",
      "max": 20,
      "assessment": "Sum API costs from telemetry"
    },
    {
      "id": "FREQ-001",
      "type": "RANGE",
      "metric": "posts_per_week",
      "min": 3,
      "max": 7,
      "assessment": "Count posts published in last 7 days"
    },
    {
      "id": "BUILD-001",
      "type": "BOOLEAN",
      "condition": "You ensure the build passes without errors",
      "assessment": "Run yarn build and verify exit code is 0"
    }
  ]
}

INVARIANT SCOPING (CRITICAL):
When creating child jobs, write NEW invariants specific to that child's responsibility.
Do NOT copy-paste parent invariants that span multiple concerns.
Example - If parent has "ship 3 games: Snake, 2048, Minesweeper":
  - 2048-child: { type: "BOOLEAN", condition: "You implement 2048 tile-merging puzzle with score tracking", assessment: "Verify game loads and tiles merge correctly" }
  - Snake-child: { type: "BOOLEAN", condition: "You implement Snake with growing snake and collision", assessment: "Verify snake grows when eating food" }
  - Minesweeper-child: { type: "BOOLEAN", condition: "You implement Minesweeper with mine reveal logic", assessment: "Verify mines trigger game over on click" }
Each child sees only its own scope, not requirements for sibling work.

PARAMETERS:
- jobName: (required) Name for this job definition
- blueprint: (required) JSON string containing structured invariants array as defined above
- model: (optional) Gemini model to use (defaults to "gemini-3-flash-preview")
- enabledTools: (optional) Array of tool names to enable
- message: (optional) Additional message to include in the job request
- dependencies: (optional) Array of job definition UUIDs (not job names) that must have at least one delivered request before this job executes. Use get_details or search_jobs to find job definition IDs.
- responseTimeout: (optional) Response timeout in seconds for marketplace request (defaults to 300, max 300)

The blueprint is validated and made directly available to the agent in blueprint context.`,
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
      } catch { }
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

    const { jobName, blueprint, model, enabledTools: requestedTools, message, dependencies, skipBranch, responseTimeout, inputSchema } = parsed.data;
    const context = getCurrentJobContext();
    const requiredTools = Array.isArray(context.requiredTools) ? context.requiredTools : [];
    const availableTools = Array.isArray(context.availableTools) ? context.availableTools : undefined;
    const mergedRequestedTools = [
      ...(requestedTools ?? []),
      ...requiredTools,
    ];

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

    if (Array.isArray(availableTools) && availableTools.length > 0) {
      // Universal tools are always allowed - filter them out before validation
      const universalSet = new Set(BASE_UNIVERSAL_TOOLS.map(t => t.toLowerCase()));
      const toolsToValidate = mergedRequestedTools.filter(
        (tool) => !universalSet.has(String(tool).toLowerCase())
      );

      const availableSet = new Set(availableTools.map((tool) => tool.toLowerCase()));
      const disallowedTools = toolsToValidate.filter((tool) => !availableSet.has(String(tool).toLowerCase()));
      if (disallowedTools.length > 0) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              data: null,
              meta: {
                ok: false,
                code: 'UNAUTHORIZED_TOOLS',
                message: `enabledTools not allowed by template policy: ${disallowedTools.join(', ')}.`,
                details: {
                  disallowedTools,
                  availableTools,
                },
              },
            }),
          }],
        };
      }
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

    // Semantic validation using the comprehensive invariant validator
    // This catches errors like RANGE with min > max
    try {
      validateInvariantsStrict(blueprintObj.invariants);
    } catch (validationError: any) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'INVALID_INVARIANT_SEMANTICS',
              message: validationError.message || String(validationError)
            },
          }),
        }],
      };
    }

    const finalBlueprint = blueprint;
    const gqlUrl = getPonderGraphqlUrl();

    // Generate unique job definition ID
    const jobDefinitionId: string = ensureUuid();

    // Validate dependencies before building payload (agent-specific validation)
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

      // CRITICAL: Prevent circular dependencies with parent job
      const context = getCurrentJobContext();
      const parentJobDefinitionId = context.jobDefinitionId;
      if (parentJobDefinitionId && dependencies.includes(parentJobDefinitionId)) {
        console.error('[dispatch_new_job] CIRCULAR_DEPENDENCY: Child job cannot depend on its parent job:', parentJobDefinitionId);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              data: null,
              meta: {
                ok: false,
                code: 'CIRCULAR_DEPENDENCY',
                message: `Child job cannot depend on its parent job (${parentJobDefinitionId}). This creates a deadlock: parent waits for children, children wait for parent. Dependencies should only be between sibling jobs (other children) to control execution order.`,
              },
            }),
          }],
        };
      }
    }

    // Build IPFS payload using shared helper
    // Note: Agents cannot set cyclic or additionalContextOverrides
    let ipfsJsonContents: any[];
    try {
      const toolPolicy = availableTools && availableTools.length > 0
        ? { requiredTools, availableTools }
        : (requiredTools.length > 0 ? { requiredTools, availableTools: requiredTools } : null);
      const tools = toolPolicy ? buildAnnotatedTools(toolPolicy) : undefined;
      const payloadResult = await buildIpfsPayload({
        blueprint: finalBlueprint,
        jobName,
        jobDefinitionId,
        model,
        enabledTools: mergedRequestedTools,
        tools,
        skipBranch,
        dependencies,
        message,
        inputSchema,
        // cyclic and additionalContextOverrides intentionally NOT passed
        // These are only available to human-initiated dispatches
      });
      ipfsJsonContents = payloadResult.ipfsJsonContents;
    } catch (payloadError: any) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'PAYLOAD_BUILD_ERROR',
              message: payloadError.message || String(payloadError),
            },
          }),
        }],
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
        tools: mergedRequestedTools,
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
