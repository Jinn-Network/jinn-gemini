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
  getContextSnapshot,
  getContextSnapshotSchema,
  listTools,
  listToolsSchema,
  manageArtifact,
  manageArtifactSchema,
  manageThread,
  manageThreadSchema,
  getDetails,
  getDetailsSchema,
  createMemory,
  createMemorySchema,
  searchMemories,
  searchMemoriesSchema,
  traceThread,
  traceThreadSchema,
  reconstructJob,
  reconstructJobSchema,
  searchEvents,
  searchEventsSchema
} from './tools/index.js';

// This is the single source of truth for all tools registered on this server.
export const serverTools: { name: string; schema: any; handler: (params: any) => any }[] = [
  { name: 'get_schema', schema: getSchemaSchema, handler: getSchema },
  { name: 'create_record', schema: createRecordSchema, handler: createRecord },
  { name: 'read_records', schema: readRecordsSchema, handler: readRecords },
  { name: 'update_records', schema: updateRecordsSchema, handler: updateRecords },
  { name: 'delete_records', schema: deleteRecordsSchema, handler: deleteRecords },
  { name: 'create_job', schema: createJobSchema, handler: createJob },
  { name: 'get_context_snapshot', schema: getContextSnapshotSchema, handler: getContextSnapshot },
  { name: 'manage_artifact', schema: manageArtifactSchema, handler: manageArtifact },
  { name: 'manage_thread', schema: manageThreadSchema, handler: manageThread },
  { name: 'get_details', schema: getDetailsSchema, handler: getDetails },
  { name: 'create_memory', schema: createMemorySchema, handler: createMemory },
  { name: 'search_memories', schema: searchMemoriesSchema, handler: searchMemories },
  { name: 'trace_thread', schema: traceThreadSchema, handler: traceThread },
  { name: 'reconstruct_job', schema: reconstructJobSchema, handler: reconstructJob },
  { name: 'search_events', schema: searchEventsSchema, handler: searchEvents }
];

async function main() {
  try {
    const server = new McpServer({
      name: 'metacog-mcp',
      version: '0.1.0',
    });

    // Register all tools using a permissive input schema so that validation
    // and errors are handled inside handlers and returned as content.
    for (const tool of serverTools) {
      const relaxedSchema = {
        description: tool.schema.description,
        inputSchema: {},
      } as any;
      server.registerTool(tool.name, relaxedSchema, tool.handler);
    }

    // Register the list_tools tool itself with a permissive schema as well,
    // passing the serverTools list to the handler for discovery purposes.
    const relaxedListToolsSchema = { description: listToolsSchema.description, inputSchema: {} } as any;
    server.registerTool('list_tools', relaxedListToolsSchema, (params) => listTools(params, serverTools));

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MCP Server for Metacog tools is running.');
  } catch (e) {
    console.error('Error starting MCP server:', e);
    process.exit(1);
  }
}

main();