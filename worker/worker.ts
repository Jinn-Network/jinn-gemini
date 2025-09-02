import { readRecords } from '../gemini-agent/mcp/tools/read-records.js';
import { TransactionProcessor } from './TransactionProcessor.js';
import { processJob } from './JobProcessor.js';
import { logger } from './logger.js';
import { JobBoard } from './types.js';

const mainLogger = logger.child({ component: 'WorkerMain' });

const debugMode = process.argv.includes('--debug') || process.argv.includes('-d');
const jobIdFlagIndex = process.argv.findIndex(arg => arg === '--job-id' || arg === '-j');
const targetJobId = jobIdFlagIndex !== -1 ? process.argv[jobIdFlagIndex + 1] : null;

if (jobIdFlagIndex !== -1 && (!targetJobId || targetJobId.startsWith('-'))) {
    mainLogger.fatal("Invalid usage: --job-id|-j requires a job ID value.");
    process.exit(1);
}

const singleJobMode = process.argv.includes('--single-job') || Boolean(targetJobId);
const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    mainLogger.fatal("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
    process.exit(1);
}

async function fetchAndProcessJob(): Promise<boolean> {
    const readResult = await readRecords({
        table_name: 'job_board',
        filter: targetJobId ? { id: targetJobId } : { status: 'PENDING' }
    });

    if (!readResult.content?.[0] || readResult.content[0].type !== 'text' || readResult.content[0].text.startsWith('Error')) {
        mainLogger.error({ result: readResult }, "Failed to read jobs from database or unexpected format.");
        return false;
    }

    try {
        const parsed = JSON.parse(readResult.content[0].text);
        const jobs: JobBoard[] = Array.isArray(parsed) ? parsed : (parsed?.data ?? []);

        if (jobs.length === 0) {
            mainLogger.info(targetJobId ? `No job found with id ${targetJobId}.` : "No pending jobs found.");
            return false;
        }

        await processJob(jobs[0], workerId, debugMode, targetJobId);
        return true;

    } catch (parseErr) {
        mainLogger.error({ error: parseErr, data: readResult.content[0].text }, "Failed to parse jobs from database.");
        return false;
    }
}

async function main() {
    mainLogger.info({ workerId, singleJobMode, targetJobId, debugMode }, "Worker starting up");

    const transactionProcessor = new TransactionProcessor(supabaseUrl, supabaseKey, workerId);

    if (singleJobMode) {
        await fetchAndProcessJob();
        await transactionProcessor.processPendingTransaction();
        mainLogger.info("Single job/transaction processed. Exiting.");
        process.exit(0);
    }

    while (true) {
        try {
            const jobProcessed = await fetchAndProcessJob();
            const transactionProcessed = await transactionProcessor.processPendingTransaction();

            if (!jobProcessed && !transactionProcessed) {
                const delay = 5000;
                mainLogger.info(`No jobs or transactions found, waiting ${delay}ms.`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else if (!transactionProcessed) {
                // If no transaction was processed, add a small delay to prevent high CPU usage
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (error) {
            mainLogger.fatal({ error }, "Critical error in main loop. Waiting 30 seconds before retrying.");
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }
}

main();
