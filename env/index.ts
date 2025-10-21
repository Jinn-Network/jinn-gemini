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

    // Detect test environment (Vitest sets VITEST='true')
    const isTestEnv = process.env.VITEST === 'true';

    // Load base .env first
    const rootEnvPath = path.join(repoRoot, '.env');
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

    // In test mode, load .env.test after .env (test values override production values)
    if (isTestEnv) {
      const testEnvPath = path.join(repoRoot, '.env.test');
      try {
        const testRaw = readFileSync(testEnvPath, 'utf8');
        const testParsed = dotenv.parse(testRaw);
        // Merge test config into parsed (for enforcement logic below)
        parsed = { ...parsed, ...testParsed };
        // Load .env.test, overriding .env values
        dotenv.config({ path: testEnvPath, override: true });
      } catch {
        // .env.test missing is OK - just use .env
      }
    }

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
      'OLAS_',
      'BASE_',
      'OPERATE_',
      'STAKING_',
    ];
    const enforcedSingles = new Set<string>([
      'RPC_URL',
      'CHAIN_ID',
      'ENABLE_TRANSACTION_EXECUTOR',
      'WORKER_PRIVATE_KEY',
      'ATTENDED',
    ]);

    // Review mode: preserve runtime-provided values for specific config vars
    // Used in tests and VNet review sessions to prevent .env from overriding runtime values
    const isReviewMode = process.env.PONDER_REVIEW_MODE === '1';
    const reviewModePreservedKeys = new Set<string>([
      'RPC_URL',
      'PONDER_GRAPHQL_URL',
      'PONDER_START_BLOCK',
      'PONDER_END_BLOCK',
    ]);

    for (const key of Object.keys(process.env)) {
      const isEnforced = enforcedPrefixes.some((p) => key.startsWith(p)) || enforcedSingles.has(key);
      if (!isEnforced) continue;

      if (key in parsed) {
        // In review mode, preserve runtime values for specific Ponder config vars
        if (isReviewMode && reviewModePreservedKeys.has(key)) {
          // Keep the runtime value, don't overwrite from .env
          continue;
        }
        // If the key is present in .env, use that value (local development override)
        process.env[key] = parsed[key];
      } else {
        // If the key is NOT in .env but exists in process.env, preserve it
        // This allows production environments to inject secrets without a .env file
        // The existing value in process.env is kept unchanged
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


