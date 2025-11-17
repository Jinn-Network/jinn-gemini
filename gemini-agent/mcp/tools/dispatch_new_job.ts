import { z } from 'zod';
import { graphQLRequest } from '../../../http/client.js';
import { randomUUID } from 'node:crypto';
import { marketplaceInteract } from '@jinn-network/mech-client-ts/dist/marketplace_interact.js';
import { getCurrentJobContext } from './shared/context.js';
import { getMechAddress, getMechChainConfig, getServicePrivateKey } from '../../../env/operate-profile.js';
import { getPonderGraphqlUrl } from './shared/env.js';
import { collectLocalCodeMetadata, ensureJobBranch } from '../../shared/code_metadata.js';
import { getCodeMetadataDefaultBaseBranch } from '../../../config/index.js';

const dispatchNewJobParamsBase = z.object({
  objective: z.string().min(10).describe('Clear, specific statement of what needs to be accomplished'),
  context: z.string().min(20).describe('Why this work is needed and how it fits into the broader goal. Include relevant background from parent job.'),
  deliverables: z.string().optional().describe('Expected outputs or artifacts to be created. Specify artifact topics and what should be persisted for parent job review.'),
  acceptanceCriteria: z.string().min(10).describe('Specific, measurable criteria for successful completion (what "done" looks like). Include: (1) what outputs are complete, (2) what artifacts are created with topics, (3) how results are surfaced to parent.'),
  constraints: z.string().optional().describe('Limitations, requirements, dependencies, or important considerations'),
  instructions: z.string().optional().describe('Explicit guidance or prohibitions the agent must follow verbatim during execution.'),
  jobName: z.string().min(1),
  model: z.string().optional().describe('Gemini model to use for this job (e.g., "gemini-2.5-flash", "gemini-2.5-pro"). Defaults to "gemini-2.5-flash" if not specified.'),
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
- deliverables: (optional) Expected outputs or artifacts to be created. Specify artifact topics and what should be persisted for parent job review.
- acceptanceCriteria: Specific, measurable criteria for successful completion - what "done" looks like (min 10 chars). Include: (1) what outputs are complete, (2) what artifacts are created with topics, (3) how results are surfaced to parent.
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
  instructions?: string;
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

  if (params.instructions) {
    const trimmedInstructions = params.instructions.trim();
    if (trimmedInstructions.length > 0) {
      prompt += `\n\n# Instructions\n${trimmedInstructions}`;
    }
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

    const { objective, context: promptContext, deliverables, acceptanceCriteria, constraints, instructions, jobName, model, enabledTools, updateExisting, message } = parsed.data;

    // Assemble structured fields into a single prompt string for IPFS storage
    const prompt = constructPrompt({ objective, context: promptContext, deliverables, acceptanceCriteria, constraints, instructions });

    const gqlUrl = getPonderGraphqlUrl();

    let existingJob: any | null = null;
    try {
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
        maxRetries: 0,
        context: { operation: 'checkExistingJob', jobName }
      });
      existingJob = result?.jobDefinitions?.items?.[0] || null;
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

    const baseBranch =
      (context as any)?.baseBranch ||
      getCodeMetadataDefaultBaseBranch();

    let branchResult;
    let codeMetadata;
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

    const ipfsJsonContents: any[] = [{
      prompt,
      jobName,
      model: model || process.env.MECH_MODEL || 'gemini-2.5-flash',
      enabledTools,
      jobDefinitionId,
      nonce: ensureUuid(),
      additionalContext,
      branchName: branchResult.branchName,
      baseBranch,
      ...lineageContext,
    }];

    console.error('[dispatch_new_job] codeMetadata check:', {
      hasCodeMetadata: !!codeMetadata,
      hasBranchResult: !!branchResult,
      branchName: branchResult?.branchName,
    });

    if (codeMetadata) {
      ipfsJsonContents[0].codeMetadata = codeMetadata;
    } else {
      console.error('[dispatch_new_job] WARNING: No codeMetadata - job will fail in worker!');
    }

    ipfsJsonContents[0].executionPolicy = {
      branch: branchResult.branchName,
      ensureTestsPass: true,
      description: 'Agent must work on the provided branch and pass required validations before finalizing.',
    };

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
        promptLength: prompt.length,
        mech: mechAddress,
        chainConfig,
        toolsCount: (enabledTools || []).length,
        hasIpfsContents: !!ipfsJsonContents,
        env_MECHX_CHAIN_RPC: process.env.MECHX_CHAIN_RPC,
        env_RPC_URL: process.env.RPC_URL,
        env__ENV_LOADED: process.env.__ENV_LOADED,
        env_VITEST: process.env.VITEST,
      });

      // Check wallet balance before transaction
      try {
        const { Web3 } = await import('web3');
        const { Wallet } = await import('ethers');
        const wallet = new Wallet(privateKey);
        const web3 = new Web3(process.env.RPC_URL || process.env.MECHX_CHAIN_RPC);
        const balance = await web3.eth.getBalance(wallet.address);
        console.error('[dispatch_new_job] Wallet balance check:', {
          address: wallet.address,
          balanceWei: balance.toString(),
          balanceEth: Number(balance) / 1e18
        });
      } catch (balErr) {
        console.error('[dispatch_new_job] Failed to check balance:', balErr);
      }

      console.error('[dispatch_new_job] About to call marketplaceInteract...');
      const result = await marketplaceInteract({
        prompts: [prompt],
        priorityMech: mechAddress,
        tools: enabledTools || [],
        ipfsJsonContents,
        chainConfig,
        keyConfig: { source: 'value', value: privateKey },
        postOnly: true,
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
          text: JSON.stringify({ data: enriched, meta: { ok: true } }),
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
