import { Agent } from '../gemini-agent/agent.js';
import { readRecords } from '../packages/metacog-mcp/src/tools/read-records.js';
import { updateRecords } from '../packages/metacog-mcp/src/tools/update-records.js';
import { createRecord } from '../packages/metacog-mcp/src/tools/create-record.js';

// Check for command line flags
const debugMode = process.argv.includes('--debug') || process.argv.includes('-d');
const singleJobMode = process.argv.includes('--single-job');

// Simple unique ID generator for the worker
const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// Rate limiting configuration
const RATE_LIMIT = {
    requestsPerMinute: 50, // Conservative rate to stay under Gemini CLI limits
    cooldownAfterQuotaError: 5 * 60 * 1000, // 5 minutes cooldown after quota errors
    minTimeBetweenJobs: 2000, // 2 seconds minimum between jobs
};

// Global rate limiting state
let lastJobTime = 0;
let quotaErrorTime = 0;
let jobCount = 0;
let jobCountResetTime = Date.now();

// Represents the structure of the job_board table row
interface JobBoard {
  id: string;
  status: string;
  worker_id?: string;
  input_prompt: string;
  input_context: string | null; // This is expected to be a JSON string or null
  enabled_tools: string[];
  model_settings: Record<string, any>;
  job_definition_id: string;
  job_name: string;
}

function buildPromptWithContext(job: JobBoard, promptContent: string, inputContext: string | null): string {
  // Add the job's identity to the top of the prompt
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
      // If it's not JSON, treat it as plain text context
      finalPrompt += `\n\nAdditional Context:\n${inputContext}`;
    }
  }

  return finalPrompt;
}

async function resolveThreadId(job: JobBoard): Promise<string | null> {
    if (!job.input_context) {
        return null;
    }

    try {
        const contextData = JSON.parse(job.input_context);

        // The context is often the triggering record itself (e.g., an artifact).
        if (contextData && contextData.thread_id) {
            console.log(`[CONTEXT] Resolved threadId '${contextData.thread_id}' from job ${job.id}'s input_context.`);
            return contextData.thread_id;
        }

        // If the triggering record was a thread itself, its ID is the thread_id.
        if (contextData && contextData.objective && contextData.id) {
             console.log(`[CONTEXT] Resolved threadId '${contextData.id}' from job ${job.id}'s input_context (triggering record was a thread).`);
            return contextData.id;
        }

    } catch (error) {
        console.warn(`[CONTEXT] Could not parse input_context for job ${job.id} to find a threadId. Context was not valid JSON.`, job.input_context);
        return null;
    }

    console.log(`[CONTEXT] No threadId found in input_context for job ${job.id}.`);
    return null;
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
      final_output: context.result?.output || null,
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

    console.log(`Storing job report for ${context.job.id}...`);
    const reportResult = await createRecord({
      table_name: 'job_reports',
      data: report
    });

    if (reportResult.content?.[0]?.text?.startsWith('Error')) {
      console.error(`Failed to store job report: ${reportResult.content[0].text}`);
    } else {
      console.log(`Job report stored successfully for ${context.job.id} (automatic linking via DB trigger)`);
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
    if (quotaErrorTime > 0 && (now - quotaErrorTime) < RATE_LIMIT.cooldownAfterQuotaError) {
        const remainingCooldown = RATE_LIMIT.cooldownAfterQuotaError - (now - quotaErrorTime);
        return {
            shouldWait: true,
            waitTime: remainingCooldown,
            reason: `Quota error cooldown active, ${Math.round(remainingCooldown / 1000)}s remaining`
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

async function processPendingJobs(): Promise<boolean> {
    console.log(`Worker ${workerId} starting up, checking for pending jobs...`);
    if (debugMode) {
        console.log(`[DEBUG] Worker running in debug mode - Gemini CLI will use --debug flag`);
    }

    // Check rate limiting before proceeding
    const rateLimitCheck = shouldWaitForRateLimit();
    if (rateLimitCheck.shouldWait) {
        console.log(`[RATE_LIMIT] ${rateLimitCheck.reason}, waiting...`);
        await new Promise(resolve => setTimeout(resolve, rateLimitCheck.waitTime));
    }

    const readResult = await readRecords({ table_name: 'job_board', filter: { status: 'PENDING' } });

    if (!readResult.content || !readResult.content[0] || readResult.content[0].type !== 'text') {
        console.error('Failed to read jobs from database or unexpected format.', readResult);
        return false;
    }

    console.log('Raw read result:', readResult.content[0].text);

    // Check if the result is an error message
    if (readResult.content[0].text.startsWith('Error')) {
        console.error('Database read error:', readResult.content[0].text);
        return false;
    }

    const jobs: JobBoard[] = JSON.parse(readResult.content[0].text);

    if (!jobs || jobs.length === 0) {
        console.log("No pending jobs found.");
        return false;
    }

    console.log(`Found ${jobs.length} pending jobs.`);

    // Process one job at a time for now
    const job = jobs[0];

    // Resolve the threadId from the job's context before execution
    const threadId = await resolveThreadId(job);

    console.log(`Attempting to claim job ${job.id}...`);
    const startTime = Date.now();
    let result = null;
    let error = null;

    try {
        // Claim the job by setting status to IN_PROGRESS and adding worker_id
        await updateRecords({
            table_name: 'job_board',
            filter: { id: job.id, status: 'PENDING' }, // Ensure we only update if it's still pending
            updates: {
                status: 'IN_PROGRESS',
                worker_id: workerId
            }
        });
        console.log(`Job ${job.id} claimed by worker ${workerId} and status updated to IN_PROGRESS.`);

        const finalPrompt = buildPromptWithContext(job, job.input_prompt, job.input_context);
        const model = job.model_settings.model || 'gemini-2.5-flash';
        const enabledTools = job.enabled_tools;

        console.log(`Executing job ${job.id} with model ${model}`);

        const agent = new Agent(model, enabledTools, {
            jobId: job.id,
            jobName: job.job_name,
            threadId: threadId
        });
        // Update rate limiting counters before job execution
        lastJobTime = Date.now();
        jobCount++;

        result = await agent.run(finalPrompt);
        console.log(`Job ${job.id} execution finished.`);
        console.log(`Agent output for job ${job.id}:\n`, result.output);

        const updateResult = await updateRecords({
            table_name: 'job_board',
            filter: { id: job.id },
            updates: {
                status: 'COMPLETED',
                output: result.output
            }
        });

        if (updateResult.content[0].text.startsWith('Error')) {
            throw new Error(`Failed to update job to COMPLETED: ${updateResult.content[0].text}`);
        }
        console.log(`Job ${job.id} completed successfully.`);

    } catch (err) {
        console.error(`Job ${job.id} failed:`, err);

        // Check if this is a quota error and set cooldown
        const errorMessage = String(err.error || err.message || err);
        if (errorMessage.includes('429') ||
            errorMessage.includes('quota') ||
            errorMessage.includes('resource_exhausted') ||
            errorMessage.includes('too many requests')) {
            console.log(`[RATE_LIMIT] Quota error detected, activating cooldown period`);
            quotaErrorTime = Date.now();
        }

        // Handle the special error format from Agent.run() which includes telemetry
        if (err && typeof err === 'object' && 'error' in err && 'telemetry' in err) {
            error = err.error;
            result = { output: '', telemetry: err.telemetry };
            console.log(`Job ${job.id} failed but captured error telemetry:`, err.telemetry);
        } else {
            error = err;
        }

        const errorMsg = error instanceof Error ? error.message : String(error);
        const finalUpdate = await updateRecords({
            table_name: 'job_board',
            filter: { id: job.id },
            updates: {
                status: 'FAILED',
                output: JSON.stringify({ error: errorMsg })
            }
        });
        if (finalUpdate.content[0].text.startsWith('Error')) {
            console.error(`CRITICAL: Failed to even update the job to FAILED status. Job ID: ${job.id}. Error: ${finalUpdate.content[0].text}`);
        }
    } finally {
        console.log(`Collecting and storing job report for ${job.id}...`);
        try {
            // Always collect and store job report regardless of success/failure
            await collectAndStoreJobReport({
                job,
                workerId,
                startTime,
                result,
                error
            });
            console.log(`Job report collection completed for ${job.id}`);
        } catch (reportError) {
            console.error(`Failed to collect job report for ${job.id}:`, reportError);
        }
        return true; // A job was processed
    }
}

async function main() {
    console.log("Starting worker...");
    if (singleJobMode) {
        console.log("[LIFECYCLE] Running in --single-job mode. Worker will terminate after one job.");
    }
    console.log(`[RATE_LIMIT] Configuration: ${RATE_LIMIT.requestsPerMinute} requests/minute, ${RATE_LIMIT.minTimeBetweenJobs}ms between jobs`);

    // In single-job mode, just run once. Otherwise, loop forever.
    if (singleJobMode) {
        await processPendingJobs();
        console.log("[LIFECYCLE] Single job processed. Exiting.");
        process.exit(0);
    } else {
        // Continuous processing loop
        while (true) {
            try {
                const jobProcessed = await processPendingJobs();

                // If no job was found, wait before checking again.
                if (!jobProcessed) {
                    const nextCheckDelay = 5000; // 5 seconds
                    console.log(`No jobs found, waiting ${nextCheckDelay}ms before next check...`);
                    await new Promise(resolve => setTimeout(resolve, nextCheckDelay));
                }
                // If a job was processed, the loop will continue immediately to check for the next one.

            } catch (error) {
                console.error("Worker encountered a critical error in the main loop:", error);
                // Don't exit on errors, just wait and try again
                console.log("Waiting 30 seconds before retrying...");
                await new Promise(resolve => setTimeout(resolve, 30000));
            }
        }
    }
}

main();
