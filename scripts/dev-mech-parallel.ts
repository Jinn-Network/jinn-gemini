#!/usr/bin/env tsx
/**
 * Parallel Worker Launcher
 *
 * Spawns multiple worker processes with isolated WORKER_IDs for parallel
 * processing of jobs in a workstream.
 *
 * Usage:
 *   yarn dev:mech:parallel --workers=3 --workstream=0x...
 *   yarn dev:mech:parallel -w 3 -s 0x... --runs=10
 *   yarn dev:mech:parallel -w 2 -s 0x... --no-fresh  # Keep existing clones
 */

import { spawn, ChildProcess } from 'child_process';
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

/**
 * Get the base directory for worker clones
 * Matches the logic in shared/repo_utils.ts
 */
function getWorkerClonesBaseDir(): string {
  const baseDir = process.env.JINN_WORKSPACE_DIR || '~/jinn-repos';
  const expandedBase = baseDir.startsWith('~')
    ? join(homedir(), baseDir.slice(1))
    : baseDir;
  return join(expandedBase, 'workers');
}

/**
 * Delete all worker clone directories to ensure fresh state
 */
function cleanWorkerClones(workerCount: number): void {
  const baseDir = getWorkerClonesBaseDir();
  
  for (let i = 1; i <= workerCount; i++) {
    const workerDir = join(baseDir, `worker-${i}`);
    if (existsSync(workerDir)) {
      console.log(`[cleanup] Removing ${workerDir}`);
      rmSync(workerDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('workers', {
      alias: 'w',
      type: 'number',
      default: 2,
      description: 'Number of parallel workers to spawn',
    })
    .option('workstream', {
      alias: 's',
      type: 'string',
      demandOption: true,
      description: 'Workstream ID to filter jobs (required)',
    })
    .option('runs', {
      type: 'number',
      description: 'Maximum number of jobs per worker',
    })
    .option('single', {
      type: 'boolean',
      description: 'Exit after processing one job per worker',
    })
    .option('fresh', {
      type: 'boolean',
      default: true,
      description: 'Delete worker clones before starting (default: true)',
    })
    .example('$0 -w 3 -s 0x123...', 'Run 3 workers on workstream 0x123...')
    .example('$0 -w 2 -s 0x123... --runs=5', 'Run 2 workers, 5 jobs each')
    .example('$0 -w 2 -s 0x123... --no-fresh', 'Keep existing clones')
    .help()
    .parse();

  const children: ChildProcess[] = [];
  const workerCount = argv.workers;

  // Clean worker clones if --fresh (default)
  if (argv.fresh) {
    console.log('Cleaning worker clone directories for fresh start...');
    cleanWorkerClones(workerCount);
    console.log('');
  }

  console.log(`Starting ${workerCount} parallel workers on workstream ${argv.workstream.slice(0, 10)}...`);
  console.log('Press Ctrl+C to stop all workers\n');

  // Spawn workers
  for (let i = 1; i <= workerCount; i++) {
    const workerId = `worker-${i}`;
    const args = ['dev:mech:raw', `--workstream=${argv.workstream}`];

    if (argv.runs) args.push(`--runs=${argv.runs}`);
    if (argv.single) args.push('--single');

    const child = spawn('yarn', args, {
      env: { ...process.env, WORKER_ID: workerId },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    // Prefix stdout with worker ID
    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`[${workerId}] ${line}`);
        }
      });
    });

    // Prefix stderr with worker ID
    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.error(`[${workerId}] ${line}`);
        }
      });
    });

    child.on('exit', (code) => {
      console.log(`[${workerId}] Exited with code ${code}`);
    });

    children.push(child);
    console.log(`[${workerId}] Started (PID: ${child.pid})`);
  }

  // Handle Ctrl+C - gracefully kill all workers
  const cleanup = () => {
    console.log('\nStopping all workers...');
    children.forEach((child, i) => {
      if (!child.killed) {
        child.kill('SIGTERM');
        console.log(`[worker-${i + 1}] Sent SIGTERM`);
      }
    });

    // Force kill after 5 seconds
    setTimeout(() => {
      children.forEach((child, i) => {
        if (!child.killed) {
          child.kill('SIGKILL');
          console.log(`[worker-${i + 1}] Force killed`);
        }
      });
      process.exit(0);
    }, 5000);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Wait for all children to exit
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          child.on('exit', () => resolve());
        })
    )
  );

  console.log('\nAll workers finished.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
