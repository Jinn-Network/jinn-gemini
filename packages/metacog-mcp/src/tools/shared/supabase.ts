import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
// Try both relative and absolute paths to handle different execution contexts
const envPaths = [
  path.resolve(process.cwd(), 'packages/metacog-mcp/.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env')
];

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    break;
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL and key must be provided in .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Job context management for tracking which job is currently executing
interface JobContext {
  jobId: string | null;
  jobName: string | null;
  threadId: string | null;
}

let currentJobContext: JobContext = {
  jobId: null,
  jobName: null,
  threadId: null,
};

export function setJobContext(jobId: string | null, jobName: string | null, threadId: string | null) {
  currentJobContext = { jobId, jobName, threadId };
}

export function clearJobContext() {
  currentJobContext = { jobId: null, jobName: null, threadId: null };
}

export function getCurrentJobContext(): JobContext {
  return { ...currentJobContext };
} 