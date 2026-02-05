#!/usr/bin/env tsx
/**
 * Mint (create) a new venture
 * Usage: yarn tsx scripts/ventures/mint.ts --name "My Venture" --ownerAddress "0x..." --blueprint '{...}'
 */

import { supabase } from '../../gemini-agent/mcp/tools/shared/supabase.js';

// ============================================================================
// Types
// ============================================================================

export interface CreateVentureArgs {
  name: string;
  slug?: string;
  description?: string;
  ownerAddress: string;
  blueprint: string | object;
  rootWorkstreamId?: string;
  rootJobInstanceId?: string;
  status?: 'active' | 'paused' | 'archived';
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenName?: string;
  stakingContractAddress?: string;
  tokenLaunchPlatform?: string;
  tokenMetadata?: object;
  governanceAddress?: string;
  poolAddress?: string;
}

export interface Venture {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_address: string;
  blueprint: object;
  root_workstream_id: string | null;
  root_job_instance_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  token_address: string | null;
  token_symbol: string | null;
  token_name: string | null;
  staking_contract_address: string | null;
  token_launch_platform: string | null;
  token_metadata: object | null;
  governance_address: string | null;
  pool_address: string | null;
}

// ============================================================================
// Exported Functions (for MCP tool usage)
// ============================================================================

/**
 * Generate a URL-friendly slug from a name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Create a new venture
 */
export async function createVenture(args: CreateVentureArgs): Promise<Venture> {
  // Parse blueprint if it's a string
  const blueprint = typeof args.blueprint === 'string'
    ? JSON.parse(args.blueprint)
    : args.blueprint;

  // Validate blueprint has invariants array
  if (!blueprint.invariants || !Array.isArray(blueprint.invariants)) {
    throw new Error('Blueprint must contain an "invariants" array');
  }

  // Generate slug if not provided
  const slug = args.slug || generateSlug(args.name);

  const record: Record<string, any> = {
    name: args.name,
    slug,
    description: args.description || null,
    owner_address: args.ownerAddress,
    blueprint,
    root_workstream_id: args.rootWorkstreamId || null,
    root_job_instance_id: args.rootJobInstanceId || null,
    status: args.status || 'active',
  };

  // Token fields — only include if provided
  if (args.tokenAddress !== undefined) record.token_address = args.tokenAddress;
  if (args.tokenSymbol !== undefined) record.token_symbol = args.tokenSymbol;
  if (args.tokenName !== undefined) record.token_name = args.tokenName;
  if (args.stakingContractAddress !== undefined) record.staking_contract_address = args.stakingContractAddress;
  if (args.tokenLaunchPlatform !== undefined) record.token_launch_platform = args.tokenLaunchPlatform;
  if (args.tokenMetadata !== undefined) record.token_metadata = args.tokenMetadata;
  if (args.governanceAddress !== undefined) record.governance_address = args.governanceAddress;
  if (args.poolAddress !== undefined) record.pool_address = args.poolAddress;

  const { data, error } = await supabase
    .from('ventures')
    .insert(record)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create venture: ${error.message}`);
  }

  return data as Venture;
}

/**
 * Get a venture by ID
 */
export async function getVenture(id: string): Promise<Venture | null> {
  const { data, error } = await supabase
    .from('ventures')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to get venture: ${error.message}`);
  }

  return data as Venture;
}

/**
 * Get a venture by slug
 */
export async function getVentureBySlug(slug: string): Promise<Venture | null> {
  const { data, error } = await supabase
    .from('ventures')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to get venture by slug: ${error.message}`);
  }

  return data as Venture;
}

/**
 * List ventures with optional filters
 */
export async function listVentures(options: {
  status?: string;
  ownerAddress?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<Venture[]> {
  let query = supabase
    .from('ventures')
    .select('*')
    .order('created_at', { ascending: false });

  if (options.status) {
    query = query.eq('status', options.status);
  }
  if (options.ownerAddress) {
    query = query.eq('owner_address', options.ownerAddress);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list ventures: ${error.message}`);
  }

  return data as Venture[];
}

// ============================================================================
// CLI Interface
// ============================================================================

interface MintCliArgs {
  venture: CreateVentureArgs;
  safeAddress?: string;
}

function parseArgs(): MintCliArgs {
  const args = process.argv.slice(2);
  const result: Partial<CreateVentureArgs> = {};
  let safeAddress: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
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
        result.rootWorkstreamId = next;
        i++;
        break;
      case '--rootJobInstanceId':
      case '--jobInstance':
        result.rootJobInstanceId = next;
        i++;
        break;
      case '--status':
        result.status = next as 'active' | 'paused' | 'archived';
        i++;
        break;
      case '--tokenAddress':
        result.tokenAddress = next;
        i++;
        break;
      case '--tokenSymbol':
        result.tokenSymbol = next;
        i++;
        break;
      case '--tokenName':
        result.tokenName = next;
        i++;
        break;
      case '--stakingContractAddress':
        result.stakingContractAddress = next;
        i++;
        break;
      case '--tokenLaunchPlatform':
        result.tokenLaunchPlatform = next;
        i++;
        break;
      case '--tokenMetadata':
        result.tokenMetadata = JSON.parse(next);
        i++;
        break;
      case '--governanceAddress':
        result.governanceAddress = next;
        i++;
        break;
      case '--poolAddress':
        result.poolAddress = next;
        i++;
        break;
      case '--safe-address':
        safeAddress = next;
        i++;
        break;
    }
  }

  if (!result.name) {
    console.error('Error: --name is required');
    printUsage();
    process.exit(1);
  }
  if (!result.ownerAddress) {
    console.error('Error: --ownerAddress is required');
    printUsage();
    process.exit(1);
  }
  if (!result.blueprint) {
    console.error('Error: --blueprint is required');
    printUsage();
    process.exit(1);
  }

  return { venture: result as CreateVentureArgs, safeAddress };
}

function printUsage() {
  console.log(`
Usage: yarn tsx scripts/ventures/mint.ts [options]

Required:
  --name <name>              Venture name
  --ownerAddress <address>   Ethereum address of the owner
  --blueprint <json>         Blueprint JSON with invariants array

Token launch (auto-deploys a Doppler token if both are provided):
  --tokenSymbol <symbol>     Token symbol (e.g., GROWTH) — triggers token launch
  --safe-address <addr>      Gnosis Safe for governance + vesting — required with --tokenSymbol

Optional:
  --slug <slug>              URL-friendly slug (auto-generated if not provided)
  --description <text>       Venture description
  --rootWorkstreamId <id>    Workstream ID
  --rootJobInstanceId <id>   Root job instance ID
  --status <status>          Status: active, paused, archived
  --tokenAddress <addr>      Token contract address (skip if using --tokenSymbol auto-launch)
  --tokenName <name>         Token display name (defaults to venture name + " Token")
  --stakingContractAddress <addr>  Staking contract address
  --tokenLaunchPlatform <platform> Launch platform (e.g., doppler)
  --tokenMetadata <json>     Platform-specific metadata JSON
  --governanceAddress <addr> Governance contract address
  --poolAddress <addr>       Liquidity pool address

Examples:
  # Mint a tokenless venture
  yarn tsx scripts/ventures/mint.ts \\
    --name "My Venture" \\
    --ownerAddress "0x1234..." \\
    --blueprint '{"invariants":[{"id":"GOAL-001","form":"constraint","description":"Test invariant"}]}'

  # Mint a venture AND auto-launch a token
  yarn tsx scripts/ventures/mint.ts \\
    --name "Growth Agency" \\
    --ownerAddress "0x1234..." \\
    --blueprint '{"invariants":[{"id":"GOAL-001","form":"constraint","description":"Growth goals"}]}' \\
    --tokenSymbol "GROWTH" \\
    --safe-address "0xSafe..."
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  try {
    const { venture: ventureArgs, safeAddress } = parseArgs();
    const venture = await createVenture(ventureArgs);
    console.log('Venture created:');
    console.log(JSON.stringify({ ok: true, data: venture }, null, 2));

    // Auto-launch token if --tokenSymbol and --safe-address are both provided
    if (ventureArgs.tokenSymbol && safeAddress) {
      console.log('\nAuto-launching token via Doppler...');
      // Dynamic import with variable path prevents tsc from resolving doppler-sdk types
      const launchTokenPath = './launch-token.js';
      const { launchToken } = await import(launchTokenPath);
      const tokenName = ventureArgs.tokenName || `${ventureArgs.name} Token`;
      const tokenResult = await launchToken({
        ventureId: venture.id,
        name: tokenName,
        symbol: ventureArgs.tokenSymbol,
        safeAddress,
      });
      console.log('\nToken launch result:');
      console.log(JSON.stringify({ ok: true, data: tokenResult }, null, 2));
    } else if (ventureArgs.tokenSymbol && !safeAddress) {
      console.warn('\nWarning: --tokenSymbol provided without --safe-address. Token was NOT auto-launched.');
      console.warn('To launch a token, also provide --safe-address <addr>.');
    }
  } catch (err: any) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

// Only run CLI when executed directly (not when imported as module)
const isDirectRun = process.argv[1]?.endsWith('mint.ts') || process.argv[1]?.endsWith('mint.js');
if (isDirectRun) {
  main();
}
