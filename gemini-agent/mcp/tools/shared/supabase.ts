import { createClient } from '@supabase/supabase-js';
export { getCurrentJobContext, setJobContext, clearJobContext, type JobContext } from './context.js';
import { loadEnvOnce } from './env.js';

// Ensure env is loaded when supabase is referenced (idempotent)
loadEnvOnce();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(`Missing Supabase credentials. Required environment variables:
- SUPABASE_URL (currently: ${supabaseUrl || 'undefined'})
- SUPABASE_SERVICE_ANON_KEY (currently: ${supabaseKey ? '[SET]' : 'undefined'})

Create a .env file in the project root with:
SUPABASE_URL=https://clnwgxgvmnrkwqdblqgf.supabase.co
SUPABASE_SERVICE_ANON_KEY=your_service_anon_key_here`);
}

export const supabase = createClient(supabaseUrl, supabaseKey);
