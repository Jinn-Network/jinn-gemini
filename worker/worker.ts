import { Agent } from '../gemini-agent/agent.js';
import { readRecords } from '../packages/metacog-mcp/src/tools/read-records.js';
import { updateRecords } from '../packages/metacog-mcp/src/tools/update-records.js';
import { createRecord } from '../packages/metacog-mcp/src/tools/create-record.js';

// Check for debug flag from command line
const debugMode = process.argv.includes('--debug') || process.argv.includes('-d');

// Simple unique ID generator for the worker
const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

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

async function processPendingJobs() {
    console.log(`Worker ${workerId} starting up, checking for pending jobs...`);
    if (debugMode) {
        console.log(`[DEBUG] Worker running in debug mode - Gemini CLI will use --debug flag`);
    }
    
    const readResult = await readRecords({ table_name: 'job_board', filter: { status: 'PENDING' } });
    
    if (!readResult.content || !readResult.content[0] || readResult.content[0].type !== 'text') {
        console.error('Failed to read jobs from database or unexpected format.', readResult);
        return;
    }

    console.log('Raw read result:', readResult.content[0].text);
    
    // Check if the result is an error message
    if (readResult.content[0].text.startsWith('Error')) {
        console.error('Database read error:', readResult.content[0].text);
        return;
    }

    const jobs: JobBoard[] = JSON.parse(readResult.content[0].text);

    if (!jobs || jobs.length === 0) {
        console.log("No pending jobs found.");
        return;
    }

    console.log(`Found ${jobs.length} pending jobs.`);

    // Process one job at a time for now
    const job = jobs[0];
    
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
        
        const agent = new Agent(model, enabledTools);
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
    }
}

async function main() {
    console.log("Starting worker...");
    try {
        // Run once, but this could be set to run on an interval
        await processPendingJobs();
        console.log("Worker finished processing jobs.");
    } catch (error) {
        console.error("Worker encountered an error:", error);
        process.exit(1);
    }
}

main();