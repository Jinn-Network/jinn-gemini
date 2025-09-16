import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { tableNameSchema } from './shared/types.js';

// Helper function to get schema information when errors occur
async function getSchemaHelp(tableName: string, error: any): Promise<string> {
  try {
    // If it's a table-related error, provide helpful guidance
    // Always try to provide schema help for database errors
    if (error.message) {
      // Try to get actual schema information
      try {
        const { data: schemaData, error: schemaError } = await supabase.rpc('get_table_schema', {
          p_table_name: tableName,
        });
        
        if (!schemaError && schemaData && Array.isArray(schemaData) && schemaData.length > 0) {
          return `\n\nSCHEMA HELP for table '${tableName}':\n${JSON.stringify(schemaData, null, 2)}`;
        }
      } catch (schemaCallError) {
        // Schema call failed, fall back to basic info
      }
      
      // Fallback: get list of all tables
      try {
        const { data: allTablesData, error: allTablesError } = await supabase.rpc('get_all_tables');
        
        if (!allTablesError && allTablesData) {
          return `\n\nSCHEMA HELP: Table '${tableName}' not found. Available tables:\n${JSON.stringify(allTablesData, null, 2)}`;
        }
      } catch (allTablesCallError) {
        // All tables call failed, fall back to hardcoded list
      }
      
      // Final fallback: hardcoded table list (based on actual database)
      return `\n\nSCHEMA HELP: 
- Table: '${tableName}'
- Error: ${error.message}
- Available tables: artifacts, job_board, jobs, job_reports, memories, messages, project_runs, project_definitions, system_state, events
- Use 'get_schema' tool to see detailed table structure
- Use 'get_schema' without table_name to see all available tables`;
    }
    
    return '';
  } catch (e: any) {
    // If even the schema help fails, return a minimal message
    return `\n\nSCHEMA HELP: Error occurred while trying to provide schema help.`;
  }
}

export const createRecordParams = z.object({
  table_name: tableNameSchema,
  data: z.record(z.string(), z.any()).describe('A JSON object where keys are column names and values are the data to insert.'),
});

export const createRecordSchema = {
  description: 'Inserts a new row into a specified table. It automatically adds source_job_id, source_job_name, and thread_id from the current job context. Note: system_state table is read-only and cannot be modified.',
  inputSchema: createRecordParams.shape,
};

export async function createRecord(params: z.infer<typeof createRecordParams>) {
  let table_name: string = '';
  try {
    const parseResult = createRecordParams.safeParse(params);
    if (!parseResult.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined } })
        }]
      };
    }
    const { table_name: tn, data } = parseResult.data;
    table_name = tn;
    const { jobId, jobDefinitionId, jobName, projectRunId, sourceEventId, projectDefinitionId, requestId, mechAddress } = getCurrentJobContext();
    
    // Only inject context into tables designed to carry lineage fields
    const tablesWithLineage = new Set(['artifacts', 'job_reports', 'memories', 'messages', 'threads']);
    const tablesOnchain = new Set(['onchain_artifacts', 'onchain_job_reports', 'onchain_messages']);
    const enrichedData = tablesWithLineage.has(table_name as string)
      ? {
          ...data,
          job_id: jobId,                  // ✅ CORRECT field name for messages/job_reports tables
          project_run_id: projectRunId,
          source_event_id: sourceEventId,
          parent_job_definition_id: jobDefinitionId,
          project_definition_id: projectDefinitionId,
        }
      : tablesOnchain.has(table_name as string)
      ? {
          ...data,
          request_id: requestId,
          worker_address: mechAddress,
        }
      : data;

    const { data: newId, error } = await supabase.rpc('create_record', {
      p_table_name: table_name,
      p_data: enrichedData,
    });
    if (error) {
      // Get schema help for schema-related errors
      const schemaHelp = await getSchemaHelp(table_name, error);
      const errorMessage = `Error creating record: ${error.message}${schemaHelp}`;
      
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            data: null, 
            meta: { 
              ok: false, 
              code: 'DB_ERROR', 
              message: errorMessage 
            } 
          }, null, 2)
        }]
      };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: { id: newId }, meta: { ok: true } }) }] };
  } catch (e: any) {
    // Get schema help for schema-related errors
    const schemaHelp = await getSchemaHelp(table_name, e);
    const errorMessage = `Error creating record: ${e.message}${schemaHelp}`;
    
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: errorMessage } }) },
      ],
    };
  }
} 