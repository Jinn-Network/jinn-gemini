import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// Idempotent load guard
if (process.env.__ENV_LOADED !== '1') {
  try {
    // Resolve repo root based on this file's location
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '..');
    const rootEnvPath = path.join(repoRoot, '.env');

    // Parse .env explicitly and enforce values strictly from this file
    let parsed: Record<string, string> = {};
    try {
      const raw = readFileSync(rootEnvPath, 'utf8');
      parsed = dotenv.parse(raw);
    } catch {
      // If .env missing, keep parsed empty
      parsed = {};
    }

    // Load .env into process.env, overriding any existing values
    dotenv.config({ path: rootEnvPath, override: true });

    // Enforce that only variables defined in project's .env are honored for our namespaces
    const enforcedPrefixes = [
      'PONDER_',
      'MECH_',
      'MECHX_',
      'SUPABASE_',
      'OPENAI_',
      'GEMINI_',
      'CIVITAI_',
      'TENDERLY_',
      'PLAYWRIGHT_',
      'ZORA_',
    ];
    const enforcedSingles = new Set<string>([
      'RPC_URL',
      'CHAIN_ID',
      'ENABLE_TRANSACTION_EXECUTOR',
      'WORKER_PRIVATE_KEY',
    ]);

    for (const key of Object.keys(process.env)) {
      const isEnforced = enforcedPrefixes.some((p) => key.startsWith(p)) || enforcedSingles.has(key);
      if (!isEnforced) continue;
      // If the key is not present in .env, remove it to avoid inheriting from the host environment
      if (!(key in parsed)) {
        delete process.env[key];
      } else {
        // Ensure value matches the .env file exactly
        process.env[key] = parsed[key];
      }
    }
    
    // RPC Consolidation: Map all RPC variables to use the single RPC_URL
    if (parsed.RPC_URL) {
      // Set fallback RPC variables to use the main RPC_URL if they're not explicitly set
      if (!parsed.MECH_RPC_HTTP_URL) {
        process.env.MECH_RPC_HTTP_URL = parsed.RPC_URL;
      }
      if (!parsed.MECHX_CHAIN_RPC) {
        process.env.MECHX_CHAIN_RPC = parsed.RPC_URL;
      }
      if (!parsed.PONDER_RPC_URL) {
        process.env.PONDER_RPC_URL = parsed.RPC_URL;
      }
      if (!parsed.BASE_RPC_URL) {
        process.env.BASE_RPC_URL = parsed.RPC_URL;
      }
    }

    process.env.__ENV_LOADED = '1';
  } catch {
    // Best-effort; do not throw in bootstrap
  }
}

export {};


