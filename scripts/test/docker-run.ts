#!/usr/bin/env npx tsx
/**
 * Docker Run Wrapper — runs jinn-node worker in Docker with correct mounts.
 *
 * Handles:
 *   - Individual auth file mounts (avoids host extension symlinks)
 *   - macOS host.docker.internal detection
 *   - All fixed env vars and flags
 *   - Cross-mech job pickup (WORKER_MECH_FILTER_MODE=any)
 *   - Additional env var passthrough (--env KEY=VALUE)
 *
 * Usage:
 *   yarn test:e2e:docker-run --cwd /path/to/clone
 *   yarn test:e2e:docker-run --cwd /path/to/clone --single
 *   yarn test:e2e:docker-run --cwd /path/to/clone --healthcheck
 *   yarn test:e2e:docker-run --cwd /path/to/clone --workstream 0x1234...
 *   yarn test:e2e:docker-run --cwd /path/to/clone --env SUPABASE_URL=... --env SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Telemetry files are always mounted at /tmp/jinn-telemetry/ on the host.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

function parseArgs(args: string[]): { flags: Record<string, string>; envPairs: string[] } {
  const flags: Record<string, string> = {};
  const envPairs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && i + 1 < args.length) {
      envPairs.push(args[++i]);
    } else if (args[i].startsWith('--env=')) {
      envPairs.push(args[i].slice(6));
    } else if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = 'true';
      }
    }
  }
  return { flags, envPairs };
}

const { flags, envPairs } = parseArgs(process.argv.slice(2));

const cloneDir = flags['cwd'];
if (!cloneDir) {
  console.error('Usage: yarn test:e2e:docker-run --cwd <clone-dir> [--single] [--healthcheck] [--workstream <id>] [--env KEY=VALUE ...]');
  process.exit(1);
}

const resolvedCloneDir = resolve(cloneDir);
const envFile = join(resolvedCloneDir, '.env');
if (!existsSync(envFile)) {
  console.error(`No .env file found at ${envFile}`);
  process.exit(1);
}

const home = homedir();
const isMac = process.platform === 'darwin';
const single = flags['single'] === 'true';
const healthcheck = flags['healthcheck'] === 'true';
const image = flags['image'] || 'jinn-node:e2e';
const workstream = flags['workstream'];

// Detect macOS — use host.docker.internal instead of localhost
const ponderUrl = isMac
  ? 'http://host.docker.internal:42069/graphql'
  : 'http://localhost:42069/graphql';
const controlUrl = isMac
  ? 'http://host.docker.internal:4001/graphql'
  : 'http://localhost:4001/graphql';

const containerName = healthcheck ? 'jinn-e2e-healthcheck' : 'jinn-e2e-worker';

// Build docker run args
const dockerArgs: string[] = ['docker', 'run'];

if (healthcheck) {
  dockerArgs.push('-d');
} else {
  dockerArgs.push('--rm');
}

dockerArgs.push('--name', containerName);

if (!isMac) {
  dockerArgs.push('--network', 'host');
}

dockerArgs.push('--env-file', envFile);
dockerArgs.push('-e', 'GEMINI_SANDBOX=false');
dockerArgs.push('-e', 'OPERATE_PROFILE_DIR=/home/jinn/.operate');
dockerArgs.push('-e', 'JINN_WORKSPACE_DIR=/app/jinn-repos');
dockerArgs.push('-e', `PONDER_GRAPHQL_URL=${ponderUrl}`);
dockerArgs.push('-e', `CONTROL_API_URL=${controlUrl}`);

// Enable cross-mech job pickup — any mech can claim any unclaimed request.
// The OLAS marketplace contract does not enforce priorityMech; this relaxes
// the worker's Ponder query filter to match.
dockerArgs.push('-e', 'WORKER_MECH_FILTER_MODE=any');

// Enable multi-service rotation — required when 2+ services are provisioned.
// Without this, the worker runs in single-service mode and skips rotation.
dockerArgs.push('-e', 'WORKER_MULTI_SERVICE=true');

// Forward GITHUB_TOKEN from host env (operator-level credential, not bridge).
// The clone .env may have a placeholder; -e flag takes precedence over --env-file.
if (process.env.GITHUB_TOKEN) {
  dockerArgs.push('-e', `GITHUB_TOKEN=${process.env.GITHUB_TOKEN}`);
}

// Workstream filter — restrict worker to requests in a specific workstream
if (workstream) {
  dockerArgs.push('-e', `WORKSTREAM_FILTER=${workstream}`);
}

// Additional env vars from --env flags (e.g., Supabase credentials)
for (const pair of envPairs) {
  dockerArgs.push('-e', pair);
}

// Mounts
dockerArgs.push('-v', `${resolvedCloneDir}/.operate:/home/jinn/.operate`);

// Individual auth file mounts — avoids host extension symlinks crashing the CLI.
// agent.ts copies these from ~/.gemini/ to GEMINI_CLI_HOME/.gemini/ before spawning CLI.
const oauthCreds = join(home, '.gemini', 'oauth_creds.json');
const googleAccounts = join(home, '.gemini', 'google_accounts.json');
const settingsJson = join(home, '.gemini', 'settings.json');

if (existsSync(oauthCreds)) {
  dockerArgs.push('-v', `${oauthCreds}:/home/jinn/.gemini/oauth_creds.json`);
}
if (existsSync(googleAccounts)) {
  dockerArgs.push('-v', `${googleAccounts}:/home/jinn/.gemini/google_accounts.json`);
}
if (existsSync(settingsJson)) {
  dockerArgs.push('-v', `${settingsJson}:/home/jinn/.gemini/settings.json`);
}

// Mount telemetry subdirectory so files survive container exit (--rm).
// JINN_TELEMETRY_DIR tells agent.ts where to write telemetry files.
// Do NOT set TMPDIR — that pollutes the temp directory with non-telemetry files
// (Gemini CLI extensions, symlinks) which break cp -r on the host.
try {
  execSync('rm -f /tmp/jinn-telemetry/telemetry-*.json', { stdio: 'pipe' });
} catch { /* directory may not exist yet */ }
execSync('mkdir -p /tmp/jinn-telemetry');
dockerArgs.push('-v', '/tmp/jinn-telemetry:/tmp/jinn-telemetry');
dockerArgs.push('-e', 'JINN_TELEMETRY_DIR=/tmp/jinn-telemetry');

dockerArgs.push('--shm-size=2g');

if (healthcheck) {
  dockerArgs.push('-p', '8080:8080');
}

dockerArgs.push(image);

// CMD override
if (single) {
  dockerArgs.push('node', 'dist/worker/mech_worker.js', '--single');
}
// healthcheck and default: use image's CMD (worker_launcher.js)

console.log(`Running: ${dockerArgs.join(' ')}`);
execSync(dockerArgs.join(' '), { stdio: 'inherit', timeout: 10 * 60 * 1000 });
