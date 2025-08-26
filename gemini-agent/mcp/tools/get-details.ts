import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { tableNames } from './shared/types.js';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';

export const getDetailsParams = z.object({
    ids: z.array(z.string().uuid()).describe('An array containing one or more UUIDs to retrieve. If empty, returns an empty result.'),
    cursor: z.string().optional().describe('Opaque cursor for fetching the next page of results.'),
});

export type GetDetailsParams = z.infer<typeof getDetailsParams>;

export const getDetailsSchema = {
    description: 'Retrieves one or more records by ID by automatically searching across all tables in the system.',
    inputSchema: getDetailsParams.shape,
};

export async function getDetails(params: GetDetailsParams) {
    try {
        // Use safeParse to avoid throwing exceptions on validation errors
        const parseResult = getDetailsParams.safeParse(params);
        if (!parseResult.success) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
                }]
            };
        }
        const { ids, cursor } = parseResult.data as { ids: string[]; cursor?: string };
        const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };

        // Handle empty array case
        if (ids.length === 0) {
            const composed = composeSinglePageResponse([], {
                startOffset: keyset.offset,
                truncateChars: 0,
                requestedMeta: { cursor }
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: composed.meta }, null, 2) }] };
        }

        // Search across all tables
        const searchPromises = tableNames.map(async (table) => {
            try {
                const { data, error } = await supabase
                    .from(table)
                    .select('*')
                    .in('id', ids);
                
                if (error) {
                    // Silently handle table search errors - return empty array
                    return [];
                }
                
                // Add table name to each record for identification
                return (data || []).map(record => ({
                    ...record,
                    _source_table: table
                }));
            } catch (e) {
                // Silently handle table search failures - return empty array
                return [];
            }
        });

        const results = await Promise.all(searchPromises);
        const allRecords = results.flat();

        const composed = composeSinglePageResponse(allRecords, {
            startOffset: keyset.offset,
            truncateChars: 0,
            requestedMeta: { cursor }
        });

        return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: composed.meta }, null, 2) }] };

    } catch (e: any) {
        return {
            content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error getting details: ${e.message}` } }, null, 2) }] 
        };
    }
}
