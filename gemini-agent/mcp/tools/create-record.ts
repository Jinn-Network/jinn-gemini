import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { tableNameSchema } from './shared/types.js';
import { shouldUseControlApi, createJobReport, createArtifact, createMessage } from './shared/control_api.js';

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
  description: 'Inserts a new row into a specified table. On-chain tables are written exclusively via the Control API with automatic lineage.',
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
    
    // Route onchain_* tables to Control API
    if (shouldUseControlApi(table_name)) {
      try {
        let newId: string;
        
        if (table_name === 'onchain_job_reports') {
          // Map data to JobReportInput format
          const reportData = {
            status: data.status || 'COMPLETED',
            duration_ms: data.duration_ms || 0,
            total_tokens: data.total_tokens || null,
            tools_called: data.tools_called ? JSON.stringify(data.tools_called) : null,
            final_output: data.final_output || null,
            error_message: data.error_message || null,
            error_type: data.error_type || null,
            raw_telemetry: data.raw_telemetry ? JSON.stringify(data.raw_telemetry) : null,
          };
          
          if (!requestId) {
            throw new Error('requestId is required for onchain_job_reports via Control API');
          }
          
          newId = await createJobReport(requestId, reportData);
        } else if (table_name === 'onchain_artifacts') {
          // Map data to ArtifactInput format
          const artifactData = {
            cid: data.cid || 'inline',
            topic: data.topic || 'default',
            content: data.content || null,
          };
          
          if (!requestId) {
            throw new Error('requestId is required for onchain_artifacts via Control API');
          }
          
          newId = await createArtifact(requestId, artifactData);
        } else if (table_name === 'onchain_messages') {
          // Map data to MessageInput format
          const messageData = {
            content: data.content || '',
            status: data.status || 'PENDING',
          };
          
          if (!requestId) {
            throw new Error('requestId is required for onchain_messages via Control API');
          }
          
          newId = await createMessage(requestId, messageData);
        } else {
          // For other onchain tables, fall back to direct Supabase
          const enrichedData = {
            ...data,
            request_id: requestId,
            worker_address: mechAddress,
          };
          
          const { data: directId, error } = await supabase.rpc('create_record', {
            p_table_name: table_name,
            p_data: enrichedData,
          });
          
          if (error) throw error;
          newId = directId;
        }
        
        return { content: [{ type: 'text' as const, text: JSON.stringify({ data: { id: newId }, meta: { ok: true, source: 'control_api' } }) }] };
      } catch (controlError: any) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ 
              data: null, 
              meta: { 
                ok: false, 
                code: 'CONTROL_API_ERROR', 
                message: `Control API error: ${controlError.message}` 
              } 
            }, null, 2)
          }]
        };
      }
    }
    
    // Legacy path removed: non-onchain writes are no longer supported here
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'UNSUPPORTED', message: 'Direct writes to legacy tables are no longer supported.' } }) }] };
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