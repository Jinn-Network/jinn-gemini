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

    process.env.__ENV_LOADED = '1';
  } catch {
    // Best-effort; do not throw in bootstrap
  }
}

export {};


