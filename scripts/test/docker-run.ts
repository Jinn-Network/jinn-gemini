#!/usr/bin/env npx tsx
/**
 * Docker Run Wrapper — runs jinn-node worker in Docker with correct mounts.
 *
 * Handles:
 *   - Individual auth file mounts (avoids host extension symlinks)
 *   - macOS host.docker.internal detection
 *   - All fixed env vars and flags
 *
 * Usage:
 *   yarn test:e2e:docker-run --cwd /path/to/clone
 *   yarn test:e2e:docker-run --cwd /path/to/clone --single
 *   yarn test:e2e:docker-run --cwd /path/to/clone --telemetry
 *   yarn test:e2e:docker-run --cwd /path/to/clone --healthcheck
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

function parseArgs(args: string[]): { flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = 'true';
      }
    }
  }
  return { flags };
}

const { flags } = parseArgs(process.argv.slice(2));

const cloneDir = flags['cwd'];
if (!cloneDir) {
  console.error('Usage: yarn test:e2e:docker-run --cwd <clone-dir> [--single] [--telemetry] [--healthcheck]');
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
const telemetry = flags['telemetry'] === 'true';
const healthcheck = flags['healthcheck'] === 'true';
const image = flags['image'] || 'jinn-node:e2e';

// Detect macOS — use host.docker.internal instead of localhost
const ponderUrl = isMac
  ? 'http://host.docker.internal:42069/graphql'
  : 'http://localhost:42069/graphql';
const controlUrl = isMac
  ? 'http://host.docker.internal:4001/graphql'
  : 'http://localhost:4001/graphql';

const containerName = healthcheck ? 'jinn-e2e-healthcheck' : 'jinn-e2e-worker';

// Build docker run args
const args: string[] = ['docker', 'run'];

if (healthcheck) {
  args.push('-d');
} else {
  args.push('--rm');
}

args.push('--name', containerName);

if (!isMac) {
  args.push('--network', 'host');
}

args.push('--env-file', envFile);
args.push('-e', 'GEMINI_SANDBOX=false');
args.push('-e', 'OPERATE_PROFILE_DIR=/home/jinn/.operate');
args.push('-e', 'JINN_WORKSPACE_DIR=/app/jinn-repos');
args.push('-e', `PONDER_GRAPHQL_URL=${ponderUrl}`);
args.push('-e', `CONTROL_API_URL=${controlUrl}`);

// Mounts
args.push('-v', `${resolvedCloneDir}/.operate:/home/jinn/.operate`);

// Individual auth file mounts — avoids host extension symlinks crashing the CLI
const oauthCreds = join(home, '.gemini', 'oauth_creds.json');
const googleAccounts = join(home, '.gemini', 'google_accounts.json');

if (existsSync(oauthCreds)) {
  args.push('-v', `${oauthCreds}:/home/jinn/.gemini/oauth_creds.json`);
}
if (existsSync(googleAccounts)) {
  args.push('-v', `${googleAccounts}:/home/jinn/.gemini/google_accounts.json`);
}

if (telemetry) {
  execSync('mkdir -p /tmp/jinn-telemetry');
  args.push('-v', '/tmp/jinn-telemetry:/tmp');
}

args.push('--shm-size=2g');

if (healthcheck) {
  args.push('-p', '8080:8080');
}

args.push(image);

// CMD override
if (single || telemetry) {
  args.push('node', 'dist/worker/mech_worker.js', '--single');
}
// healthcheck and default: use image's CMD (worker_launcher.js)

console.log(`Running: ${args.join(' ')}`);
execSync(args.join(' '), { stdio: 'inherit', timeout: 10 * 60 * 1000 });
