import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
export { getCurrentJobContext, setJobContext, clearJobContext, type JobContext } from './context.js';

// Robust .env discovery: try process.cwd() and ascend from this file's dir to repo root
function loadEnvOnce() {
  if (process.env.__ENV_LOADED === '1') return;
  const candidates: string[] = [];
  const cwdEnv = path.resolve(process.cwd(), '.env');
  candidates.push(cwdEnv);

  // Keep it simple and robust across module systems: rely on CWD only

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
