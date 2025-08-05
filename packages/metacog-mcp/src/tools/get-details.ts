import { supabase } from './shared/supabase.js';
import { z } from 'zod';
import { tableNames } from './shared/types.js';
import { exceedsSizeLimit, getDataSizeMB, DEFAULT_SIZE_LIMIT_MB } from './shared/data-size-limiter.js';

export const getDetailsParams = z.object({
    table_name: z.enum(tableNames).describe('The name of the table to query.'),
    ids: z.array(z.string()).describe('An array containing one or more UUIDs to retrieve. If empty, returns an empty result.'),
});

export type GetDetailsParams = z.infer<typeof getDetailsParams>;

export const getDetailsSchema = {
    description: 'Retrieves one or more records by ID from a table. If fetching threads, it also returns their associated artifact IDs.',
    inputSchema: getDetailsParams.shape,
};

export async function getDetails(params: GetDetailsParams) {
    const { table_name, ids } = getDetailsParams.parse(params);

    // Handle empty array case
    if (ids.length === 0) {
        return { content: [{ type: 'text' as const, text: JSON.stringify([], null, 2) }] };
    }

    try {
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

        // Check if data exceeds size limit
        if (exceedsSizeLimit(records)) {
            const dataSizeMB = getDataSizeMB(records);
            console.log(`Get details data size ${dataSizeMB.toFixed(2)}MB exceeds limit ${DEFAULT_SIZE_LIMIT_MB}MB, reducing record count`);
            
            // Limit number of records to fit within size limit
            let finalRecords = records;
            let reduction = 2;
            
            while (exceedsSizeLimit(finalRecords) && finalRecords.length > 1) {
                const maxRecords = Math.max(1, Math.floor(records.length / reduction));
                finalRecords = records.slice(0, maxRecords);
                reduction *= 2;
                console.log(`Trying with ${maxRecords} records (${getDataSizeMB(finalRecords).toFixed(2)}MB)`);
            }

            return { 
                content: [{ 
                    type: 'text' as const, 
                    text: JSON.stringify({
                        warning: `Data limited due to size constraint (${DEFAULT_SIZE_LIMIT_MB}MB). Original: ${records.length} records, Returned: ${finalRecords.length} records`,
                        records: finalRecords
                    }, null, 2) 
                }] 
            };
        }

        return { content: [{ type: 'text' as const, text: JSON.stringify(records, null, 2) }] };

    } catch (e: any) {
        return { content: [{ type: 'text' as const, text: `Error getting details: ${e.message}` }] };
    }
}
