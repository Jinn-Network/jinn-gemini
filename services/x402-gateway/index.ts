/**
 * x402 Gateway Service
 * 
 * Execute job templates via x402 payments. Exposes:
 * - GET /templates - List available templates (free)
 * - POST /templates/:id/execute - Execute template (paid via x402)
 * - GET /runs/:requestId/status - Check run status (free)
 * - GET /runs/:requestId/result - Get run result (free, 202 if not ready)
 * 
 * Required env vars:
 * - PAYMENT_WALLET_ADDRESS: Address to receive payments
 * - CDP_API_KEY_ID: Coinbase Developer Platform key ID (for x402)
 * - CDP_API_KEY_SECRET: Coinbase Developer Platform key secret
 * - PONDER_GRAPHQL_URL: Ponder GraphQL endpoint for templates
 * - PRIVATE_KEY: Wallet private key for dispatching jobs
 * - MECH_ADDRESS: Target mech address
 */

import 'dotenv/config';
import { Hono } from "hono";
import { cors } from "hono/cors";
import { paymentMiddleware, type Network } from "x402-hono";
import { facilitator } from "@coinbase/x402";
import { serve } from "@hono/node-server";
import {
  extractAndValidate,
  summarizeOutputSpec as summarizeSpec,
  DEFAULT_OUTPUT_SPEC,
  type OutputSpec
} from "./output-spec.js";
import { handleProvisioning } from "./provisioning/index.js";
import {
  computeTemplatePrice,
  validateBudget,
  formatWei,
} from "./pricing.js";
import { buildJobBranchName, type CodeMetadata } from '../../gemini-agent/shared/code_metadata.js';

// Inlined from gemini-agent/shared/code_metadata.ts (Railway deploys this service standalone)
interface BranchSnapshot {
  name: string;
  headCommit: string;
  remoteUrl?: string;
}

interface RepoMetadata {
  remoteUrl?: string;
}

interface CodeMetadata {
  branch: BranchSnapshot;
  repo?: RepoMetadata;
  baseBranch?: string;
  capturedAt: string;
  jobDefinitionId: string;
}

function buildJobBranchName(options: { jobDefinitionId: string; jobName?: string | null; maxSlugLength?: number }): string {
  const { jobDefinitionId, jobName, maxSlugLength = 30 } = options;
  const prefix = jobDefinitionId.slice(0, 8);

  let slug = '';
  if (jobName) {
    slug = jobName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxSlugLength);
  }

  return slug ? `job/${prefix}-${slug}` : `job/${prefix}`;
}

const app = new Hono();
app.use("/*", cors());

// Environment
const env = process.env;
const payTo = env.PAYMENT_WALLET_ADDRESS as `0x${string}` | undefined;
const network = (env.X402_NETWORK || "base") as Network;
const mechAddress = env.MECH_ADDRESS;
const privateKey = env.PRIVATE_KEY;
// Ponder GraphQL endpoint - sole data source for templates
const ponderUrl = env.PONDER_GRAPHQL_URL || "https://jinn-gemini-production.up.railway.app/graphql";
const chainConfig = env.CHAIN_CONFIG || "base";

// Types - Ponder jobTemplate schema
interface PonderJobTemplate {
  id: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  enabledTools: string[] | null;
  blueprintHash: string | null;
  blueprint: string | null;
  inputSchema: Record<string, any> | null;
  outputSpec: Record<string, any> | null;
  priceWei: string | null;
  canonicalJobDefinitionId: string | null;
  runCount: number;
  successCount: number;
  avgDurationSeconds: number | null;
  avgCostWei: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  status: string;
}

/**
 * Query Ponder GraphQL for job templates
 */
async function queryPonderTemplates(query: string, variables?: Record<string, any>): Promise<any> {
  const res = await fetch(ponderUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Ponder query failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { data?: any; errors?: any[] };
  if (json.errors?.length) {
    throw new Error(`Ponder query error: ${json.errors[0].message}`);
  }

  return json.data;
}

/**
 * Build codeMetadata from standardized input fields.
 * Templates use `repoUrl` and optionally `baseBranch`.
 */
function buildCodeMetadataFromInput(
  input: Record<string, any>,
  jobDefinitionId: string,
  jobName: string
): CodeMetadata | undefined {
  const repoInput = input?.repoUrl;
  if (typeof repoInput !== 'string' || !repoInput) {
    return undefined;
  }

  // Convert org/repo format to full URL if needed
  const repoUrl = repoInput.includes('://')
    ? repoInput
    : `https://github.com/${repoInput}`;

  const baseBranch = input?.baseBranch || 'main';

  const branchName = buildJobBranchName({
    jobDefinitionId,
    jobName,
    maxSlugLength: 20,
  });

  return {
    branch: {
      name: branchName,
      headCommit: 'pending', // Worker resolves after checkout
      remoteUrl: repoUrl,
    },
    repo: { remoteUrl: repoUrl },
    baseBranch,
    capturedAt: new Date().toISOString(),
    jobDefinitionId,
  };
}

/**
 * Fetch all visible templates from Ponder
 */
async function fetchTemplatesFromPonder(): Promise<PonderJobTemplate[]> {
  const query = `
    query ListTemplates {
      jobTemplates(where: { status: "visible" }, orderBy: "createdAt", orderDirection: "desc", limit: 100) {
        items {
          id
          name
          description
          tags
          enabledTools
          blueprintHash
          blueprint
          inputSchema
          outputSpec
          priceWei
          canonicalJobDefinitionId
          runCount
          successCount
          avgDurationSeconds
          avgCostWei
          createdAt
          lastUsedAt
          status
        }
      }
    }
  `;

  const data = await queryPonderTemplates(query);
  return data?.jobTemplates?.items || [];
}

/**
 * Fetch a single template by ID from Ponder
 */
async function fetchTemplateFromPonder(templateId: string): Promise<PonderJobTemplate | null> {
  const query = `
    query GetTemplate($id: String!) {
      jobTemplate(id: $id) {
        id
        name
        description
        tags
        enabledTools
        blueprintHash
        blueprint
        inputSchema
        outputSpec
        priceWei
        canonicalJobDefinitionId
        runCount
        successCount
        avgDurationSeconds
        avgCostWei
        createdAt
        lastUsedAt
        status
      }
    }
  `;

  const data = await queryPonderTemplates(query, { id: templateId });
  return data?.jobTemplate || null;
}

interface ExecuteRequest {
  input?: Record<string, any>;
  context?: string;
  callerBudget?: string; // Optional budget cap in wei
}

// Health check
app.get("/health", (c) => c.json({
  status: "ok",
  service: "x402-gateway",
  timestamp: new Date().toISOString()
}));

// Service info
app.get("/", (c) => c.json({
  name: "x402 Gateway",
  description: "Execute job templates via x402 payments",
  network,
  ponderUrl,
  endpoints: {
    "GET /templates": { payment: "free", description: "List available templates" },
    "GET /templates/:id": { payment: "free", description: "Get template details" },
    "POST /templates/:id/execute": { payment: "dynamic", description: "Execute template (price from template)" },
    "GET /runs/:requestId/status": { payment: "free", description: "Check run status" },
    "GET /runs/:requestId/result": { payment: "free", description: "Get run result (202 if pending)" },
  }
}));

// GET /templates - List available templates from Ponder
app.get("/templates", async (c) => {
  try {
    const ponderTemplates = await fetchTemplatesFromPonder();

    // Transform Ponder templates for API response
    const templates = ponderTemplates.map((t) => ({
      templateId: t.id,
      name: t.name,
      description: t.description,
      tags: t.tags || [],
      price: t.priceWei ? formatPrice(t.priceWei) : "free",
      priceWei: t.priceWei || "0",
      outputSpecSummary: summarizeOutputSpec(t.outputSpec as OutputSpec | null),
      // Additional fields from Ponder
      runCount: t.runCount,
      successCount: t.successCount,
      canonicalJobDefinitionId: t.canonicalJobDefinitionId,
    }));

    return c.json({ templates, source: "ponder" });
  } catch (ponderError: any) {
    console.error("Ponder query failed:", ponderError.message);
    return c.json({
      error: "Template service unavailable",
      details: ponderError.message,
      hint: "The jobTemplate table may not be deployed yet. Ponder is still indexing."
    }, 503);
  }
});

// GET /templates/:id - Get template details from Ponder
app.get("/templates/:id", async (c) => {
  const templateId = c.req.param("id");

  try {
    const template = await fetchTemplateFromPonder(templateId);

    if (!template) {
      return c.json({ error: "Template not found" }, 404);
    }

    return c.json({
      templateId: template.id,
      name: template.name,
      description: template.description,
      tags: template.tags || [],
      enabledTools: template.enabledTools || [],
      inputSchema: template.inputSchema || {},
      outputSpec: template.outputSpec || {},
      blueprint: template.blueprint, // Include stored blueprint
      price: formatPrice(template.priceWei || "0"),
      priceWei: template.priceWei || "0",
      status: template.status,
      // Additional Ponder fields
      canonicalJobDefinitionId: template.canonicalJobDefinitionId,
      runCount: template.runCount,
      successCount: template.successCount,
      avgDurationSeconds: template.avgDurationSeconds,
      avgCostWei: template.avgCostWei,
      createdAt: template.createdAt,
      lastUsedAt: template.lastUsedAt,
      source: "ponder",
    });
  } catch (ponderError: any) {
    console.error("Ponder query failed for template:", templateId, ponderError.message);
    return c.json({
      error: "Template service unavailable",
      details: ponderError.message,
      hint: "The jobTemplate table may not be deployed yet. Ponder is still indexing."
    }, 503);
  }
});

// POST /templates/:id/execute - Execute template
// Payment middleware is applied dynamically based on template price
app.post("/templates/:id/execute", async (c) => {
  if (!mechAddress || !privateKey) {
    return c.json({ error: "Server not configured for dispatch" }, 500);
  }

  const templateId = c.req.param("id");

  // Fetch template from Ponder
  let template: PonderJobTemplate | null = null;

  try {
    template = await fetchTemplateFromPonder(templateId);
  } catch (ponderError: any) {
    console.error("Ponder query failed for execute:", templateId, ponderError.message);
    return c.json({
      error: "Template service unavailable",
      details: ponderError.message,
      hint: "The jobTemplate table may not be deployed yet. Ponder is still indexing."
    }, 503);
  }

  if (!template) {
    return c.json({ error: "Template not found" }, 404);
  }

  // Parse request body
  let body: ExecuteRequest;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const enabledTools = template.enabledTools || [];

  // Compute estimated cost (from template price or historical data)
  const estimatedCost = template.priceWei ||
    await computeTemplatePrice(ponderUrl, template.canonicalJobDefinitionId);

  // Validate caller budget if provided
  const budgetCheck = validateBudget(body.callerBudget, estimatedCost);
  if (!budgetCheck.valid) {
    return c.json({
      error: "Budget exceeded",
      details: budgetCheck.message,
      estimatedCost: formatWei(estimatedCost),
      callerBudget: body.callerBudget ? formatWei(body.callerBudget) : undefined,
    }, 402);
  }

  // TODO: In production, verify x402 payment here
  // For hackathon v0, we skip payment verification
  // The payment middleware should be applied based on template.x402_price

  // Validate input against schema (basic validation)
  const inputSchema = (template.inputSchema || {}) as Record<string, any>;
  const input = body.input || {};

  if (inputSchema.required) {
    for (const field of inputSchema.required) {
      if (!(field in input)) {
        return c.json({ error: `Missing required input field: ${field}` }, 400);
      }
    }
  }

  // Handle $provision sentinels - provision resources if needed
  let enrichedInput = input;
  try {
    enrichedInput = await handleProvisioning(input, inputSchema);
  } catch (provisionError: any) {
    console.error(`[x402] Provisioning failed: ${provisionError.message}`);
    return c.json({
      error: `Provisioning failed: ${provisionError.message}`,
      phase: provisionError.errorPhase || 'unknown',
    }, 500);
  }

  // Build blueprint from template
  // If template has stored blueprint from Ponder, use it; otherwise generate
  const { invariants } = await buildBlueprintFromTemplate(template, enrichedInput);

  try {
    // Dispatch to Jinn
    const jobDefinitionId = crypto.randomUUID();
    const jobName = `${template.name} (via x402)`;
    const { marketplaceInteract } = await import("@jinn-network/mech-client-ts/dist/marketplace_interact.js");

    // Build codeMetadata from standardized input fields (repoUrl, baseBranch)
    const codeMetadata = buildCodeMetadataFromInput(enrichedInput, jobDefinitionId, jobName);

    // Build additionalContext with budget info and env vars
    const additionalContext: Record<string, any> = {};
    if (body.callerBudget) {
      additionalContext.budgetCap = body.callerBudget;
      additionalContext.estimatedCost = estimatedCost;
    }
    // Pass env vars from input if provided
    if (enrichedInput.env && typeof enrichedInput.env === 'object') {
      additionalContext.env = enrichedInput.env;
    }

    const result = await marketplaceInteract({
      prompts: [JSON.stringify({ invariants })],
      priorityMech: mechAddress,
      tools: enabledTools,
      ipfsJsonContents: [{
        blueprint: JSON.stringify({ invariants }),
        jobName,
        model: "gemini-3-flash-preview",
        jobDefinitionId,
        nonce: crypto.randomUUID(),
        networkId: 'jinn',
        templateId: template.id,
        templateVersion: "1.0.0",
        enabledTools,
        // OutputSpec passthrough: include in dispatch so worker can pass through to delivery
        ...(template.outputSpec && { outputSpec: template.outputSpec }),
        // InputSchema for default value resolution
        ...(template.inputSchema && { inputSchema: template.inputSchema }),
        // Budget and pricing context
        estimatedCost,
        // additionalContext (budget, env vars)
        ...(Object.keys(additionalContext).length > 0 && { additionalContext }),
        // Git workflow fields (if codeMetadata present)
        ...(codeMetadata && {
          codeMetadata,
          branchName: codeMetadata.branch.name,
          baseBranch: codeMetadata.baseBranch,
          executionPolicy: {
            branch: codeMetadata.branch.name,
            ensureTestsPass: true,
            description: 'Agent must work on the provided branch.',
          },
        }),
      }],
      chainConfig,
      keyConfig: { source: "value", value: privateKey },
      postOnly: true,
      responseTimeout: 300,
    });

    if (!result?.request_ids?.[0]) {
      throw new Error("Dispatch failed: no request ID");
    }

    const requestId = result.request_ids[0];
    const baseUrl = new URL(c.req.url).origin;

    return c.json({
      requestId,
      jobDefinitionId,
      templateId: template.id,
      statusUrl: `${baseUrl}/runs/${requestId}/status`,
      resultUrl: `${baseUrl}/runs/${requestId}/result`,
      explorerUrl: `https://explorer.jinn.network/requests/${requestId}`,
    }, 201);

  } catch (e: any) {
    console.error("Execute failed:", e);
    return c.json({ error: "Execution failed", details: e.message }, 500);
  }
});

// GET /runs/:requestId/status - Check run status
app.get("/runs/:requestId/status", async (c) => {
  const requestId = c.req.param("requestId");

  const query = `query ($id: String!) { 
    request(id: $id) { 
      id 
      delivered 
      jobName
      blockTimestamp
    } 
  }`;

  try {
    const res = await fetch(ponderUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { id: requestId } }),
    });

    const data = await res.json() as { data?: { request?: { delivered: boolean; jobName?: string; blockTimestamp?: string } } };
    const req = data?.data?.request;

    if (!req) {
      return c.json({
        requestId,
        status: "not_found",
        message: "Request not yet indexed or does not exist"
      });
    }

    return c.json({
      requestId,
      status: req.delivered ? "completed" : "in_progress",
      jobName: req.jobName,
      createdAt: req.blockTimestamp ? new Date(Number(req.blockTimestamp) * 1000).toISOString() : undefined,
    });
  } catch (e: any) {
    return c.json({ error: "Status query failed", details: e.message }, 500);
  }
});

// GET /runs/:requestId/result - Get run result
// Returns the FINAL result of a workstream, not just the initial request's delivery
app.get("/runs/:requestId/result", async (c) => {
  const requestId = c.req.param("requestId");

  // Step 1: Get the request and its jobDefinitionId
  const requestQuery = `query ($id: String!) { 
    request(id: $id) { 
      id 
      delivered 
      deliveryIpfsHash
      jobName
      jobDefinitionId
    } 
  }`;

  try {
    const res = await fetch(ponderUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: requestQuery, variables: { id: requestId } }),
    });

    const data = await res.json() as {
      data?: {
        request?: {
          delivered: boolean;
          deliveryIpfsHash?: string;
          jobName?: string;
          jobDefinitionId?: string;
        }
      }
    };
    const req = data?.data?.request;

    if (!req) {
      return c.json({
        status: "not_found",
        result: null,
      }, 404);
    }

    if (!req.delivered) {
      // Return 202 Accepted - still processing
      return c.json({
        status: "in_progress",
        result: null,
      }, 202);
    }

    // Step 2: Check job definition's lastStatus to determine if workstream is complete
    let finalRequestId = requestId;
    let finalDeliveryHash = req.deliveryIpfsHash;

    if (req.jobDefinitionId) {
      const jobDefQuery = `query ($id: String!) {
        jobDefinition(id: $id) {
          id
          lastStatus
        }
      }`;

      const jobDefRes = await fetch(ponderUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: jobDefQuery, variables: { id: req.jobDefinitionId } }),
      });

      const jobDefData = await jobDefRes.json() as { data?: { jobDefinition?: { lastStatus?: string } } };
      const lastStatus = jobDefData?.data?.jobDefinition?.lastStatus;

      // If job is COMPLETED, find the latest delivered request for this job definition
      // This handles the case where parent was re-run after children completed
      if (lastStatus === "COMPLETED") {
        const latestQuery = `query ($jobDefId: String!) {
          requests(
            where: { jobDefinitionId: $jobDefId, delivered: true }
            orderBy: "blockTimestamp"
            orderDirection: "desc"
            limit: 1
          ) {
            items {
              id
              deliveryIpfsHash
            }
          }
        }`;

        const latestRes = await fetch(ponderUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: latestQuery, variables: { jobDefId: req.jobDefinitionId } }),
        });

        const latestData = await latestRes.json() as { data?: { requests?: { items?: Array<{ id: string; deliveryIpfsHash?: string }> } } };
        const latestRequest = latestData?.data?.requests?.items?.[0];

        if (latestRequest?.deliveryIpfsHash) {
          finalRequestId = latestRequest.id;
          finalDeliveryHash = latestRequest.deliveryIpfsHash;
        }
      } else if (lastStatus === "DELEGATING") {
        // Workstream has children still processing
        return c.json({
          status: "in_progress",
          result: null,
        }, 202);
      }
    }

    if (!finalDeliveryHash) {
      return c.json({
        status: "in_progress",
        result: null,
      }, 202);
    }

    // Step 3: Fetch delivery payload from IPFS
    const ipfsUrl = buildIpfsUrl(finalDeliveryHash, finalRequestId);
    const ipfsRes = await fetch(ipfsUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!ipfsRes.ok) {
      return c.json({
        status: "error",
        error: "Delivery completed but payload fetch failed",
      }, 502);
    }

    const deliveryPayload = await ipfsRes.json() as Record<string, any>;

    // Get OutputSpec: prefer passthrough from delivery payload, fallback to Ponder lookup
    let outputSpec: OutputSpec | undefined;

    // First: try passthrough OutputSpec from delivery payload (fast path)
    if (deliveryPayload.outputSpec && typeof deliveryPayload.outputSpec === 'object') {
      outputSpec = deliveryPayload.outputSpec as OutputSpec;
    } else {
      // Fallback: fetch from Ponder if templateId is present
      const templateId = deliveryPayload.templateId;
      if (templateId) {
        try {
          const template = await fetchTemplateFromPonder(templateId);
          if (template?.outputSpec) {
            outputSpec = template.outputSpec as OutputSpec;
          }
        } catch {
          // OutputSpec lookup failed, proceed without it
        }
      }
    }

    // Apply OutputSpec mapping and validation
    try {
      const result = extractAndValidate(deliveryPayload, outputSpec);

      return c.json({
        status: "completed",
        result,
      });
    } catch (validationError: any) {
      // Return 502 if output validation fails
      return c.json({
        status: "error",
        error: validationError.message,
      }, 502);
    }

  } catch (e: any) {
    return c.json({ status: "error", error: e.message }, 500);
  }
});

// Helper: Convert f01551220... digest to dag-pb CID URL with requestId path
function buildIpfsUrl(deliveryIpfsHash: string, requestId: string): string {
  // deliveryIpfsHash is 'f01551220' + 64-hex digest (raw codec)
  // We need to convert to dag-pb CID (codec 0x70) and append requestId path
  const digestHex = deliveryIpfsHash.replace(/^f01551220/i, '');

  if (digestHex.length !== 64) {
    // Fallback to raw format if not expected length
    return `https://gateway.autonolas.tech/ipfs/${deliveryIpfsHash}/${requestId}`;
  }

  try {
    // Parse digest hex to bytes
    const digestBytes: number[] = [];
    for (let i = 0; i < digestHex.length; i += 2) {
      digestBytes.push(parseInt(digestHex.slice(i, i + 2), 16));
    }

    // Build CIDv1 bytes: [0x01] + [0x70] (dag-pb) + multihash: [0x12, 0x20] + digest
    const cidBytes = [0x01, 0x70, 0x12, 0x20, ...digestBytes];

    // Base32 encode (lowercase, no padding), prefix with 'b'
    const base32Alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let bitBuffer = 0;
    let bitCount = 0;
    let out = '';
    for (const b of cidBytes) {
      bitBuffer = (bitBuffer << 8) | (b & 0xff);
      bitCount += 8;
      while (bitCount >= 5) {
        const idx = (bitBuffer >> (bitCount - 5)) & 0x1f;
        bitCount -= 5;
        out += base32Alphabet[idx];
      }
    }
    if (bitCount > 0) {
      const idx = (bitBuffer << (5 - bitCount)) & 0x1f;
      out += base32Alphabet[idx];
    }

    const dirCid = 'b' + out;
    return `https://gateway.autonolas.tech/ipfs/${dirCid}/${requestId}`;
  } catch {
    // Fallback on any error
    return `https://gateway.autonolas.tech/ipfs/${deliveryIpfsHash}/${requestId}`;
  }
}

// Helper: Format price from wei to human readable
function formatPrice(weiString: string | number | bigint): string {
  const wei = BigInt(weiString || 0);
  if (wei === 0n) return "free";

  const eth = Number(wei) / 1e18;
  if (eth >= 0.001) return `${eth.toFixed(4)} ETH`;

  const gwei = Number(wei) / 1e9;
  if (gwei >= 1) return `${gwei.toFixed(2)} gwei`;

  return `${wei} wei`;
}

// Use imported summarizeOutputSpec from output-spec.ts
const summarizeOutputSpec = summarizeSpec;

/**
 * Substitute {{variable}} placeholders in a string with input values.
 * Supports nested variable paths like {{blogSpec.name}}.
 */
function substituteVariables(
  text: string,
  input: Record<string, any>,
  inputSchema?: Record<string, any>
): string {
  return text.replace(/\{\{([\w.]+)\}\}/g, (match, varPath) => {
    // Support nested paths like blogSpec.name
    const parts = varPath.split('.');
    let value: any = input;
    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        value = undefined;
        break;
      }
    }

    if (value !== undefined) {
      return String(value);
    }

    // Keep placeholder if no value found
    console.warn(`No value found for template variable: ${varPath}`);
    return match;
  });
}

/**
 * Deep substitute variables in an object (recursively processes strings).
 */
function deepSubstitute(
  obj: any,
  input: Record<string, any>,
  inputSchema?: Record<string, any>
): any {
  if (typeof obj === 'string') {
    return substituteVariables(obj, input, inputSchema);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepSubstitute(item, input, inputSchema));
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepSubstitute(value, input, inputSchema);
    }
    return result;
  }
  return obj;
}

// Helper: Build blueprint from template
async function buildBlueprintFromTemplate(
  template: PonderJobTemplate | any,
  input: Record<string, any>
): Promise<{ invariants: any[] }> {
  // If template has a stored blueprint from Ponder, parse and use it
  if (template.blueprint) {
    try {
      const storedBlueprint = JSON.parse(template.blueprint);

      // Deep substitute {{variable}} placeholders in invariants
      const substitutedInvariants = deepSubstitute(
        storedBlueprint.invariants || [],
        input,
        template.inputSchema || undefined
      );

      return { invariants: substitutedInvariants };
    } catch (parseError) {
      console.warn("Failed to parse stored blueprint, falling back to generic:", parseError);
    }
  }

  // Fallback: Generate generic blueprint for templates without stored blueprints
  const fallbackInvariants = [
    {
      id: "TEMPLATE-001",
      invariant: `Execute the ${template.name} template with the provided input parameters.`,
      measurement: "Template execution completes successfully with expected output.",
      examples: {
        do: ["Follow the template's intended purpose", "Use provided input parameters"],
        dont: ["Deviate from template scope", "Ignore input parameters"]
      }
    },
    {
      id: "OUTPUT-001",
      invariant: "Produce output conforming to the template's output specification.",
      measurement: "All required output fields are present and correctly formatted.",
      examples: {
        do: ["Include all required output fields", "Format output as specified"],
        dont: ["Omit required fields", "Return unstructured data"]
      }
    }
  ];

  return { invariants: fallbackInvariants };
}

// Start server
const port = parseInt(env.PORT || "3001", 10);
console.log(`x402 Gateway running on :${port}`);
console.log(`Ponder endpoint: ${ponderUrl}`);

serve({ fetch: app.fetch, port });
