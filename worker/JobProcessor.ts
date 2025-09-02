import { Agent } from '../gemini-agent/agent.js';
import { readRecords } from '../gemini-agent/mcp/tools/read-records.js';
import { updateRecords } from '../gemini-agent/mcp/tools/update-records.js';
import { createRecord } from '../gemini-agent/mcp/tools/create-record.js';
import { JobBoard } from './types.js';
import { logger } from './logger.js';

const jobLogger = logger.child({ component: 'JobProcessor' });

const RATE_LIMIT = {
    requestsPerMinute: 50,
    cooldownAfterQuotaError: 5 * 60 * 1000,
    minTimeBetweenJobs: 2000,
};

const RETRY_CONFIG = {
    maxRetries: 3,
    retryDelayMs: 5000,
    maxBackoffMs: 120000,
    exponentialBackoff: true,
    retryableErrors: [ '500', 'INTERNAL', 'An internal error has occurred', 'got status: INTERNAL', 'Error when talking to Gemini API', 'timeout', 'network', 'ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED' ]
};

const INTERNAL_ERROR_COOLDOWN_MS = 90000;

let lastJobTime = 0;
let quotaErrorTime = 0;
let internalErrorCooldownTime = 0;
let jobCount = 0;
let jobCountResetTime = Date.now();

function buildPromptWithContext(job: JobBoard, promptContent: string, inputContext: string | null): string {
    let finalPrompt = `You are executing as job "${job.job_name}" (Definition ID: ${job.job_definition_id}).\n\n---\n\n${promptContent}`;
    if (inputContext) {
        try {
            const contextData = JSON.parse(inputContext);
            if (contextData && Object.keys(contextData).length > 0) {
                finalPrompt += '\n\nAdditional Context:\n';
                for (const [key, value] of Object.entries(contextData)) {
                    finalPrompt += `- ${key}: ${JSON.stringify(value)}\n`;
                }
            }
        } catch (error) {
            finalPrompt += `\n\nAdditional Context:\n${inputContext}`;
        }
    }
    return finalPrompt;
}

async function resolveThreadId(job: JobBoard): Promise<string | null> {
    if (!job.input_context) return null;
    try {
        const contextData = JSON.parse(job.input_context);
        if (contextData?.thread_id) return contextData.thread_id;
        if (contextData?.trigger_event?.thread_id) return contextData.trigger_event.thread_id;
        if (contextData?.objective && contextData?.id) return contextData.id;
    } catch (error) {
        try {
            const pairs = job.input_context.split(',');
            const contextData: Record<string, string> = {};
            for (const pair of pairs) {
                const [key, value] = pair.split(':');
                if (key && value) contextData[key.trim()] = value.trim();
            }
            if (contextData.thread_id) return contextData.thread_id;
        } catch (parseError) {
            jobLogger.warn({ jobId: job.id, context: job.input_context }, "Could not parse input_context.");
            return null;
        }
    }
    return null;
}

function isInternalServerError(messageLower: string): boolean {
    return messageLower.includes(' 500') || messageLower.includes('status: internal') || messageLower.includes('an internal error has occurred') || messageLower.includes('got status: internal');
}

function isRetryableError(error: any): boolean {
    let message = String(error?.error?.message || error?.message || error?.error || error);
    message = message.toLowerCase();
    const isRetryable = RETRY_CONFIG.retryableErrors.some(retryableError => message.includes(retryableError.toLowerCase()));
    jobLogger.info({ isRetryable }, `Checking if error is retryable: "${message.substring(0, 200)}..."`);
    return isRetryable;
}

function calculateRetryDelayWithJitter(retryCount: number): number {
    const base = RETRY_CONFIG.retryDelayMs;
    const noJitter = Math.min(base * Math.pow(2, retryCount), RETRY_CONFIG.maxBackoffMs);
    const jitteredDelay = Math.floor(Math.random() * (noJitter + 1));
    jobLogger.info({ base, max: noJitter, chosen: jitteredDelay }, "Backoff calculation");
    return jitteredDelay;
}

function categorizeWorkerError(error: any): string {
    const message = String(error?.message || error);
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
    const quotaCooldownRemaining = quotaErrorTime > 0 ? RATE_LIMIT.cooldownAfterQuotaError - (now - quotaErrorTime) : 0;
    const internalCooldownRemaining = internalErrorCooldownTime > 0 ? INTERNAL_ERROR_COOLDOWN_MS - (now - internalErrorCooldownTime) : 0;

    if (quotaCooldownRemaining > 0 || internalCooldownRemaining > 0) {
        const maxCooldown = Math.max(quotaCooldownRemaining, internalCooldownRemaining);
        const reason = quotaCooldownRemaining > internalCooldownRemaining ? `Quota error cooldown active` : `500/INTERNAL cooldown active`;
        return { shouldWait: true, waitTime: maxCooldown, reason: `${reason}, ${Math.round(maxCooldown / 1000)}s remaining` };
    }

    if (now - jobCountResetTime > 60000) {
        jobCount = 0;
        jobCountResetTime = now;
    }

    if (jobCount >= RATE_LIMIT.requestsPerMinute) {
        const remainingTime = 60000 - (now - jobCountResetTime);
        return { shouldWait: true, waitTime: remainingTime, reason: `Rate limit exceeded (${jobCount}/${RATE_LIMIT.requestsPerMinute} per minute)` };
    }

    const timeSinceLastJob = now - lastJobTime;
    if (lastJobTime > 0 && timeSinceLastJob < RATE_LIMIT.minTimeBetweenJobs) {
        const waitTime = RATE_LIMIT.minTimeBetweenJobs - timeSinceLastJob;
        return { shouldWait: true, waitTime, reason: `Minimum time between jobs not met` };
    }

    return { shouldWait: false, waitTime: 0, reason: '' };
}

export async function processJob(job: JobBoard, workerId: string, debugMode: boolean, targetJobId: string | null): Promise<void> {
    const threadId = await resolveThreadId(job);
    jobLogger.info({ jobId: job.id, threadId }, "Processing job");

    const startTime = Date.now();
    let result = null;
    let error: any = null;
    let retryCount = 0;

    while (retryCount <= RETRY_CONFIG.maxRetries) {
        error = null;
        try {
            if (targetJobId && job.status === 'IN_PROGRESS' && job.worker_id && job.worker_id !== workerId) {
                throw new Error(`Refusing to force-run job ${job.id} because it is already IN_PROGRESS by worker ${job.worker_id}`);
            }

            await updateRecords({
                table_name: 'job_board',
                filter: targetJobId ? { id: job.id } : { id: job.id, status: 'PENDING' },
                updates: { status: 'IN_PROGRESS', worker_id: workerId }
            });
            jobLogger.info({ jobId: job.id }, "Job claimed");

            const finalPrompt = buildPromptWithContext(job, job.input_prompt, job.input_context);
            const model = job.model_settings?.model || 'gemini-1.5-flash-latest';

            const agent = new Agent(model, job.enabled_tools, { jobId: job.id, jobName: job.job_name, threadId: threadId, telemetry: true });

            const gate = shouldWaitForRateLimit();
            if (gate.shouldWait) {
                jobLogger.info({ reason: gate.reason }, "Waiting due to rate limit");
                await new Promise(resolve => setTimeout(resolve, gate.waitTime));
            }

            lastJobTime = Date.now();
            jobCount++;

            jobLogger.info({ jobId: job.id, attempt: retryCount + 1 }, "Starting agent run");
            result = await agent.run(finalPrompt);
            jobLogger.info({ jobId: job.id, output: result.output }, "Agent run finished");

            await updateRecords({
                table_name: 'job_board',
                filter: { id: job.id },
                updates: { status: 'COMPLETED', output: result.output }
            });
            jobLogger.info({ jobId: job.id }, "Job completed successfully");
            break;

        } catch (err: any) {
            jobLogger.error({ jobId: job.id, err }, "Job failed");

            const errorMessage = String(err.error || err.message || err);
            const errorMessageLower = errorMessage.toLowerCase();

            if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('resource_exhausted') || errorMessage.includes('too many requests')) {
                jobLogger.warn("Quota error detected, activating cooldown");
                quotaErrorTime = Date.now();
            } else if (isInternalServerError(errorMessageLower)) {
                jobLogger.warn("500/INTERNAL error detected, activating short cooldown");
                internalErrorCooldownTime = Date.now();
            }

            if (err && typeof err === 'object' && 'error' in err && 'telemetry' in err) {
                error = err.error;
                result = { output: '', telemetry: err.telemetry };
            } else {
                error = err;
            }

            if (isRetryableError(error) && retryCount < RETRY_CONFIG.maxRetries) {
                retryCount++;
                const retryDelay = calculateRetryDelayWithJitter(retryCount);
                jobLogger.info({ jobId: job.id, retry: retryCount, maxRetries: RETRY_CONFIG.maxRetries, delay: retryDelay }, "Retrying job");

                await updateRecords({ table_name: 'job_board', filter: { id: job.id }, updates: { status: 'PENDING', worker_id: null } });
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }

            const reason = !isRetryableError(error) ? 'error not retryable' : 'max retries exceeded';
            jobLogger.warn({ jobId: job.id, reason }, "Not retrying job");
            await updateRecords({ table_name: 'job_board', filter: { id: job.id }, updates: { status: 'FAILED', output: JSON.stringify({ error: String(error), retryCount }) } });
            break;
        }
    }

    await collectAndStoreJobReport({ job, workerId, startTime, result, error });
}

async function collectAndStoreJobReport(context: { job: JobBoard; workerId: string; startTime: number; result?: any; error?: any; }) {
    try {
        const report = {
            job_id: context.job.id,
            worker_id: context.workerId,
            status: context.error ? 'FAILED' : 'COMPLETED',
            duration_ms: Date.now() - context.startTime,
            request_text: context.result?.telemetry?.requestText,
            response_text: context.result?.telemetry?.responseText,
            final_output: context.result?.output,
            total_tokens: context.result?.telemetry?.totalTokens || 0,
            tools_called: context.result?.telemetry?.toolCalls || [],
            error_message: context.error?.message || context.result?.telemetry?.errorMessage || (context.result?.telemetry?.raw?.stderrWarnings ? `Job completed with warnings. Check raw_telemetry.stderrWarnings for details: ${context.result.telemetry.raw.stderrWarnings.substring(0, 100)}...` : null),
            error_type: context.error ? categorizeWorkerError(context.error) : (context.result?.telemetry?.errorType || (context.result?.telemetry?.raw?.stderrWarnings ? 'WARNING' : null)),
            raw_telemetry: context.result?.telemetry?.raw || {}
        };

        const reportResult = await createRecord({ table_name: 'job_reports', data: report });
        if (reportResult.content?.[0]?.text?.startsWith('Error')) {
            jobLogger.error({ jobId: context.job.id, error: reportResult.content[0].text }, "Failed to store job report");
        } else {
            jobLogger.info({ jobId: context.job.id }, "Job report stored successfully");
        }
    } catch (error) {
        jobLogger.error({ jobId: context.job.id, error }, "Critical error storing job report");
    }
}
