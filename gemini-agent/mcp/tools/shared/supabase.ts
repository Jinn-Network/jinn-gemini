import { createClient } from '@supabase/supabase-js';
export { getCurrentJobContext, setJobContext, clearJobContext, type JobContext } from './context.js';
import { loadEnvOnce } from './env.js';

// Ensure env is loaded when supabase is referenced (idempotent)
loadEnvOnce();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(`Supabase URL and key must be provided in environment or .env file.`);
}

export const supabase = createClient(supabaseUrl, supabaseKey);
