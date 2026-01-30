#!/usr/bin/env tsx
/**
 * Update an existing venture
 * Usage: yarn tsx scripts/ventures/update.ts --id <uuid> [--name "New Name"] [--status "paused"]
 */

import { supabase } from '../../gemini-agent/mcp/tools/shared/supabase.js';
import type { Venture } from './mint.js';

// ============================================================================
// Types
// ============================================================================

export interface UpdateVentureArgs {
  id: string;
  name?: string;
  slug?: string;
  description?: string;
  ownerAddress?: string;
  blueprint?: string | object;
  rootWorkstreamId?: string | null;
  rootJobInstanceId?: string | null;
  status?: 'active' | 'paused' | 'archived';
}

// ============================================================================
// Exported Functions (for MCP tool usage)
// ============================================================================

/**
 * Update an existing venture
 */
export async function updateVenture(args: UpdateVentureArgs): Promise<Venture> {
  const { id, ...updates } = args;

  // Build the update object, only including provided fields
  const record: Record<string, any> = {};

  if (updates.name !== undefined) record.name = updates.name;
  if (updates.slug !== undefined) record.slug = updates.slug;
  if (updates.description !== undefined) record.description = updates.description;
  if (updates.ownerAddress !== undefined) record.owner_address = updates.ownerAddress;
  if (updates.rootWorkstreamId !== undefined) record.root_workstream_id = updates.rootWorkstreamId;
  if (updates.rootJobInstanceId !== undefined) record.root_job_instance_id = updates.rootJobInstanceId;
  if (updates.status !== undefined) record.status = updates.status;

  if (updates.blueprint !== undefined) {
    const blueprint = typeof updates.blueprint === 'string'
      ? JSON.parse(updates.blueprint)
      : updates.blueprint;

    // Validate blueprint has invariants array
    if (!blueprint.invariants || !Array.isArray(blueprint.invariants)) {
      throw new Error('Blueprint must contain an "invariants" array');
    }
    record.blueprint = blueprint;
  }

  if (Object.keys(record).length === 0) {
    throw new Error('No fields to update');
  }

  const { data, error } = await supabase
    .from('ventures')
    .update(record)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update venture: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Venture not found: ${id}`);
  }

  return data as Venture;
}

/**
 * Delete a venture (sets status to archived)
 */
export async function archiveVenture(id: string): Promise<Venture> {
  return updateVenture({ id, status: 'archived' });
}

/**
 * Permanently delete a venture
 */
export async function deleteVenture(id: string): Promise<void> {
  const { error } = await supabase
    .from('ventures')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete venture: ${error.message}`);
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseArgs(): UpdateVentureArgs {
  const args = process.argv.slice(2);
  const result: Partial<UpdateVentureArgs> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--id':
        result.id = next;
        i++;
        break;
      case '--name':
        result.name = next;
        i++;
        break;
      case '--slug':
        result.slug = next;
        i++;
        break;
      case '--description':
        result.description = next;
        i++;
        break;
      case '--ownerAddress':
      case '--owner':
        result.ownerAddress = next;
        i++;
        break;
      case '--blueprint':
        result.blueprint = next;
        i++;
        break;
      case '--rootWorkstreamId':
      case '--workstream':
        result.rootWorkstreamId = next === 'null' ? null : next;
        i++;
        break;
      case '--rootJobInstanceId':
      case '--jobInstance':
        result.rootJobInstanceId = next === 'null' ? null : next;
        i++;
        break;
      case '--status':
        result.status = next as 'active' | 'paused' | 'archived';
        i++;
        break;
    }
  }

  if (!result.id) {
    console.error('Error: --id is required');
    printUsage();
    process.exit(1);
  }

  return result as UpdateVentureArgs;
}

function printUsage() {
  console.log(`
Usage: yarn tsx scripts/ventures/update.ts --id <uuid> [options]

Required:
  --id <uuid>                Venture ID to update

Optional (at least one required):
  --name <name>              New venture name
  --slug <slug>              New URL-friendly slug
  --description <text>       New description
  --ownerAddress <address>   New owner address
  --blueprint <json>         New blueprint JSON
  --rootWorkstreamId <id>    New workstream ID (or "null" to clear)
  --rootJobInstanceId <id>   New root job instance ID (or "null" to clear)
  --status <status>          New status: active, paused, archived

Example:
  yarn tsx scripts/ventures/update.ts \\
    --id "123e4567-e89b-12d3-a456-426614174000" \\
    --status "paused" \\
    --description "Updated description"
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  try {
    const args = parseArgs();
    const venture = await updateVenture(args);
    console.log(JSON.stringify({ ok: true, data: venture }, null, 2));
  } catch (err: any) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

// Only run CLI when executed directly (not when imported as module)
const isDirectRun = process.argv[1]?.endsWith('update.ts') || process.argv[1]?.endsWith('update.js');
if (isDirectRun) {
  main();
}
