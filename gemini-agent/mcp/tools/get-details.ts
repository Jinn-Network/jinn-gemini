import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { tableNames } from './shared/types.js';

export const getDetailsParams = z.object({
    table_name: z.enum(tableNames).describe('The name of the table to query.'),
    ids: z.array(z.string().uuid()).describe('An array containing one or more UUIDs to retrieve. If empty, returns an empty result.'),
});

export type GetDetailsParams = z.infer<typeof getDetailsParams>;

export const getDetailsSchema = {
    description: 'Retrieves one or more records by ID from a table. If fetching threads, it also returns their associated artifact IDs.',
    inputSchema: getDetailsParams.shape,
};

export async function getDetails(params: GetDetailsParams) {
    try {
        // Use safeParse to avoid throwing exceptions on validation errors
        const parseResult = getDetailsParams.safeParse(params);
        if (!parseResult.success) {
            return { content: [{ type: 'text' as const, text: `Invalid parameters: ${parseResult.error.message}` }] };
        }
        const { table_name, ids } = parseResult.data;

        // Handle empty array case
        if (ids.length === 0) {
            return { content: [{ type: 'text' as const, text: JSON.stringify([], null, 2) }] };
        }
        const { data: records, error } = await supabase
            .from(table_name)
            .select('*')
            .in('id', ids);

        if (error) throw error;

        if (table_name === 'threads' && records.length > 0) {
            const threadIds = records.map(r => r.id);
            
            const { data: artifacts, error: artifactError } = await supabase
                .from('artifacts')
                .select('id, thread_id')
                .in('thread_id', threadIds);

            if (artifactError) throw artifactError;

            const artifactMap = new Map<string, string[]>();
            for (const artifact of artifacts) {
                if (!artifactMap.has(artifact.thread_id)) {
                    artifactMap.set(artifact.thread_id, []);
                }
                artifactMap.get(artifact.thread_id)!.push(artifact.id);
            }

            for (const record of records) {
                record.artifact_ids = artifactMap.get(record.id) || [];
            }
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(records, null, 2) }] };

    } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error getting details: ${e.message}` }] };
    }
}
