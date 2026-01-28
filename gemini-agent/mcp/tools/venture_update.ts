import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { mcpLogger } from '../../../logging/index.js';

/**
 * Input schema for updating a venture.
 */
export const ventureUpdateParams = z.object({
  id: z.string().uuid().describe('Venture ID to update'),
  name: z.string().min(1).optional().describe('New venture name'),
  slug: z.string().optional().describe('New URL-friendly slug'),
  description: z.string().optional().describe('New venture description'),
  blueprint: z.string().optional().describe('New blueprint JSON string with invariants array'),
  rootWorkstreamId: z.string().optional().describe('New workstream ID for the venture'),
  jobTemplateId: z.string().optional().describe('New x402 job template ID'),
  config: z.record(z.any()).optional().describe('Additional configuration as JSON'),
  tags: z.array(z.string()).optional().describe('Tags for discovery'),
  featured: z.boolean().optional().describe('Whether venture is featured'),
  status: z.enum(['active', 'paused', 'archived']).optional().describe('Venture status'),
});

export type VentureUpdateParams = z.infer<typeof ventureUpdateParams>;

export const ventureUpdateSchema = {
  description: `Update an existing venture's properties.

Updates any combination of venture fields. The blueprint field, if provided, must be a valid JSON string containing an invariants array.

PREREQUISITES:
- Know the venture ID to update
- Have valid values for fields being updated

Parameters:
- id: Venture UUID (required)
- name: New venture name
- slug: New URL-friendly identifier
- description: New venture description
- blueprint: New JSON string with invariants array
- rootWorkstreamId: Associated workstream ID
- jobTemplateId: Associated x402 job template
- config: Additional configuration
- tags: Discovery tags
- featured: Whether to feature this venture
- status: 'active', 'paused', or 'archived'

Returns: { venture: { id, name, slug, ... } }`,
  inputSchema: ventureUpdateParams.shape,
};

/**
 * Update an existing venture.
 */
export async function ventureUpdate(args: unknown) {
  try {
    const parsed = ventureUpdateParams.safeParse(args);
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
      id,
      name,
      slug,
      description,
      blueprint: blueprintStr,
      rootWorkstreamId,
      jobTemplateId,
      config,
      tags,
      featured,
      status,
    } = parsed.data;

    // Build update record
    const record: Record<string, unknown> = {};

    if (name !== undefined) record.name = name;
    if (slug !== undefined) record.slug = slug;
    if (description !== undefined) record.description = description;
    if (rootWorkstreamId !== undefined) record.root_workstream_id = rootWorkstreamId;
    if (jobTemplateId !== undefined) record.job_template_id = jobTemplateId;
    if (config !== undefined) record.config = config;
    if (tags !== undefined) record.tags = tags;
    if (featured !== undefined) record.featured = featured;
    if (status !== undefined) record.status = status;

    // Parse and validate blueprint if provided
    if (blueprintStr !== undefined) {
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

      record.blueprint = blueprint;
    }

    if (Object.keys(record).length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'VALIDATION_ERROR', message: 'No fields to update' }
          })
        }]
      };
    }

    const { data, error } = await supabase
      .from('ventures')
      .update(record)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      mcpLogger.error({ error: error.message }, 'venture_update failed');
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

    if (!data) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: { ok: false, code: 'NOT_FOUND', message: `Venture not found: ${id}` }
          })
        }]
      };
    }

    mcpLogger.info({ ventureId: data.id, name: data.name }, 'Updated venture');

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
    mcpLogger.error({ error: message }, 'venture_update failed');
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
