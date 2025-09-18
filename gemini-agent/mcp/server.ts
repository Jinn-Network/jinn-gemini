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

    // Dynamically import tools after env is loaded to guarantee availability
    const tools = await import('./tools/index.js');

    const server = new McpServer({
      name: 'metacog-mcp',
      version: '0.1.0',
    });

    // Build serverTools from imported tool modules (on-chain only + external integrations)
    serverTools = [
      { name: 'get_details', schema: tools.getDetailsSchema, handler: tools.getDetails },
      { name: 'search_jobs', schema: tools.searchJobsSchema, handler: tools.searchJobs },
      { name: 'search_artifacts', schema: tools.searchArtifactsSchema, handler: tools.searchArtifacts },
      { name: 'send_message', schema: tools.sendMessageSchema, handler: tools.sendMessage },
      { name: 'civitai_generate_image', schema: tools.civitaiGenerateImageSchema, handler: tools.civitaiGenerateImage },
      { name: 'civitai_publish_post', schema: tools.civitaiPublishPostSchema, handler: tools.civitaiPublishPost },
      { name: 'civitai_search_models', schema: tools.civitaiSearchModelsSchema, handler: tools.civitaiSearchModels },
      { name: 'civitai_get_model_details', schema: tools.civitaiGetModelDetailsSchema, handler: tools.civitaiGetModelDetails },
      { name: 'civitai_search_images', schema: tools.civitaiSearchImagesSchema, handler: tools.civitaiSearchImages },
      { name: 'post_marketplace_job', schema: tools.postMarketplaceJobSchema, handler: tools.postMarketplaceJob },
      { name: 'create_artifact', schema: tools.createArtifactSchema, handler: tools.createArtifact },
      { name: 'create_message', schema: tools.createMessageSchema, handler: tools.createMessage },
      { name: 'zora_prepare_create_coin_tx', schema: tools.prepareCreateCoinTxSchema, handler: tools.prepareCreateCoinTx },
      { name: 'enqueue_transaction', schema: tools.enqueueTransactionSchema, handler: tools.enqueueTransaction },
      { name: 'get_transaction_status', schema: tools.getTransactionStatusSchema, handler: tools.getTransactionStatus },
      { name: 'zora_query_coins', schema: tools.queryCoinsSchema, handler: tools.queryCoins },
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