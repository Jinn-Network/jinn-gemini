import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setToolRegistry, getRegisteredToolNames } from './tools/shared/tool-registry.js';
import { loadEnvOnce } from './tools/shared/env.js';

// Built at runtime after env is loaded and tools are imported
export let serverTools: { name: string; schema: any; handler: (params: any) => any }[] = [];

async function main() {
  try {
    // Ensure .env variables are available to all tools before they are imported/registered
    loadEnvOnce();

    // Suppress noisy stdout loggers to protect MCP stdio JSON stream
    // Only allow warnings/errors to reach stderr (Cursor will show those as errors)
    const level = (process.env.MCP_LOG_LEVEL || 'error').toLowerCase();
    const noop = () => {};
    // Always prevent stdout logging
    (console as any).log = noop;
    (console as any).info = noop;
    (console as any).debug = level === 'debug' ? console.debug.bind(console) : noop;
    // Route warnings to stderr; errors already go to stderr
    (console as any).warn = console.error.bind(console);

    // Dynamically import tools after env is loaded to guarantee availability
    const tools = await import('./tools/index.js');

    const server = new McpServer({
      name: 'metacog-mcp',
      version: '0.1.0',
    });

    // Build serverTools from imported tool modules (core tools only)
    serverTools = [
      { name: 'get_details', schema: tools.getDetailsSchema, handler: tools.getDetails },
      { name: 'get_job_context', schema: tools.getJobContextSchema, handler: tools.getJobContext },
      { name: 'dispatch_new_job', schema: tools.dispatchNewJobSchema, handler: tools.dispatchNewJob },
      { name: 'create_artifact', schema: tools.createArtifactSchema, handler: tools.createArtifact },
      { name: 'dispatch_existing_job', schema: tools.dispatchExistingJobSchema, handler: tools.dispatchExistingJob },
      { name: 'search_jobs', schema: tools.searchJobsSchema, handler: tools.searchJobs },
      { name: 'search_artifacts', schema: tools.searchArtifactsSchema, handler: tools.searchArtifacts },
      { name: 'finalize_job', schema: tools.finalizeJobSchema, handler: tools.finalizeJob },
    ];

    // Initialize the dynamic tool registry (internal) for dynamic enums
    setToolRegistry(serverTools);

    // Register all tools
    for (const tool of serverTools) {
      // get_schema is not registered; legacy tools removed
      server.registerTool(tool.name, tool.schema as any, tool.handler);
    }

    // Expose list_tools for operator introspection (agents may ignore)
    server.registerTool('list_tools', tools.listToolsSchema as any, (params) => tools.listTools(params, serverTools));

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (e) {
    console.error('Error starting MCP server:', e);
    process.exit(1);
  }
}

main();