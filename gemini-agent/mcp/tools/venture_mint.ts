import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { mcpLogger } from '../../../logging/index.js';

/**
 * Input schema for minting a venture.
 */
export const ventureMintParams = z.object({
  name: z.string().min(1).describe('Venture name'),
  slug: z.string().optional().describe('URL-friendly slug (auto-generated if not provided)'),
  description: z.string().optional().describe('Venture description'),
  ownerAddress: z.string().min(1).describe('Ethereum address of the venture owner'),
  blueprint: z.string().describe('Blueprint JSON string with invariants array'),
  rootWorkstreamId: z.string().optional().describe('Workstream ID for the venture'),
  rootJobInstanceId: z.string().optional().describe('Optional root job instance ID'),
  status: z.enum(['active', 'paused', 'archived']).optional().default('active').describe('Venture status'),
});

export type VentureMintParams = z.infer<typeof ventureMintParams>;

export const ventureMintSchema = {
  description: `Create a new venture with a blueprint defining its invariants.

A venture is a persistent project entity that owns workstreams and services. Each venture has:
- A blueprint containing invariants (success criteria)
- An owner address (Ethereum address)
- Optional workstream and job instance associations

PREREQUISITES:
- Have a valid blueprint with invariants array
- Know the owner's Ethereum address

Parameters:
- name: Venture name (required)
- ownerAddress: Ethereum address of the owner (required)
- blueprint: JSON string with invariants array (required)
- slug: URL-friendly identifier (auto-generated from name if not provided)
- description: Venture description
- rootWorkstreamId: Associated workstream ID
- rootJobInstanceId: Associated root job instance
- status: 'active', 'paused', or 'archived'

Returns: { venture: { id, name, slug, ... } }`,
  inputSchema: ventureMintParams.shape,
};

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
 * Mint (create) a new venture.
 */
export async function ventureMint(args: unknown) {
  try {
    const parsed = ventureMintParams.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message }
          })
        }]
      };
    }

    const {
      name,
      slug: providedSlug,
      description,
      ownerAddress,
      blueprint: blueprintStr,
      rootWorkstreamId,
      rootJobInstanceId,
      status,
    } = parsed.data;

    // Parse and validate blueprint
    let blueprint: { invariants: unknown[] };
    try {
      blueprint = JSON.parse(blueprintStr);
    } catch (e) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid blueprint JSON' }
          })
        }]
      };
    }

    if (!blueprint.invariants || !Array.isArray(blueprint.invariants)) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'VALIDATION_ERROR', message: 'Blueprint must contain an "invariants" array' }
          })
        }]
      };
    }

    const slug = providedSlug || generateSlug(name);

    const record = {
      name,
      slug,
      description: description || null,
      owner_address: ownerAddress,
      blueprint,
      root_workstream_id: rootWorkstreamId || null,
      root_job_instance_id: rootJobInstanceId || null,
      status: status || 'active',
    };

    const { data, error } = await supabase
      .from('ventures')
      .insert(record)
      .select()
      .single();

    if (error) {
      mcpLogger.error({ error: error.message }, 'venture_mint failed');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'DATABASE_ERROR', message: error.message }
          })
        }]
      };
    }

    mcpLogger.info({ ventureId: data.id, name }, 'Created new venture');

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: { venture: data },
          meta: { ok: true }
        })
      }]
    };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    mcpLogger.error({ error: message }, 'venture_mint failed');
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: null,
          meta: { ok: false, code: 'EXECUTION_ERROR', message }
        })
      }]
    };
  }
}
