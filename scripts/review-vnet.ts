#!/usr/bin/env tsx
/**
 * Review archived dev-vnet run
 *
 * Restores Ponder database from an archived run and starts services
 * to review jobs, deliveries, and artifacts without needing RPC access.
 *
 * Usage:
 *   yarn review:vnet <run-id>
 *   yarn review:vnet 1759760939
 */

import { join } from 'path';
import { readdir, readFile, access, rm, mkdir } from 'fs/promises';
import { execa } from 'execa';
import { existsSync } from 'fs';

const ARCHIVES_DIR = join(process.cwd(), 'ponder/.ponder/archives');
const PONDER_DB_ACTIVE = join(process.cwd(), 'ponder/.ponder/sqlite');
const PONDER_DB_BACKUP = join(process.cwd(), 'ponder/.ponder/sqlite.backup');

interface ArchiveMetadata {
  runId: string;
  timestamp: string;
  vnetId: string;
  vnetRpc: string;
  vnetDashboard: string;
  quotaExhausted: boolean;
  startBlock: number;
  endBlock?: number | null;
  stats: {
    marketplaceRequests: number;
    deliveries: number;
    artifacts: number;
  };
  reason?: string;
  notes?: string;
}

async function listArchives(): Promise<void> {
  console.log('');
  console.log('Available dev-vnet run archives:');
  console.log('');

  try {
    const entries = await readdir(ARCHIVES_DIR, { withFileTypes: true });
    const archives = entries.filter(e => e.isDirectory() && e.name.startsWith('run-'));

    if (archives.length === 0) {
      console.log('  No archives found.');
      console.log('  Run `yarn dev:vnet` to create your first archived run.');
      console.log('');
      return;
    }

    for (const archive of archives.sort((a, b) => b.name.localeCompare(a.name))) {
      const runId = archive.name.replace('run-', '');
      const metadataPath = join(ARCHIVES_DIR, archive.name, 'metadata.json');

      try {
        const metadata: ArchiveMetadata = JSON.parse(await readFile(metadataPath, 'utf-8'));
        const date = new Date(metadata.timestamp).toLocaleString();

        console.log(`  ${archive.name.replace('run-', '')} (${date})`);
        console.log(`    VNet: ${metadata.vnetId}`);
        console.log(`    Requests: ${metadata.stats.marketplaceRequests}, Deliveries: ${metadata.stats.deliveries}, Artifacts: ${metadata.stats.artifacts}`);
        if (metadata.quotaExhausted) {
          console.log(`    Status: Quota exhausted`);
        }
        console.log('');
      } catch (error) {
        console.log(`  ${archive.name} (metadata unavailable)`);
        console.log('');
      }
    }

    console.log('To review: yarn review:vnet <run-id>');
    console.log('');
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('  No archives directory found.');
      console.log('  Run `yarn dev:vnet` to create your first archived run.');
    } else {
      console.error('  Error listing archives:', error.message);
    }
    console.log('');
  }
}

async function killServices(): Promise<void> {
  console.log('[cleanup] Stopping any running services...');
  await execa('pkill', ['-f', 'ponder.*dev'], { reject: false });
  await execa('pkill', ['-f', 'next dev.*3020'], { reject: false });

  // Kill by port
  try {
    const { stdout } = await execa('lsof', ['-ti:42069,3020'], { reject: false });
    if (stdout.trim()) {
      const pids = stdout.trim().split('\n');
      for (const pid of pids) {
        await execa('kill', ['-9', pid], { reject: false });
      }
    }
  } catch {}

  await new Promise(r => setTimeout(r, 2000));
  console.log('[cleanup] ✓ Services stopped');
}

async function restoreArchive(runId: string): Promise<ArchiveMetadata> {
  const archiveDir = join(ARCHIVES_DIR, `run-${runId}`);
  const metadataPath = join(archiveDir, 'metadata.json');
  const archivedDb = join(archiveDir, 'sqlite');

  // Check archive exists
  try {
    await access(archiveDir);
  } catch {
    throw new Error(`Archive not found: run-${runId}`);
  }

  // Load metadata
  const metadata: ArchiveMetadata = JSON.parse(await readFile(metadataPath, 'utf-8'));

  // Check if active DB exists and back it up
  if (existsSync(PONDER_DB_ACTIVE)) {
    console.log('[restore] Backing up current Ponder database...');
    await rm(PONDER_DB_BACKUP, { recursive: true, force: true });
    await execa('cp', ['-r', PONDER_DB_ACTIVE, PONDER_DB_BACKUP]);
  }

  // Restore archived DB to active location
  console.log('[restore] Restoring archived database...');
  await rm(PONDER_DB_ACTIVE, { recursive: true, force: true });
  await mkdir(PONDER_DB_ACTIVE, { recursive: true });
  await execa('cp', ['-r', archivedDb, PONDER_DB_ACTIVE]);
  // Fix nested sqlite directory (cp -r creates sqlite/sqlite)
  const nestedSqlite = join(PONDER_DB_ACTIVE, 'sqlite');
  if (existsSync(nestedSqlite)) {
    await execa('bash', ['-c', `mv ${nestedSqlite}/* ${PONDER_DB_ACTIVE}/ && rmdir ${nestedSqlite}`]);
  }

  console.log('[restore] ✓ Database restored');
  return metadata;
}

async function startServices(metadata: ArchiveMetadata): Promise<void> {
  console.log('[services] Starting Ponder...');

  // Start Ponder with archived VNet RPC and endBlock to prevent syncing beyond archived run
  const env: Record<string, string> = {
    ...process.env,
    PONDER_RPC_URL: metadata.vnetRpc,
    RPC_URL: metadata.vnetRpc,  // Override RPC_URL to prevent fallback to .env VNet
    PONDER_START_BLOCK: metadata.startBlock.toString(),  // Use archived start block
  };

  // Set endBlock if available to prevent syncing beyond archived run
  if (metadata.endBlock) {
    env.PONDER_END_BLOCK = metadata.endBlock.toString();
    console.log(`[services] Setting endBlock to ${metadata.endBlock} (prevents syncing beyond archived run)`);
  }

  const ponderProc = execa('yarn', ['dev'], {
    cwd: join(process.cwd(), 'ponder'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for Ponder to be ready
  let ponderReady = false;
  const ponderTimeout = setTimeout(() => {
    if (!ponderReady) {
      console.warn('[services] ⚠️  Ponder taking longer than expected...');
    }
  }, 30000);

  ponderProc.stdout?.on('data', (data: Buffer) => {
    const line = data.toString();
    if (line.includes('Server live at')) {
      ponderReady = true;
      clearTimeout(ponderTimeout);
    }
  });

  await new Promise(r => setTimeout(r, 10000)); // Give Ponder time to start
  console.log('[services] ✓ Ponder started at http://localhost:42069/graphql');

  // Start Frontend
  console.log('[services] Starting Frontend...');
  const frontendProc = execa('yarn', ['next', 'dev', '--turbopack', '--port', '3020'], {
    cwd: join(process.cwd(), 'frontend/explorer'),
    env: {
      ...process.env,
      NEXT_PUBLIC_SUBGRAPH_URL: 'http://localhost:42069/graphql',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise(r => setTimeout(r, 5000)); // Give Frontend time to start
  console.log('[services] ✓ Frontend started at http://localhost:3020');

  return new Promise(() => {
    // Keep alive until Ctrl+C
    process.on('SIGINT', async () => {
      console.log('');
      console.log('[shutdown] Stopping services...');
      ponderProc.kill();
      frontendProc.kill();

      // Restore backup if it exists
      if (existsSync(PONDER_DB_BACKUP)) {
        console.log('[shutdown] Restoring original database...');
        await rm(PONDER_DB_ACTIVE, { recursive: true, force: true });
        await execa('mv', [PONDER_DB_BACKUP, PONDER_DB_ACTIVE]);
        console.log('[shutdown] ✓ Original database restored');
      }

      console.log('[shutdown] ✓ Cleanup complete');
      process.exit(0);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('');
    console.log('Usage: yarn review:vnet <run-id>');
    console.log('');
    console.log('Review an archived dev-vnet run with Ponder and Frontend.');
    console.log('');
    await listArchives();
    process.exit(0);
  }

  const runId = args[0];

  console.log('');
  console.log('='.repeat(60));
  console.log(`Reviewing dev-vnet run: ${runId}`);
  console.log('='.repeat(60));
  console.log('');

  try {
    // Kill any running services
    await killServices();
    console.log('');

    // Restore archive
    const metadata = await restoreArchive(runId);
    console.log('');

    // Display run info
    console.log('='.repeat(60));
    console.log('Run Information:');
    console.log('='.repeat(60));
    console.log(`  Date: ${new Date(metadata.timestamp).toLocaleString()}`);
    console.log(`  VNet: ${metadata.vnetId}`);
    console.log(`  Start Block: ${metadata.startBlock}`);
    console.log(`  Marketplace Requests: ${metadata.stats.marketplaceRequests}`);
    console.log(`  Deliveries: ${metadata.stats.deliveries}`);
    console.log(`  Artifacts: ${metadata.stats.artifacts}`);
    if (metadata.quotaExhausted) {
      console.log(`  Status: Quota exhausted`);
    }
    console.log('');
    console.log(`  VNet Dashboard: ${metadata.vnetDashboard}`);
    console.log('='.repeat(60));
    console.log('');

    // Start services
    await startServices(metadata);

  } catch (error: any) {
    console.error('');
    console.error('Error:', error.message);
    console.log('');
    await listArchives();
    process.exit(1);
  }
}

main().catch(console.error);
