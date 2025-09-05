import { readRecords } from '../gemini-agent/mcp/tools/read-records.js';
import { updateRecords } from '../gemini-agent/mcp/tools/update-records.js';
import { createRecord } from '../gemini-agent/mcp/tools/create-record.js';
import { Agent } from '../gemini-agent/agent.js';
import { TransactionProcessor } from './TransactionProcessor.js';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { workerLogger, jobLogger, agentLogger } from './logger.js';

const debugMode = process.argv.includes('--debug') || process.argv.includes('-d');
const jobIdFlagIndex = process.argv.findIndex(arg => arg === '--job-id' || arg === '-j');
const targetJobId = jobIdFlagIndex !== -1 ? process.argv[jobIdFlagIndex + 1] : null;
const stopOnChief = process.argv.includes('--stop-on-chief');

if (jobIdFlagIndex !== -1 && (!targetJobId || targetJobId.startsWith('-'))) {
    workerLogger.error("Invalid usage: --job-id|-j requires a job ID value.");
    process.exit(1);
}

const singleJobMode = process.argv.includes('--single-job') || Boolean(targetJobId);
const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    workerLogger.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
    process.exit(1);
}

// Retry configuration
const RETRY_CONFIG = {
    maxRetries: 3, // Maximum number of retries per job
    retryDelayMs: 5000, // 5 seconds base delay between retries
    maxBackoffMs: 120000, // 2 minutes maximum backoff
    exponentialBackoff: true, // Use exponential backoff
    retryableErrors: [
        '500', // Internal server error
        'INTERNAL', // Gemini API internal error
        'An internal error has occurred', // Gemini API error message
        'got status: INTERNAL', // Gemini CLI error format
        'Error when talking to Gemini API', // Gemini CLI API error
        'timeout', // Timeout errors
        'network', // Network errors
        'ENOTFOUND', // DNS resolution errors
        'ECONNRESET', // Connection reset errors
        'ECONNREFUSED', // Connection refused errors
        'path validation failed', // Gemini CLI path validation errors
        'resolves outside the allowed workspace directories', // Path validation error details
        'Invalid arguments for tool', // Tool argument validation errors
        'Invalid enum value', // Tool enum validation errors
        'MCP error -32602' // MCP invalid arguments error
    ]
};

// 500/Internal error cooldown configuration
const INTERNAL_ERROR_COOLDOWN_MS = 90000; // 90 seconds cooldown after 500/INTERNAL errors

// Global rate limiting state
let lastJobTime = 0;
let quotaErrorTime = 0;
let internalErrorCooldownTime = 0;
let jobCount = 0;
let jobCountResetTime = Date.now();

// Represents the structure of the job_board table row
interface JobBoard {
  id: string;
  status: string;
  worker_id?: string | null;
  input: string;
  enabled_tools: string[];
  model_settings: Record<string, any>;
  parent_job_definition_id: string;
  job_name: string;
  project_run_id?: string | null;
  source_event_id?: string | null;
  project_definition_id?: string | null;
  inbox?: Array<{ from?: string | null; content?: string | null }>;
  trigger_context?: any;
  delegated_work_context?: any;
  recent_runs_context?: any;
}
const execFileAsync = promisify(execFile);

// Rate limit configuration (sane defaults for safety)
const RATE_LIMIT = {
  requestsPerMinute: 8,
  minTimeBetweenJobs: 2500,
  cooldownAfterQuotaError: 60000,
};

async function fetchCurrentBuzzValue(): Promise<string | null> {
  try {
    const env = {
      ...process.env,
      BUZZ_ONLY: 'true',
      PLAYWRIGHT_PROFILE_DIR: process.env.PLAYWRIGHT_PROFILE_DIR || `${process.cwd()}/.playwright-mcp/google-profile`,
      PLAYWRIGHT_HEADLESS: 'false',
      PLAYWRIGHT_CHANNEL: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
      PLAYWRIGHT_FAST: 'true',
    };
    const { stdout } = await execFileAsync('npx', ['tsx', 'scripts/civitai-read-buzz.ts'], {
      env,
      timeout: 60_000,
    });
    const out = String(stdout || '').trim();
    return out ? out : null;
  } catch (e) {
    return null;
  }
}

async function readLastBuzzSnapshot(): Promise<{ current?: string; previous?: string } | null> {
  try {
    const res = await readRecords({ table_name: 'artifacts', filter: { topic: 'buzz.snapshot' }, limit: 1 });
    const parsed = parseToolResponse(res);
    if (!parsed.success) return null;
    const rows = Array.isArray(parsed.data) ? parsed.data as any[] : (parsed.data?.data ?? []);
    if (!rows || rows.length === 0) return null;
    const content = rows[0]?.content as string;
    try {
      const json = JSON.parse(content);
      return json;
    } catch {
      return { current: content };
    }
  } catch {
    return null;
  }
}

// input is already fully constructed by dispatcher. No extra context resolution needed.

function isInternalServerError(messageLower: string): boolean {
    return (
        messageLower.includes(' 500') ||
        messageLower.includes('status: internal') ||
        messageLower.includes('an internal error has occurred') ||
        messageLower.includes('got status: internal')
    );
}

// Resolve the active job definition id for the current job name
async function resolveActiveJobDefinitionId(jobName: string): Promise<string | null> {
    try {
        const res = await readRecords({ table_name: 'jobs', filter: { name: jobName, is_active: true } });
        const parsed = parseToolResponse(res);
        if (!parsed.success) return null;
        const rows = Array.isArray(parsed.data) ? (parsed.data as any[]) : (parsed.data?.data ?? []);
        if (!rows || rows.length === 0) return null;
        const active = rows.find((r: any) => r.is_active) || rows[0];
        return active?.id ?? null;
    } catch {
        return null;
    }
}

function isRetryableError(error: any): boolean {
    if (!error) return false;
    
    // Handle nested error structures from Agent.run()
    let combined = '';
    const primaryMessage = error?.error?.message ?? error?.message ?? error?.error ?? error;
    // Include stderr from either wrapped or direct error to capture CLI transport errors
    const stderr = (error?.error?.stderr ?? error?.stderr ?? '') as string;
    combined = `${String(primaryMessage || '')}\n${String(stderr || '')}`.toLowerCase();

    workerLogger.debug(`Checking if error is retryable: "${combined.substring(0, 200)}..."`);

    const isRetryable = RETRY_CONFIG.retryableErrors.some(retryableError =>
        combined.includes(retryableError.toLowerCase())
    );
    
    workerLogger.debug(`Error is ${isRetryable ? 'RETRYABLE' : 'NOT RETRYABLE'}`);
    return isRetryable;
}

function calculateRetryDelayWithJitter(retryCount: number): number {
    const base = RETRY_CONFIG.retryDelayMs;
    const noJitter = Math.min(base * Math.pow(2, retryCount), RETRY_CONFIG.maxBackoffMs);
    const jitteredDelay = Math.floor(Math.random() * (noJitter + 1)); // full jitter: [0, noJitter]
    
    workerLogger.debug(`Backoff calculation: base=${base}ms, max=${noJitter}ms, chosen (jitter)=${jitteredDelay}ms`);
    return jitteredDelay;
}

async function collectAndStoreJobReport(context: {
  job: JobBoard;
  workerId: string;
  startTime: number;
  result?: any;
  error?: any;
}) {
  try {
    const report = {
      job_id: context.job.id,
      worker_id: context.workerId,
      status: context.error ? 'FAILED' : 'COMPLETED',
      duration_ms: Date.now() - context.startTime,

      // Telemetry data from agent result
      request_text: context.result?.telemetry?.requestText || null,
      response_text: context.result?.telemetry?.responseText || null,
      final_output: (context.result?.output && String(context.result.output).trim().length > 0)
        ? context.result.output
        : ((context.result?.telemetry?.raw as any)?.partialOutput || null),
      total_tokens: context.result?.telemetry?.totalTokens || 0,
      tools_called: context.result?.telemetry?.toolCalls || [],

      // Error information - include stderr warnings as error messages
      error_message: context.error?.message || context.result?.telemetry?.errorMessage ||
        (context.result?.telemetry?.raw?.stderrWarnings ?
          `Job completed with warnings. Check raw_telemetry.stderrWarnings for details: ${context.result.telemetry.raw.stderrWarnings.substring(0, 100)}${context.result.telemetry.raw.stderrWarnings.length > 100 ? '...' : ''}`
          : null),
      error_type: context.error ? categorizeWorkerError(context.error) :
        (context.result?.telemetry?.errorType ||
          (context.result?.telemetry?.raw?.stderrWarnings ? 'WARNING' : null)),

      // Raw telemetry
      raw_telemetry: context.result?.telemetry?.raw || {}
    };

    workerLogger.info(`Storing job report for ${context.job.id}...`);
    // Ensure MCP tool lineage injection sees correct job context (tools read from env)
    const prevEnv = {
      JINN_JOB_ID: process.env.JINN_JOB_ID,
      JINN_JOB_DEFINITION_ID: process.env.JINN_JOB_DEFINITION_ID,
      JINN_JOB_NAME: process.env.JINN_JOB_NAME,
      JINN_PROJECT_RUN_ID: process.env.JINN_PROJECT_RUN_ID,
      JINN_SOURCE_EVENT_ID: process.env.JINN_SOURCE_EVENT_ID,
      JINN_PROJECT_DEFINITION_ID: process.env.JINN_PROJECT_DEFINITION_ID,
    } as const;
    try {
      process.env.JINN_JOB_ID = context.job.id || '';
      // Prefer explicit job_definition_id if present on row; fall back to parent_job_definition_id
      const jobDefinitionId = (context.job as any).job_definition_id || context.job.parent_job_definition_id || '';
      process.env.JINN_JOB_DEFINITION_ID = jobDefinitionId || '';
      process.env.JINN_JOB_NAME = context.job.job_name || '';
      process.env.JINN_PROJECT_RUN_ID = (context.job.project_run_id ?? '') as string;
      process.env.JINN_SOURCE_EVENT_ID = (context.job.source_event_id ?? '') as string;
      process.env.JINN_PROJECT_DEFINITION_ID = (context.job.project_definition_id ?? '') as string;

      const reportResult = await createRecord({
        table_name: 'job_reports',
        data: report
      });

      // New standardized tool response handling
      const parsed = parseToolResponse(reportResult);
      if (!parsed.success) {
        console.error(`Failed to store job report for ${context.job.id}: ${parsed.error || 'Unknown error'}`);
      } else {
        const newId = parsed.data?.id ?? parsed.data?.data?.id;
        workerLogger.info(`Job report stored successfully for ${context.job.id}${newId ? ` (report_id=${newId})` : ''}`);
        // DB trigger will link job_report_id; no worker-side linking needed
      }
    } finally {
      // Restore previous env to avoid leaking context across jobs
      if (prevEnv.JINN_JOB_ID !== undefined) process.env.JINN_JOB_ID = prevEnv.JINN_JOB_ID; else delete process.env.JINN_JOB_ID;
      if (prevEnv.JINN_JOB_DEFINITION_ID !== undefined) process.env.JINN_JOB_DEFINITION_ID = prevEnv.JINN_JOB_DEFINITION_ID; else delete process.env.JINN_JOB_DEFINITION_ID;
      if (prevEnv.JINN_JOB_NAME !== undefined) process.env.JINN_JOB_NAME = prevEnv.JINN_JOB_NAME; else delete process.env.JINN_JOB_NAME;
      if (prevEnv.JINN_PROJECT_RUN_ID !== undefined) process.env.JINN_PROJECT_RUN_ID = prevEnv.JINN_PROJECT_RUN_ID; else delete process.env.JINN_PROJECT_RUN_ID;
      if (prevEnv.JINN_SOURCE_EVENT_ID !== undefined) process.env.JINN_SOURCE_EVENT_ID = prevEnv.JINN_SOURCE_EVENT_ID; else delete process.env.JINN_SOURCE_EVENT_ID;
      if (prevEnv.JINN_PROJECT_DEFINITION_ID !== undefined) process.env.JINN_PROJECT_DEFINITION_ID = prevEnv.JINN_PROJECT_DEFINITION_ID; else delete process.env.JINN_PROJECT_DEFINITION_ID;
    }
  } catch (error) {
    console.error(`Critical error storing job report for ${context.job.id}:`, error);
    // Don't throw - we don't want report storage failures to break job processing
  }
}

function categorizeWorkerError(error: any): string {
  if (!error) return 'UNKNOWN';

  const message = error.message || String(error);

  if (message.includes('Gemini process exited with code')) return 'PROCESS_ERROR';
  if (message.includes('timeout')) return 'TIMEOUT';
  if (message.includes('ENOTFOUND') || message.includes('network')) return 'NETWORK_ERROR';
  if (message.includes('API') || message.includes('401') || message.includes('403')) return 'API_ERROR';
  if (message.includes('tool') || message.includes('function')) return 'TOOL_ERROR';
  if (message.includes('database') || message.includes('SQL')) return 'DATABASE_ERROR';

  return 'SYSTEM_ERROR';
}

function shouldWaitForRateLimit(): { shouldWait: boolean; waitTime: number; reason: string } {
    const now = Date.now();

    // Check if we're in quota error cooldown
    const quotaCooldownRemaining = quotaErrorTime > 0 ? RATE_LIMIT.cooldownAfterQuotaError - (now - quotaErrorTime) : 0;
    const internalCooldownRemaining = internalErrorCooldownTime > 0 ? INTERNAL_ERROR_COOLDOWN_MS - (now - internalErrorCooldownTime) : 0;

    // Use the longer of the two cooldowns
    if (quotaCooldownRemaining > 0 || internalCooldownRemaining > 0) {
        const maxCooldown = Math.max(quotaCooldownRemaining, internalCooldownRemaining);
        const reason = quotaCooldownRemaining > internalCooldownRemaining 
            ? `Quota error cooldown active, ${Math.round(maxCooldown / 1000)}s remaining`
            : `500/INTERNAL cooldown active, ${Math.round(maxCooldown / 1000)}s remaining`;
        
        return {
            shouldWait: true,
            waitTime: maxCooldown,
            reason
        };
    }

    // Reset job count every minute
    if (now - jobCountResetTime > 60000) {
        jobCount = 0;
        jobCountResetTime = now;
    }

    // Check requests per minute limit
    if (jobCount >= RATE_LIMIT.requestsPerMinute) {
        const remainingTime = 60000 - (now - jobCountResetTime);
        return {
            shouldWait: true,
            waitTime: remainingTime,
            reason: `Rate limit exceeded (${jobCount}/${RATE_LIMIT.requestsPerMinute} per minute), ${Math.round(remainingTime / 1000)}s remaining`
        };
    }

    // Check minimum time between jobs
    const timeSinceLastJob = now - lastJobTime;
    if (lastJobTime > 0 && timeSinceLastJob < RATE_LIMIT.minTimeBetweenJobs) {
        const waitTime = RATE_LIMIT.minTimeBetweenJobs - timeSinceLastJob;
        return {
            shouldWait: true,
            waitTime,
            reason: `Minimum time between jobs not met, ${Math.round(waitTime / 1000)}s remaining`
        };
    }

    return { shouldWait: false, waitTime: 0, reason: '' };
}

// Helper function to parse tool responses and check for failures
function parseToolResponse(response: any): { success: boolean; data: any; error?: string } {
    try {
        if (!response?.content?.[0]?.text) {
            return { success: false, data: null, error: 'No content in tool response' };
        }

        const text = response.content[0].text;
        
        // Check for legacy error format (starts with "Error")
        if (text.startsWith('Error')) {
            return { success: false, data: null, error: text };
        }

        // Parse JSON response
        const parsed = JSON.parse(text);
        
        // Check for new standardized format: { data: ..., meta: { ok: boolean, ... } }
        if (parsed.meta && typeof parsed.meta.ok === 'boolean') {
            if (parsed.meta.ok === false) {
                return { 
                    success: false, 
                    data: parsed.data, 
                    error: parsed.meta.message || parsed.meta.code || 'Tool reported failure' 
                };
            }
            return { success: true, data: parsed.data };
        }

        // Fallback: assume success if no meta.ok field (backward compatibility)
        return { success: true, data: parsed };
    } catch (parseError) {
        return { 
            success: false, 
            data: null, 
            error: `Failed to parse tool response: ${parseError instanceof Error ? parseError.message : String(parseError)}` 
        };
    }
}

// Helper function to create enhanced prompts with error context
function createEnhancedPrompt(originalPrompt: string, error: any, retryCount: number): string {
    const errorContext = extractErrorContext(error);
    
    if (!errorContext) {
        return originalPrompt;
    }

    const enhancement = `\n\n### Error Context (Retry ${retryCount + 1})
The previous attempt failed with the following error:
${errorContext}

Please correct your approach based on this error information.`;

    return originalPrompt + enhancement;
}

// Helper function to extract meaningful error context
function extractErrorContext(error: any): string | null {
    if (!error) return null;
    
    const message = String(error.message || error);
    const stderr = String(error.stderr || '');
    
    // Look for specific error patterns
    if (message.includes('path validation failed') || stderr.includes('path validation failed')) {
        return `Path validation failed: The agent attempted to access files outside the allowed workspace directory.
        
IMPORTANT: Use relative paths from the current working directory (gemini-agent/). 
- Use './' for current directory
- Use '../' to go up one level
- Use './mcp/tools/' instead of absolute paths like '/Users/.../mcp/tools/'

Example correct paths:
- './mcp/tools/read-records.ts'
- './src/app/page.tsx'
- '../worker/worker.ts'`;
    }
    
    if (message.includes('resolves outside the allowed workspace directories') || stderr.includes('resolves outside the allowed workspace directories')) {
        return `Workspace boundary violation: The agent tried to access files outside the allowed directory.
        
The current working directory is 'gemini-agent/' and you can only access files within this project.
Use relative paths and ensure all file operations stay within the project boundaries.`;
    }
    
    if (message.includes('Invalid arguments for tool') || stderr.includes('Invalid arguments for tool')) {
        return `Tool argument validation failed: The agent provided invalid arguments to a tool.
        
IMPORTANT: Check the tool's schema requirements and ensure all arguments match the expected format.
- Verify enum values are from the allowed list
- Check required fields are provided
- Ensure data types match expectations

Common issues:
- Using table names not in the allowed list
- Missing required parameters
- Wrong data types for parameters`;
    }
    
    if (message.includes('Invalid enum value') || stderr.includes('Invalid enum value')) {
        return `Enum validation failed: The agent used a value not in the allowed options.
        
IMPORTANT: When using tools that require specific values, check the available options first.
- Use 'get_schema' to see table names and field options
- Use 'list_tools' to see available tools
- Verify enum values match exactly (case-sensitive)

Example: If a tool expects table_name from ['artifacts', 'job_board', 'jobs'], 
use one of those exact values, not 'search_events' or similar.`;
    }
    
    if (message.includes('MCP error -32602') || stderr.includes('MCP error -32602')) {
        return `MCP protocol error: Invalid arguments were passed to a tool.
        
This usually means the agent provided arguments that don't match the tool's schema.
- Check the tool's description for required parameters
- Verify argument types and values
- Use 'get_schema' to understand table structures before querying`;
    }
    
    // Generic error context
    return `Error: ${message}
${stderr ? `\nAdditional details: ${stderr.substring(0, 500)}` : ''}`;
}

const TOKEN_CONFIG = {
    // Average characters per token
    CHARS_PER_TOKEN: 4,
    // Context size limits
    TRIGGER_CONTEXT_MAX_TOKENS: 10000,
    DELEGATED_WORK_CONTEXT_MAX_TOKENS: 15000,
    // Truncation limits
    ARTIFACT_CONTENT_TRUNCATE_CHARS: 1000,
    JOB_OUTPUT_TRUNCATE_CHARS: 2000,
};

function estimateTokens(obj: any): number {
    if (!obj) return 0;
    const jsonString = JSON.stringify(obj);
    return Math.ceil(jsonString.length / TOKEN_CONFIG.CHARS_PER_TOKEN);
}

function truncateString(str: string | null | undefined, maxLength: number): string {
    if (!str || str.length <= maxLength) return str || '';
    return str.substring(0, maxLength) + '... [truncated]';
}

// Safer JSON stringification for prompts: trims large fields and caps overall size
function stringifyForPrompt(obj: any, options?: { maxChars?: number; largeFieldTruncate?: number }) : string {
    const maxChars = options?.maxChars ?? 12000;
    const largeFieldTruncate = options?.largeFieldTruncate ?? 500;

    const replacer = (_key: string, value: any) => {
        if (typeof value === 'string') {
            // Aggressively trim very large strings
            return value.length > 2000 ? value.slice(0, 2000) + '... [truncated]' : value;
        }
        return value;
    };

    try {
        // Shallow clone and trim heavy fields by name
        const redact = (input: any): any => {
            if (Array.isArray(input)) {
                return input.map(redact);
            }
            if (input && typeof input === 'object') {
                const out: any = {};
                for (const [k, v] of Object.entries(input)) {
                    if (k === 'content' || k === 'output') {
                        if (typeof v === 'string') out[k] = truncateString(v, largeFieldTruncate);
                        else out[k] = v;
                    } else {
                        out[k] = redact(v as any);
                    }
                }
                return out;
            }
            return input;
        };

        const redacted = redact(obj);
        let json = JSON.stringify(redacted, replacer, 2);
        if (json.length > maxChars) {
            json = json.slice(0, maxChars) + '\n... [truncated]';
        }
        return json;
    } catch {
        // Fallback to best-effort
        try {
            const json = JSON.stringify(obj);
            return json.length > maxChars ? json.slice(0, maxChars) + '\n... [truncated]' : json;
        } catch {
            return '[unserializable json]';
        }
    }
}

function truncateContext(context: any, maxTokens: number, isDelegatedWork: boolean): any {
    if (estimateTokens(context) <= maxTokens) return context;

    if (isDelegatedWork && context.child_jobs) {
        // Truncate delegated work context
        const truncatedJobs = context.child_jobs.map((job: any) => {
            return {
                ...job,
                output: truncateString(job.output, TOKEN_CONFIG.JOB_OUTPUT_TRUNCATE_CHARS),
                artifacts: job.artifacts?.map((art: any) => ({
                    ...art,
                    content: truncateString(art.content, TOKEN_CONFIG.ARTIFACT_CONTENT_TRUNCATE_CHARS),
                }))
            };
        });
        return { ...context, child_jobs: truncatedJobs };
    } else if (!isDelegatedWork && context.resolved_source) {
        // Truncate trigger context
        const source = context.resolved_source;
        const truncatedSource = { ...source };
        if (source.output) {
            truncatedSource.output = truncateString(source.output, TOKEN_CONFIG.JOB_OUTPUT_TRUNCATE_CHARS);
        }
        if (source.related_artifacts) {
            truncatedSource.related_artifacts = source.related_artifacts.map((art: any) => ({
                ...art,
                content: truncateString(art.content, TOKEN_CONFIG.ARTIFACT_CONTENT_TRUNCATE_CHARS),
            }));
        }
        return { ...context, resolved_source: truncatedSource };
    }

    return context;
}

async function processPendingJobs(): Promise<boolean> {
    workerLogger.info(`Worker ${workerId} starting up, checking for ${targetJobId ? `targeted job ${targetJobId}` : 'pending jobs'}...`);
    if (debugMode) {
        workerLogger.debug('Worker running in debug mode - Gemini CLI will use --debug flag');
    }

    // Check rate limiting before proceeding
    const rateLimitCheck = shouldWaitForRateLimit();
    if (rateLimitCheck.shouldWait) {
        workerLogger.warn(`[RATE_LIMIT] ${rateLimitCheck.reason}, waiting...`);
        await new Promise(resolve => setTimeout(resolve, rateLimitCheck.waitTime));
    }

    const readResult = await readRecords({
        table_name: 'job_board',
        filter: targetJobId ? { id: targetJobId } : { status: 'PENDING' }
    });

    // Parse tool response and check for failures
    const readParseResult = parseToolResponse(readResult);
    if (!readParseResult.success) {
        workerLogger.error({ error: readParseResult.error }, 'Database read failed');
        return false;
    }

    // Tools now return data-first JSON: { data: [...], meta: {...} }
    let jobs: JobBoard[] = [];
    try {
        const data = readParseResult.data;
        jobs = Array.isArray(data) ? (data as JobBoard[]) : (data?.data ?? []);
    } catch (parseErr) {
        workerLogger.error({ error: parseErr }, 'Failed to parse jobs from database');
        return false;
    }

    if (!jobs || jobs.length === 0) {
        workerLogger.info(targetJobId ? `No job found with id ${targetJobId}` : 'No pending jobs found');
        return false;
    }

    workerLogger.info(targetJobId ? `Found targeted job ${jobs[0].id} (status=${jobs[0].status || 'UNKNOWN'})` : `Found ${jobs.length} pending jobs`);

    // Process one job at a time for now
    const job = jobs[0];

    // If configured, stop immediately when we encounter a Chief Orchestrator job
    if (stopOnChief && job.job_name === 'Chief Orchestrator') {
        workerLogger.info('`--stop-on-chief` flag set; detected Chief Orchestrator job. Exiting without claiming or processing.');
        process.exit(0);
    }

    jobLogger.info({ jobId: job.id, jobName: job.job_name, forced: !!targetJobId }, 'Attempting to claim job');
    const startTime = Date.now();
    let result: any = null;
    let error: any = null;
    let retryCount = 0;

    // Retry loop for the job execution
    while (retryCount <= RETRY_CONFIG.maxRetries) {
        error = null; // Reset error state for each attempt
        
        const composeJobHeader = (job: JobBoard): string => {
            const lines = [
                '### Your Current Job Context',
                `- **Job Name:** \`${job.job_name}\``,
                `- **Job ID:** \`${job.id}\``,
                `- **Project Definition ID:** \`${job.project_definition_id || 'N/A'}\``
            ];
            return lines.join('\n') + '\n\n';
        };

        // Compose final prompt with inbox (if available)
        const composeInboxSection = (inbox?: Array<{ from?: string | null; content?: string | null }>): string => {
            if (!Array.isArray(inbox) || inbox.length === 0) return '';
            const lines = inbox.slice(0, 10).map((m, idx) => {
                const from = m?.from ?? 'unknown';
                const content = (m?.content ?? '').toString();
                return `- [${idx + 1}] from ${from}: ${content}`;
            });
            return `\n\n### Inbox (recent messages)\n${lines.join('\n')}`;
        };

        const composeTriggerContextSection = (triggerContext?: any): string => {
            if (!triggerContext) return '';
            const json = stringifyForPrompt(triggerContext, { maxChars: 10000, largeFieldTruncate: 400 });
            return `\n\n### Trigger Context\n\n${json}`;
        };

        const composeDelegatedWorkContextSection = (delegatedWorkContext?: any): string => {
            if (!delegatedWorkContext) return '';
            const json = stringifyForPrompt(delegatedWorkContext, { maxChars: 14000, largeFieldTruncate: 400 });
            return `\n\n### Delegated Work Context\n\n${json}`;
        };

        const composeRecentRunsContextSection = (recentRunsContext?: any): string => {
            if (!recentRunsContext) return '';
            const json = stringifyForPrompt(recentRunsContext, { maxChars: 8000, largeFieldTruncate: 300 });
            return `\n\n### Recent Runs Context\n\n${json}`;
        };

        // Store the original prompt for potential retries
        const jobHeader = composeJobHeader(job);
        const inboxSection = composeInboxSection(job.inbox);
        const triggerContextSection = composeTriggerContextSection(truncateContext(job.trigger_context, TOKEN_CONFIG.TRIGGER_CONTEXT_MAX_TOKENS, false));
        const delegatedWorkContextSection = composeDelegatedWorkContextSection(truncateContext(job.delegated_work_context, TOKEN_CONFIG.DELEGATED_WORK_CONTEXT_MAX_TOKENS, true));
        const recentRunsContextSection = composeRecentRunsContextSection(job.recent_runs_context);
        const rawPrompt = `${jobHeader}${job.input || ''}${inboxSection}${triggerContextSection}${delegatedWorkContextSection}${recentRunsContextSection}`.trim();
        
        // Sanitize the prompt to prevent shell interpretation issues
        const sanitizePrompt = (prompt: string): string => {
          return prompt
            .replace(/\r\n/g, '\n')           // Normalize line endings
            .replace(/\r/g, '\n')             // Convert carriage returns to newlines
            .replace(/\n+/g, '\n')            // Collapse multiple newlines to single
            .replace(/[^\x20-\x7E\n]/g, '')  // Remove non-printable ASCII characters
            .trim();
        };
        
        const originalPrompt = sanitizePrompt(rawPrompt);
        let currentPrompt = originalPrompt;
        
        try {
        // Safety: avoid stealing a job actively owned by another worker when forcing by id
        if (targetJobId && job.status === 'IN_PROGRESS' && job.worker_id && job.worker_id !== workerId) {
            throw new Error(`Refusing to force-run job ${job.id} because it is already IN_PROGRESS by worker ${job.worker_id}`);
        }

        // Claim the job by setting status to IN_PROGRESS and adding worker_id
        const claimResult = await updateRecords({
            table_name: 'job_board',
            filter: targetJobId ? { id: job.id } : { id: job.id, status: 'PENDING' }, // When targeted, bypass status predicate
            updates: {
                status: 'IN_PROGRESS',
                worker_id: workerId
            }
        });

        const claimParseResult = parseToolResponse(claimResult);
        if (!claimParseResult.success) {
            throw new Error(`Failed to claim job: ${claimParseResult.error}`);
        }
        jobLogger.info({ jobId: job.id, jobName: job.job_name, workerId }, 'Job claimed and status updated to IN_PROGRESS');

        const model = job.model_settings.model || 'gemini-2.5-pro';
        const enabledTools = job.enabled_tools;

        jobLogger.info({ jobId: job.id, jobName: job.job_name, model }, 'Job execution started');

        const jobContext = {
            jobId: job.id,
            jobDefinitionId: (job as any).job_definition_id || job.parent_job_definition_id || null,
            jobName: job.job_name,
            projectRunId: job.project_run_id ?? null,
            sourceEventId: job.source_event_id ?? null,
            projectDefinitionId: job.project_definition_id ?? null
        };
        
        jobLogger.debug({ jobContext }, 'Passing context to agent');

        // Check rate limits before each attempt (including retries)
        const gate = shouldWaitForRateLimit();
        if (gate.shouldWait) {
            workerLogger.warn(`[RATE_LIMIT] ${gate.reason}, waiting...`);
            await new Promise(resolve => setTimeout(resolve, gate.waitTime));
        }

        // Update rate limiting counters before job execution
        lastJobTime = Date.now();
        jobCount++;

        jobLogger.retry(job.id, retryCount + 1, RETRY_CONFIG.maxRetries);

        // Inject Buzz snapshot for Chief Orchestrator
        if (job.job_name === 'Chief Orchestrator') {
            try {
                const current = await fetchCurrentBuzzValue();
                const last = await readLastBuzzSnapshot();
                if (current) {
                    const snapshot = {
                        current,
                        previous: last?.current || last?.previous || null,
                        captured_at: new Date().toISOString(),
                    };
                    // Persist as artifact with correct MCP lineage env
                    const prevEnvBuzz = {
                      JINN_JOB_ID: process.env.JINN_JOB_ID,
                      JINN_JOB_DEFINITION_ID: process.env.JINN_JOB_DEFINITION_ID,
                      JINN_JOB_NAME: process.env.JINN_JOB_NAME,
                      JINN_PROJECT_RUN_ID: process.env.JINN_PROJECT_RUN_ID,
                      JINN_SOURCE_EVENT_ID: process.env.JINN_SOURCE_EVENT_ID,
                      JINN_PROJECT_DEFINITION_ID: process.env.JINN_PROJECT_DEFINITION_ID,
                    } as const;
                    try {
                      process.env.JINN_JOB_ID = job.id || '';
                      // Prefer explicit job_definition_id if present on row; fall back to parent_job_definition_id
                      const jobDefinitionId = (job as any).job_definition_id || job.parent_job_definition_id || '';
                      process.env.JINN_JOB_DEFINITION_ID = jobDefinitionId || '';
                      process.env.JINN_JOB_NAME = job.job_name || '';
                      process.env.JINN_PROJECT_RUN_ID = (job.project_run_id ?? '') as string;
                      process.env.JINN_SOURCE_EVENT_ID = (job.source_event_id ?? '') as string;
                      process.env.JINN_PROJECT_DEFINITION_ID = (job.project_definition_id ?? '') as string;

                      await createRecord({
                        table_name: 'artifacts',
                        data: {
                          topic: 'buzz.snapshot',
                          status: 'RAW',
                          content: JSON.stringify(snapshot),
                        }
                      });
                    } finally {
                      // restore env
                      if (prevEnvBuzz.JINN_JOB_ID !== undefined) process.env.JINN_JOB_ID = prevEnvBuzz.JINN_JOB_ID; else delete process.env.JINN_JOB_ID;
                      if (prevEnvBuzz.JINN_JOB_DEFINITION_ID !== undefined) process.env.JINN_JOB_DEFINITION_ID = prevEnvBuzz.JINN_JOB_DEFINITION_ID; else delete process.env.JINN_JOB_DEFINITION_ID;
                      if (prevEnvBuzz.JINN_JOB_NAME !== undefined) process.env.JINN_JOB_NAME = prevEnvBuzz.JINN_JOB_NAME; else delete process.env.JINN_JOB_NAME;
                      if (prevEnvBuzz.JINN_PROJECT_RUN_ID !== undefined) process.env.JINN_PROJECT_RUN_ID = prevEnvBuzz.JINN_PROJECT_RUN_ID; else delete process.env.JINN_PROJECT_RUN_ID;
                      if (prevEnvBuzz.JINN_SOURCE_EVENT_ID !== undefined) process.env.JINN_SOURCE_EVENT_ID = prevEnvBuzz.JINN_SOURCE_EVENT_ID; else delete process.env.JINN_SOURCE_EVENT_ID;
                      if (prevEnvBuzz.JINN_PROJECT_DEFINITION_ID !== undefined) process.env.JINN_PROJECT_DEFINITION_ID = prevEnvBuzz.JINN_PROJECT_DEFINITION_ID; else delete process.env.JINN_PROJECT_DEFINITION_ID;
                    }
                    // Prepend snapshot to prompt header for agent visibility
                    const buzzHeader = `\n\n### Buzz Snapshot\n- Current Buzz: ${snapshot.current}${snapshot.previous ? `\n- Previous: ${snapshot.previous}` : ''}`;
                    // Extend raw prompt
                    currentPrompt = `${buzzHeader}\n\n${currentPrompt}`;
                }
            } catch {
                // Non-fatal
            }
        }
        
        // Create agent with current prompt (which may be enhanced on retries)
        const agent = new Agent(model, enabledTools, jobContext);
        result = await agent.run(currentPrompt);
        workerLogger.info(`Job ${job.id} execution finished.`);

        const updateResult = await updateRecords({
            table_name: 'job_board',
            filter: { id: job.id },
            updates: {
                status: 'COMPLETED',
                output: result.output
            }
        });

        const updateParseResult = parseToolResponse(updateResult);
        if (!updateParseResult.success) {
            throw new Error(`Failed to update job to COMPLETED: ${updateParseResult.error}`);
        }
        jobLogger.completed(job.id);

    } catch (err: any) {
        console.error(`Job ${job.id} failed:`, err);

        // Check if this is a quota error or 500/INTERNAL error and set cooldown
        // Handle the special error format from Agent.run() which includes telemetry
        let errorMessage: string;
        if (err && typeof err === 'object' && 'error' in err && 'telemetry' in err) {
          // This is the Agent.run() error format: { error: Error, telemetry: JobTelemetry }
          errorMessage = String((err as any).error?.message || (err as any).error || 'Unknown error');
        } else {
          errorMessage = String((err as any).error || err.message || err);
        }
        const errorMessageLower = errorMessage.toLowerCase();
        
        if (errorMessage.includes('429') ||
            errorMessage.includes('quota') ||
            errorMessage.includes('resource_exhausted') ||
            errorMessage.includes('too many requests')) {
            workerLogger.warn(`[RATE_LIMIT] Quota error detected, activating cooldown period (${RATE_LIMIT.cooldownAfterQuotaError}ms)`);
            quotaErrorTime = Date.now();
        } else if (isInternalServerError(errorMessageLower)) {
            workerLogger.warn(`[RATE_LIMIT] 500/INTERNAL detected, activating short cooldown (${INTERNAL_ERROR_COOLDOWN_MS}ms)`);
            internalErrorCooldownTime = Date.now();
        }

        // Handle the special error format from Agent.run() which includes telemetry
        if (err && typeof err === 'object' && 'error' in err && 'telemetry' in err) {
            error = (err as any).error;
            result = { output: '', telemetry: (err as any).telemetry };
            workerLogger.error({ jobId: job.id, telemetry: (err as any).telemetry }, `Job failed but captured error telemetry`);
        } else {
            error = err;
        }

        // Check if error is retryable, but force non-retryable on TIMEOUTs from Agent telemetry
        let isRetryable = isRetryableError(error);
        try {
            // If Agent surfaced telemetry with TIMEOUT classification or timeout termination marker, do not retry
            const t = (err && typeof err === 'object' && 'telemetry' in (err as any)) ? (err as any).telemetry : undefined;
            const isTimeoutCategory = t?.errorType === 'TIMEOUT';
            const po: string | undefined = t?.raw?.partialOutput;
            const hasTimeoutMarker = typeof po === 'string' && /\[PROCESS TERMINATED:\s*Process timeout/i.test(po);
            if (isTimeoutCategory || hasTimeoutMarker) {
                isRetryable = false;
                workerLogger.warn({ jobId: job.id }, 'Timeout detected; treating as non-retryable to persist partial output');
            }
        } catch {}
        if (isRetryable && retryCount < RETRY_CONFIG.maxRetries) {
            retryCount++;
            const retryDelay = calculateRetryDelayWithJitter(retryCount);
            workerLogger.warn({ jobId: job.id, retryCount, maxRetries: RETRY_CONFIG.maxRetries, retryDelay }, `Job failed with retryable error, retrying...`);
            
            // Create an enhanced prompt for the retry
            const enhancedPrompt = createEnhancedPrompt(originalPrompt, error, retryCount - 1);
            currentPrompt = enhancedPrompt; // Update the prompt for the next retry
            workerLogger.debug({ jobId: job.id, retryCount }, `Enhanced prompt created for retry`);
            workerLogger.debug({ originalPromptLength: originalPrompt.length }, `Original prompt length`);
            workerLogger.debug({ enhancedPromptLength: enhancedPrompt.length }, `Enhanced prompt length`);
            workerLogger.debug({ errorContextPreview: enhancedPrompt.substring(originalPrompt.length).substring(0, 200) }, `Error context added to retry prompt`);

            // Reset job status to PENDING so it can be retried
            const resetResult = await updateRecords({
                table_name: 'job_board',
                filter: { id: job.id },
                updates: {
                    status: 'PENDING',
                    worker_id: null
                }
            });
            
            const resetParseResult = parseToolResponse(resetResult);
            if (!resetParseResult.success) {
                console.error(`Failed to reset job status to PENDING: ${resetParseResult.error}`);
            }
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            
            // Continue to next iteration of retry loop
            continue;
        }

        // If we reach here, either error is not retryable or max retries exceeded
        const errorMsg = error instanceof Error ? error.message : String(error);
        const reason = !isRetryable ? 'error not retryable' : 'max retries exceeded';
        workerLogger.info({ jobId: job.id, reason, isRetryable, retryCount }, `Job not retrying`);
        
        // Prefer partial output captured by the Agent telemetry when available
        let failedOutput: string = '';
        try {
            const partial = (result?.telemetry?.raw as any)?.partialOutput;
            if (typeof partial === 'string' && partial.trim().length > 0) {
                failedOutput = partial;
            } else if (typeof result?.output === 'string' && result.output.trim().length > 0) {
                failedOutput = result.output;
            }
        } catch {}

        const finalUpdate = await updateRecords({
            table_name: 'job_board',
            filter: { id: job.id },
            updates: {
                status: 'FAILED',
                // Store structured error context alongside any partial output
                output: JSON.stringify({ error: errorMsg, retryCount, partial_output: failedOutput })
            }
        });
        
        const finalUpdateParseResult = parseToolResponse(finalUpdate);
        if (!finalUpdateParseResult.success) {
            console.error(`CRITICAL: Failed to even update the job to FAILED status. Job ID: ${job.id}. Error: ${finalUpdateParseResult.error}`);
        }
        break; // Exit retry loop on failure
        }

        // Success case - exit retry loop
        if (!error) {
            break;
        }
    }

    // Always collect and store job report regardless of success/failure
    workerLogger.info(`Collecting and storing job report for ${job.id}...`);
    try {
        await collectAndStoreJobReport({
            job,
            workerId,
            startTime,
            result,
            error
        });
        workerLogger.info(`Job report collection completed for ${job.id}`);
    } catch (reportError) {
        console.error(`Failed to collect job report for ${job.id}:`, reportError);
    }
    return true; // A job was processed
}

async function main() {
    workerLogger.info({ workerId, singleJobMode, targetJobId, debugMode, stopOnChief }, 'Worker starting up');

    const transactionProcessor = new TransactionProcessor(supabaseUrl!, supabaseKey!, workerId);

    if (singleJobMode) {
        await processPendingJobs();
        await transactionProcessor.processPendingTransaction();
        workerLogger.info("Single job/transaction processed. Exiting.");
        process.exit(0);
    }

    while (true) {
        try {
            const jobProcessed = await processPendingJobs();
            const transactionProcessed = await transactionProcessor.processPendingTransaction();

            if (!jobProcessed && !transactionProcessed) {
                const delay = 5000;
                workerLogger.debug(`No jobs or transactions found, waiting ${delay}ms.`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else if (!transactionProcessed) {
                // If no transaction was processed, add a small delay to prevent high CPU usage
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (error) {
            console.error("Critical error in main loop. Waiting 30 seconds before retrying.", error);
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }
}

main();
