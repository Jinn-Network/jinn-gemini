import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Centralized, idempotent .env loader for the MCP server and all tools.
 *
 * Load order (first found wins):
 * 1) Explicit file via JINN_ENV_PATH
 * 2) process.cwd()/.env and up to 3 parent dirs
 * 3) __dirname/.env and up to 6 parent dirs (covers repo root when bundled)
 */
export function loadEnvOnce(): void {
  if (process.env.__ENV_LOADED === '1') return;

  const candidates: string[] = [];

  // 1) Explicit path override
  const explicit = process.env.JINN_ENV_PATH;
  if (explicit) {
    candidates.push(path.resolve(explicit));
  }

  // 2) From current working directory, walk up to 3 levels
  const cwd = process.cwd();
  let cur = cwd;
  for (let i = 0; i < 4; i++) {
    candidates.push(path.join(cur, '.env'));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // 3) From this file's directory, walk up to 6 levels
  // In ESM, derive __dirname from import.meta.url
  const here = path.dirname(fileURLToPath(import.meta.url));
  cur = here;
  for (let i = 0; i < 7; i++) {
    candidates.push(path.join(cur, '.env'));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  const tried: string[] = [];
  for (const p of candidates) {
    const abs = path.resolve(p);
    if (tried.includes(abs)) continue;
    tried.push(abs);
    if (!fs.existsSync(abs)) continue;
    // Silence dotenv stdout to protect MCP stdio JSON
    const origWrite = process.stdout.write as any;
    try {
      (process.stdout as any).write = () => true;
      const res = dotenv.config({ path: abs });
      if (!res.error) {
        process.env.__ENV_LOADED = '1';
        return;
      }
    } finally {
      (process.stdout as any).write = origWrite;
    }
  }
}

export function envString(name: string, defaultValue?: string): string | undefined {
  const v = process.env[name];
  return v !== undefined ? v : defaultValue;
}

export function envBool(name: string, defaultValue = false): boolean {
  const v = process.env[name];
  if (v === undefined) return defaultValue;
  const val = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(val)) return true;
  if (['0', 'false', 'no', 'off'].includes(val)) return false;
  return defaultValue;
}

