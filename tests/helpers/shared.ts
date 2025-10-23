/**
 * Shared test utilities for E2E marketplace and worker tests
 * Extracted from onchain.marketplace.e2e.test.ts for reusability
 */

import { execa, type ExecaChildProcess } from 'execa';
import fetch from 'cross-fetch';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadEnvOnce } from './tools/shared/env.js';
import { createTenderlyClient, ethToWei, type VnetResult } from '../../scripts/lib/tenderly.js';

// Re-export types for convenience
export type { VnetResult };

/**
 * MCP Client wrapper for calling tools through the MCP protocol
 */
class McpClientWrapper {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  async connect(): Promise<void> {
    if (this.client) return; // Already connected

    const repoRoot = process.env.JINN_REPO_ROOT || process.env.INIT_CWD || process.cwd();
    const resolvedCommand = process.env.JINN_MCP_COMMAND || 'yarn';
    let resolvedArgs: string[] | null = null;

    if (resolvedCommand === 'yarn') {
      resolvedArgs = ['tsx', 'gemini-agent/mcp/server.ts'];
    } else {
      try {
        if (process.env.JINN_MCP_ARGS) {
          const parsed = JSON.parse(process.env.JINN_MCP_ARGS);
          if (Array.isArray(parsed) && parsed.every(arg => typeof arg === 'string')) {
            resolvedArgs = parsed;
          }
        }
      } catch (error) {
        console.warn('[MCP] Failed to parse JINN_MCP_ARGS, falling back to defaults:', error);
      }

      if (!resolvedArgs || resolvedArgs.length === 0) {
        resolvedArgs = ['tsx', 'gemini-agent/mcp/server.ts'];
      }
    }

    this.transport = new StdioClientTransport({
      command: resolvedCommand,
      args: resolvedArgs,
      cwd: repoRoot,
      env: { ...process.env, JINN_REPO_ROOT: repoRoot } as Record<string, string>
    });

    this.client = new Client(
      { name: 'e2e-test-client', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    await this.client.connect(this.transport);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }

  async callTool(toolName: string, args: Record<string, any>): Promise<any> {
    // Auto-connect if not connected (handles module reload between test files)
    if (!this.client) {
      await this.connect();
    }
    return await this.client!.callTool({ name: toolName, arguments: args });
  }
}

let mcpClient: McpClientWrapper | null = null;

/**
 * Get or create the MCP client instance
 */
export function getMcpClient(): McpClientWrapper {
  if (!mcpClient) {
    mcpClient = new McpClientWrapper();
  }
  return mcpClient;
}

/**
 * Parse MCP tool response content
 */
export function parseToolText(result: any): any {
  try {
    const text = result?.content?.[0]?.text;
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * Reconstruct IPFS directory CID from hex ipfsHash (raw codec)
 */
function hexToBytes(hex: string): number[] {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
  return out;
}

function toBase32LowerNoPad(bytes: number[]): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bitBuffer = 0;
  let bitCount = 0;
  let out = '';
  for (const b of bytes) {
    bitBuffer = (bitBuffer << 8) | (b & 0xff);
    bitCount += 8;
    while (bitCount >= 5) {
      const idx = (bitBuffer >> (bitCount - 5)) & 0x1f;
      bitCount -= 5;
      out += alphabet[idx];
    }
  }
  if (bitCount > 0) {
    const idx = (bitBuffer << (5 - bitCount)) & 0x1f;
    out += alphabet[idx];
  }
  return out;
}

export function reconstructDirCidFromHexIpfsHash(ipfsHashHex: string): string | null {
  const s = String(ipfsHashHex).toLowerCase();
  const prefix = 'f01551220';
  if (!s.startsWith(prefix)) return null;
  const digestHex = s.slice(prefix.length);
  if (digestHex.length !== 64) return null;
  const digestBytes = hexToBytes(digestHex);
  const cidBytes = [0x01, 0x70, 0x12, 0x20, ...digestBytes];
  return 'b' + toBase32LowerNoPad(cidBytes);
}

/**
 * Fetch JSON from URL with retries
 */
export async function fetchJsonWithRetry(url: string, attempts = 5, delayMs = 1500): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return await resp.json();
    } catch {}
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`Failed to fetch JSON from ${url}`);
}

/**
 * Wait for GraphQL endpoint to become available
 */
export async function waitForGraphql(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  const q = '{ requests(limit: 1) { items { id } } }';
  let lastErr: any = null;
  while (true) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      if (resp.ok) return;
      lastErr = new Error(`GraphQL HTTP ${resp.status}`);
    } catch (e: any) {
      lastErr = e;
    }
    if (Date.now() - start > timeoutMs) {
      throw lastErr || new Error('Timed out waiting for GraphQL');
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

/**
 * Poll GraphQL with generic query until condition is met
 */
export async function pollGraphQL<T>(
  url: string,
  query: string,
  variables: Record<string, any>,
  extractFn: (data: any) => T | null,
  options: { maxAttempts?: number; delayMs?: number } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 20;
  const delayMs = options.delayMs ?? 1500;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 0 : delayMs));
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables })
      });
      if (!resp.ok) continue;
      const jr = await resp.json();
      const result = extractFn(jr);
      if (result !== null) return result;
    } catch {
      // Continue polling
    }
  }
  throw new Error(`Polling timed out after ${maxAttempts} attempts`);
}

/**
 * Wait for job definition to be indexed
 */
export async function waitForJobIndexed(
  gqlUrl: string,
  jobDefinitionId: string,
  options?: { maxAttempts?: number; delayMs?: number }
): Promise<any> {
  const query = 'query($id:String!){ jobDefinition(id:$id){ id name enabledTools promptContent sourceRequestId sourceJobDefinitionId codeMetadata } }';
  return pollGraphQL(
    gqlUrl,
    query,
    { id: jobDefinitionId },
    (jr) => jr?.data?.jobDefinition?.id ? jr.data.jobDefinition : null,
    options
  );
}

/**
 * Wait for request to be indexed
 */
export async function waitForRequestIndexed(
  gqlUrl: string,
  requestId: string,
  options?: { maxAttempts?: number; delayMs?: number }
): Promise<any> {
  const query = 'query($id:String!){ request(id:$id){ id jobDefinitionId ipfsHash sourceRequestId sourceJobDefinitionId } }';
  return pollGraphQL(
    gqlUrl,
    query,
    { id: requestId },
    (jr) => jr?.data?.request?.id ? jr.data.request : null,
    options
  );
}

/**
 * Wait for delivery to be indexed
 */
export async function waitForDelivery(
  gqlUrl: string,
  requestId: string,
  options?: { maxAttempts?: number; delayMs?: number }
): Promise<any> {
  const query = 'query($id:String!){ delivery(id:$id){ id requestId ipfsHash transactionHash blockTimestamp } }';
  return pollGraphQL(
    gqlUrl,
    query,
    { id: requestId },
    (jr) => {
      const delivery = jr?.data?.delivery;
      return (delivery?.id && delivery?.ipfsHash && delivery?.transactionHash) ? delivery : null;
    },
    options
  );
}

/**
 * Wait for artifact to be indexed
 */
export async function waitForArtifact(
  gqlUrl: string,
  artifactId: string,
  options?: { maxAttempts?: number; delayMs?: number }
): Promise<any> {
  const query = 'query($id:String!){ artifact(id:$id){ id requestId name topic cid contentPreview } }';
  return pollGraphQL(
    gqlUrl,
    query,
    { id: artifactId },
    (jr) => jr?.data?.artifact?.id ? jr.data.artifact : null,
    options
  );
}

/**
 * Wait for message to be indexed
 */
export async function waitForMessage(
  gqlUrl: string,
  jobDefinitionId: string,
  expectedContent: string,
  options?: { maxAttempts?: number; delayMs?: number }
): Promise<any> {
  const query = 'query($to:String!){ messages(where:{to:$to}){ items { id content to sourceJobDefinitionId requestId blockTimestamp } } }';
  return pollGraphQL(
    gqlUrl,
    query,
    { to: jobDefinitionId },
    (jr) => {
      const messages = jr?.data?.messages?.items || [];
      return messages.find((m: any) => m.content === expectedContent) || null;
    },
    options
  );
}

/**
 * Create a test job with simplified parameters
 */
export async function createTestJob(params: {
  objective: string;
  context: string;
  acceptanceCriteria: string;
  jobName?: string;
  enabledTools?: string[];
  instructions?: string;
  deliverables?: string;
  constraints?: string;
  message?: string;
  sourceRequestId?: string;
  sourceJobDefinitionId?: string;
}): Promise<{ jobDefId: string; requestId: string; dispatchResult: any }> {
  const jobName = params.jobName ?? `test-job-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const enabledTools = params.enabledTools ?? ['create_artifact'];

  // Call dispatch_new_job through MCP protocol
  const client = getMcpClient();
  const dispatchRes = await client.callTool('dispatch_new_job', {
    objective: params.objective,
    context: params.context,
    instructions: params.instructions,
    acceptanceCriteria: params.acceptanceCriteria,
    deliverables: params.deliverables,
    constraints: params.constraints,
    jobName,
    enabledTools,
    updateExisting: true,
    message: params.message,
    sourceRequestId: params.sourceRequestId,
    sourceJobDefinitionId: params.sourceJobDefinitionId,
  });

  const parsed = parseToolText(dispatchRes);
  if (!parsed?.meta?.ok) {
    throw new Error(`Failed to create test job: ${JSON.stringify(parsed)}`);
  }

  const data = parsed.data || {};
  const requestId = data.request_ids?.[0];
  const jobDefId = data.jobDefinitionId;

  if (!requestId || !jobDefId) {
    throw new Error('Missing requestId or jobDefId in dispatch response');
  }

  return { jobDefId, requestId, dispatchResult: parsed };
}

/**
 * Create a temporary .operate directory with test configuration
 */
function createTestOperateDir(): string {
  const testOperateDir = path.join(process.cwd(), '.operate-test');

  // Clean up any existing test directory
  if (fs.existsSync(testOperateDir)) {
    fs.rmSync(testOperateDir, { recursive: true, force: true });
  }

  // Create directory structure
  const servicesDir = path.join(testOperateDir, 'services');
  const keysDir = path.join(testOperateDir, 'keys');
  const serviceId = 'sc-test-service';
  const serviceDir = path.join(servicesDir, serviceId);
  fs.mkdirSync(serviceDir, { recursive: true });
  fs.mkdirSync(keysDir, { recursive: true });

  // Create minimal config.json with Safe address from .env.test
  const config = {
    version: 8,
    service_config_id: serviceId,
    home_chain: "base",
    chain_configs: {
      base: {
        chain_data: {
          multisig: process.env.MECH_SAFE_ADDRESS || null,
          instances: [process.env.MECH_ADDRESS || '0x0000000000000000000000000000000000000000']
        }
      }
    }
  };

  fs.writeFileSync(
    path.join(serviceDir, 'config.json'),
    JSON.stringify(config, null, 2)
  );

  // Create private key file if MECH_PRIVATE_KEY is set
  if (process.env.MECH_PRIVATE_KEY && process.env.MECH_ADDRESS) {
    const keyFile = path.join(keysDir, process.env.MECH_ADDRESS);
    const keyData = { private_key: process.env.MECH_PRIVATE_KEY };
    fs.writeFileSync(keyFile, JSON.stringify(keyData, null, 2));
  }

  return testOperateDir;
}

/**
 * Run worker single-shot targeting a specific request
 */
export async function runWorkerOnce(
  targetRequestId: string,
  options: {
    gqlUrl: string;
    controlApiUrl?: string;
    model?: string;
    timeout?: number;
  }
): Promise<ExecaChildProcess> {
  const env: any = { ...process.env };
  env.PONDER_GRAPHQL_URL = options.gqlUrl;
  env.CONTROL_API_URL = options.controlApiUrl ?? 'http://localhost:4001/graphql';
  env.USE_CONTROL_API = 'true';
  env.MECH_MODEL = options.model ?? 'gemini-2.5-pro';
  env.MECH_TARGET_REQUEST_ID = targetRequestId;

  // Create test .operate directory if MECH_SAFE_ADDRESS is set
  if (process.env.MECH_SAFE_ADDRESS) {
    const testOperateDir = createTestOperateDir();
    env.OPERATE_HOME = testOperateDir;
  }

  const workerProc = execa('yarn', ['--ignore-engines', 'dev:mech'], {
    cwd: process.cwd(),
    env,
    stdio: 'pipe',
    timeout: options.timeout ?? 300_000
  });

  // Track quota errors
  let quotaErrorDetected = false;

  // Forward output for debugging and detect quota errors
  if (workerProc.stdout) workerProc.stdout.on('data', (d: any) => {
    try {
      const output = d.toString();
      process.stderr.write(`[worker] ${d}`);

      // Detect quota limit errors in stdout
      if (output.includes('quota limit') && !quotaErrorDetected) {
        quotaErrorDetected = true;
        process.stderr.write('\n[test] ⚠️  Tenderly quota limit detected - test will fail (vitest bail:1 will stop suite)\n');
        workerProc.kill('SIGTERM');
      }
    } catch {}
  });
  if (workerProc.stderr) workerProc.stderr.on('data', (d: any) => {
    try {
      const output = d.toString();
      process.stderr.write(`[worker] ${d}`);

      // Detect quota limit errors in stderr
      if (output.includes('quota limit') && !quotaErrorDetected) {
        quotaErrorDetected = true;
        process.stderr.write('\n[test] ⚠️  Tenderly quota limit detected - test will fail (vitest bail:1 will stop suite)\n');
        workerProc.kill('SIGTERM');
      }
    } catch {}
  });

  // Wrap the original promise to reject immediately on quota error
  const originalPromise = workerProc;
  const wrappedPromise = new Promise<void>((resolve, reject) => {
    originalPromise.then(
      () => {
        if (quotaErrorDetected) {
          reject(new Error('Tenderly quota limit reached - test cannot proceed without RPC access'));
        } else {
          resolve();
        }
      },
      (err) => {
        if (quotaErrorDetected) {
          reject(new Error('Tenderly quota limit reached - test cannot proceed without RPC access'));
        } else {
          reject(err);
        }
      }
    );
  });

  return wrappedPromise as any;
}

/**
 * Assert artifact exists with expected metadata
 */
export async function assertArtifactExists(
  gqlUrl: string,
  requestId: string,
  expectedTopic: string,
  expectedName?: string
): Promise<any> {
  const artifact = await waitForArtifact(gqlUrl, `${requestId}:0`, { maxAttempts: 30, delayMs: 4000 });

  if (!artifact) {
    throw new Error(`Artifact not found for request ${requestId}`);
  }
  if (artifact.topic !== expectedTopic) {
    throw new Error(`Expected topic ${expectedTopic}, got ${artifact.topic}`);
  }
  if (expectedName && artifact.name !== expectedName) {
    throw new Error(`Expected name ${expectedName}, got ${artifact.name}`);
  }

  return artifact;
}

/**
 * Test infrastructure context - shared across all e2e tests via global setup
 */
export interface SharedTestInfrastructure {
  gqlUrl: string;
  controlUrl: string;
  vnetId: string;
}

/**
 * Get shared test infrastructure URLs from environment (set by global setup)
 */
export function getSharedInfrastructure(): SharedTestInfrastructure {
  const gqlUrl = process.env.E2E_GQL_URL;
  const controlUrl = process.env.E2E_CONTROL_URL;
  const vnetId = process.env.E2E_VNET_ID;

  if (!gqlUrl || !controlUrl || !vnetId) {
    throw new Error(
      'Shared infrastructure not initialized. ' +
      'Make sure vitest.config.ts has globalSetup: "./tests/e2e/setup.ts"'
    );
  }

  return { gqlUrl, controlUrl, vnetId };
}

/**
 * Reset test environment state between tests to prevent leakage
 * Call this in beforeEach() to ensure clean state
 *
 * NOTE: Does NOT disconnect/reconnect MCP client to avoid breaking active connections.
 * Tests that modify env vars and need MCP to see them should disconnect/reconnect manually.
 */
export function resetTestEnvironment(): void {
  // Clear lineage context that may have been set by previous tests
  delete process.env.JINN_REQUEST_ID;
  delete process.env.JINN_JOB_DEFINITION_ID;

  // Note: MCP client is intentionally left connected and shared across tests.
  // This avoids breaking connections during test execution.
  // Tests that set env vars for MCP must manually disconnect/reconnect.
}
