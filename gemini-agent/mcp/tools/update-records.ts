import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { tableNameSchema } from './shared/types.js';
import { shouldUseControlApi } from './shared/control_api.js';

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
    return `\n\nSCHEMA HELP: Unable to fetch schema information: ${e.message}`;
  }
}

export const updateRecordsParams = z.object({
  table_name: tableNameSchema,
  filter: z.record(z.string(), z.any()).refine(obj => Object.keys(obj).length > 0, {
    message: "Filter cannot be empty - must specify at least one condition to prevent accidental update of all records"
  }).describe('A JSON object to identify the row(s) to update. Cannot be empty.'),
  updates: z.record(z.string(), z.any()).refine(obj => Object.keys(obj).length > 0, {
    message: "Updates cannot be empty - must specify at least one field to update"
  }).describe('A JSON object of columns and their new values.'),
});

export const updateRecordsSchema = {
  description: 'Modifies existing rows in a table that match a filter. On-chain tables are controlled by the Control API; direct updates are not supported.',
  inputSchema: updateRecordsParams.shape,
};

export async function updateRecords(params: z.infer<typeof updateRecordsParams>) {
  let table_name: string = '';
  try {
    const parseResult = updateRecordsParams.safeParse(params);
    if (!parseResult.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined } })
        }]
      };
    }
    const { table_name: tn, filter, updates } = parseResult.data;
    table_name = tn;
    const { jobId, jobName } = getCurrentJobContext();

    // All direct updates removed
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'UNSUPPORTED', message: 'Direct updates are disabled. Use Control API workflows.' } }) }] };
  } catch (e: any) {
    // Get schema help for schema-related errors
    const schemaHelp = await getSchemaHelp(table_name, e);
    const errorMessage = `Error updating records: ${e.message}${schemaHelp}`;
    
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: errorMessage } }) },
      ],
    };
  }
} 