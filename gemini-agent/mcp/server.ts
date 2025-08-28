import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  getSchema, 
  getSchemaSchema,
  createRecord, 
  createRecordSchema,
  readRecords, 
  readRecordsSchema,
  updateRecords, 
  updateRecordsSchema,
  deleteRecords, 
  deleteRecordsSchema,
  createJob,
  createJobSchema,
  createJobBatch,
  createJobBatchSchema,
  updateJob,
  updateJobSchema,
  dispatchJob,
  dispatchJobSchema,
  getContextSnapshot,
  getContextSnapshotSchema,
  listTools,
  listToolsSchema,
  manageArtifact,
  manageArtifactSchema,
  getDetails,
  getDetailsSchema,
  createMemory,
  createMemorySchema,
  searchMemories,
  searchMemoriesSchema,
  planProject,
  planProjectSchema,
  getProjectSummary,
  getProjectSummarySchema,
  sendMessage,
  sendMessageSchema,
  civitaiGenerateImage,
  civitaiGenerateImageSchema,
  civitaiPublishPost,
  civitaiPublishPostSchema,
  civitaiSearchModels,
  civitaiSearchModelsSchema,
  civitaiGetImageStats,
  civitaiGetImageStatsSchema,
  civitaiGetModelDetails,
  civitaiGetModelDetailsSchema
} from './tools/index.js';

// This is the single source of truth for all tools registered on this server.
export const serverTools: { name: string; schema: any; handler: (params: any) => any }[] = [
  { name: 'get_schema', schema: getSchemaSchema, handler: getSchema },
  { name: 'create_record', schema: createRecordSchema, handler: createRecord },
  { name: 'read_records', schema: readRecordsSchema, handler: readRecords },
  { name: 'update_records', schema: updateRecordsSchema, handler: updateRecords },
  { name: 'delete_records', schema: deleteRecordsSchema, handler: deleteRecords },
  { name: 'create_job', schema: createJobSchema, handler: createJob },
  { name: 'create_job_batch', schema: createJobBatchSchema, handler: createJobBatch },
  { name: 'update_job', schema: updateJobSchema, handler: updateJob },
  { name: 'dispatch_job', schema: dispatchJobSchema, handler: dispatchJob },
  { name: 'get_context_snapshot', schema: getContextSnapshotSchema, handler: getContextSnapshot },
  { name: 'manage_artifact', schema: manageArtifactSchema, handler: manageArtifact },
  { name: 'get_details', schema: getDetailsSchema, handler: getDetails },
  { name: 'create_memory', schema: createMemorySchema, handler: createMemory },
  { name: 'search_memories', schema: searchMemoriesSchema, handler: searchMemories },
  { name: 'plan_project', schema: planProjectSchema, handler: planProject },
  { name: 'get_project_summary', schema: getProjectSummarySchema, handler: getProjectSummary },
  { name: 'send_message', schema: sendMessageSchema, handler: sendMessage },
  { name: 'civitai_generate_image', schema: civitaiGenerateImageSchema, handler: civitaiGenerateImage },
  { name: 'civitai_publish_post', schema: civitaiPublishPostSchema, handler: civitaiPublishPost },
  { name: 'civitai_search_models', schema: civitaiSearchModelsSchema, handler: civitaiSearchModels },
  { name: 'civitai_get_image_stats', schema: civitaiGetImageStatsSchema, handler: civitaiGetImageStats },
  { name: 'civitai_get_model_details', schema: civitaiGetModelDetailsSchema, handler: civitaiGetModelDetails }
];

async function main() {
  try {
    const server = new McpServer({
      name: 'metacog-mcp',
      version: '0.1.0',
    });

    // Register all tools with their original schemas
    for (const tool of serverTools) {
      server.registerTool(tool.name, tool.schema as any, tool.handler);
    }

    // Register the list_tools tool with its actual schema as well, passing serverTools for discovery.
    server.registerTool('list_tools', listToolsSchema as any, (params) => listTools(params, serverTools));

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (e) {
    console.error('Error starting MCP server:', e);
    process.exit(1);
  }
}

main();