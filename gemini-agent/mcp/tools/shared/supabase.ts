import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Robust .env discovery: try process.cwd() and ascend from this file's dir to repo root
function loadEnvOnce() {
  if (process.env.__ENV_LOADED === '1') return;
  const candidates: string[] = [];
  const cwdEnv = path.resolve(process.cwd(), '.env');
  candidates.push(cwdEnv);

  try {
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = path.dirname(thisFile);
    // ascend up to 6 levels looking for .env (covers repo root regardless of launch dir)
    let dir = thisDir;
    for (let i = 0; i < 6; i++) {
      candidates.push(path.resolve(dir, '.env'));
      dir = path.resolve(dir, '..');
    }
  } catch (_) {
    // ignore
  }

  const tried: string[] = [];
  for (const p of candidates) {
    if (!tried.includes(p) && fs.existsSync(p)) {
      const res = dotenv.config({ path: p });
      tried.push(p);
      if (!res.error) {
        process.env.__ENV_LOADED = '1';
        break;
      }
    }
  }
}

loadEnvOnce();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(`Supabase URL and key must be provided in environment or .env file.`);
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
