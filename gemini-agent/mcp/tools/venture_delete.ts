import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { mcpLogger } from '../../../logging/index.js';

/**
 * Input schema for deleting a venture.
 */
export const ventureDeleteParams = z.object({
  id: z.string().uuid().describe('Venture ID to delete'),
  mode: z.enum(['soft', 'hard']).default('soft').describe('Delete mode: soft (archive) or hard (permanent)'),
  confirm: z.boolean().optional().describe('Required for hard delete - must be true'),
});

export type VentureDeleteParams = z.infer<typeof ventureDeleteParams>;

export const ventureDeleteSchema = {
  description: `Delete or archive a venture.

MODES:
- soft (default): Sets status to 'archived' - venture can be restored
- hard: Permanently deletes the venture - CANNOT BE UNDONE

IMPORTANT:
- Hard delete requires confirm: true
- Hard delete will fail if the venture has associated services
- Prefer soft delete for most cases

EXAMPLES:
1. Archive: { id: "<uuid>" }
2. Archive explicit: { id: "<uuid>", mode: "soft" }
3. Permanent delete: { id: "<uuid>", mode: "hard", confirm: true }

Returns: { success: true, venture? } for soft delete, { success: true } for hard delete`,
  inputSchema: ventureDeleteParams.shape,
};

/**
 * Delete or archive a venture.
 */
export async function ventureDelete(args: unknown) {
  try {
    const parsed = ventureDeleteParams.safeParse(args);
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

    const { id, mode, confirm } = parsed.data;

    // Verify venture exists first
    const { data: existingVenture, error: fetchError } = await supabase
      .from('ventures')
      .select('id, name, status')
      .eq('id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return errorResponse('NOT_FOUND', `Venture not found: ${id}`);
      }
      mcpLogger.error({ error: fetchError.message }, 'venture_delete fetch failed');
      return errorResponse('DATABASE_ERROR', fetchError.message);
    }

    if (mode === 'soft') {
      // Soft delete: set status to archived
      const { data, error } = await supabase
        .from('ventures')
        .update({ status: 'archived' })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        mcpLogger.error({ error: error.message }, 'venture_delete soft failed');
        return errorResponse('DATABASE_ERROR', error.message);
      }

      mcpLogger.info({ ventureId: id, name: existingVenture.name }, 'Archived venture (soft delete)');

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: { success: true, venture: data },
            meta: { ok: true }
          })
        }]
      };
    }

    // Hard delete
    if (mode === 'hard') {
      if (!confirm) {
        return errorResponse('VALIDATION_ERROR', 'Hard delete requires confirm: true');
      }

      // Check for associated services
      const { data: services, error: serviceError } = await supabase
        .from('services')
        .select('id')
        .eq('venture_id', id)
        .limit(1);

      if (serviceError) {
        mcpLogger.error({ error: serviceError.message }, 'venture_delete service check failed');
        return errorResponse('DATABASE_ERROR', serviceError.message);
      }

      if (services && services.length > 0) {
        return errorResponse(
          'CONSTRAINT_ERROR',
          'Cannot hard delete venture with associated services. Delete services first or use soft delete.'
        );
      }

      // Perform hard delete
      const { error: deleteError } = await supabase
        .from('ventures')
        .delete()
        .eq('id', id);

      if (deleteError) {
        mcpLogger.error({ error: deleteError.message }, 'venture_delete hard failed');
        return errorResponse('DATABASE_ERROR', deleteError.message);
      }

      mcpLogger.info({ ventureId: id, name: existingVenture.name }, 'Permanently deleted venture');

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: { success: true },
            meta: { ok: true }
          })
        }]
      };
    }

    return errorResponse('VALIDATION_ERROR', `Unknown mode: ${mode}`);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    mcpLogger.error({ error: message }, 'venture_delete failed');
    return errorResponse('EXECUTION_ERROR', message);
  }
}

function errorResponse(code: string, message: string) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ data: null, meta: { ok: false, code, message } })
    }]
  };
}
