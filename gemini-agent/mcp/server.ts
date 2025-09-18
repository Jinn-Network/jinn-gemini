import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setToolRegistry, getRegisteredToolNames } from './tools/shared/tool-registry.js';
import { loadEnvOnce } from './tools/shared/env.js';
import { z } from 'zod';

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

    // Build serverTools from imported tool modules
    serverTools = [
      { name: 'create_job', schema: tools.createJobSchema, handler: tools.createJob },
      { name: 'create_job_batch', schema: tools.createJobBatchSchema, handler: tools.createJobBatch },
      { name: 'update_job', schema: tools.updateJobSchema, handler: tools.updateJob },
      { name: 'get_context_snapshot', schema: tools.getContextSnapshotSchema, handler: tools.getContextSnapshot },
      { name: 'manage_artifact', schema: tools.manageArtifactSchema, handler: tools.manageArtifact },
      { name: 'get_details', schema: tools.getDetailsSchema, handler: tools.getDetails },
      // memory tools removed
      { name: 'search_jobs', schema: tools.searchJobsSchema, handler: tools.searchJobs },
      { name: 'search_artifacts', schema: tools.searchArtifactsSchema, handler: tools.searchArtifacts },
      { name: 'plan_project', schema: tools.planProjectSchema, handler: tools.planProject },
      { name: 'get_project_summary', schema: tools.getProjectSummarySchema, handler: tools.getProjectSummary },
      { name: 'send_message', schema: tools.sendMessageSchema, handler: tools.sendMessage },
      { name: 'civitai_generate_image', schema: tools.civitaiGenerateImageSchema, handler: tools.civitaiGenerateImage },
      { name: 'civitai_publish_post', schema: tools.civitaiPublishPostSchema, handler: tools.civitaiPublishPost },
      { name: 'civitai_search_models', schema: tools.civitaiSearchModelsSchema, handler: tools.civitaiSearchModels },
      { name: 'civitai_get_model_details', schema: tools.civitaiGetModelDetailsSchema, handler: tools.civitaiGetModelDetails },
      { name: 'civitai_search_images', schema: tools.civitaiSearchImagesSchema, handler: tools.civitaiSearchImages },
      { name: 'post_marketplace_job', schema: tools.postMarketplaceJobSchema, handler: tools.postMarketplaceJob },
      { name: 'create_artifact', schema: tools.createArtifactSchema, handler: tools.createArtifact },
      { name: 'create_message', schema: tools.createMessageSchema, handler: tools.createMessage },
      // Zora integration tools (preserved from main)
      { name: 'zora_prepare_create_coin_tx', schema: tools.prepareCreateCoinTxSchema, handler: tools.prepareCreateCoinTx },
      { name: 'enqueue_transaction', schema: tools.enqueueTransactionSchema, handler: tools.enqueueTransaction },
      { name: 'get_transaction_status', schema: tools.getTransactionStatusSchema, handler: tools.getTransactionStatus },
      { name: 'zora_query_coins', schema: tools.queryCoinsSchema, handler: tools.queryCoins }
    ];

    // Initialize the dynamic tool registry (internal) for dynamic enums
    setToolRegistry(serverTools);

    // Compute dynamic enum for enabled_tools and build dynamic schemas
    const allowedNames = getRegisteredToolNames();
    const enumValues = (allowedNames.length > 0 ? allowedNames : ['__no_tools__']) as [string, ...string[]];
    const enabledEnum = z.enum(enumValues);

    const createJobInputDynamic = tools.createJobParams.extend({
      enabled_tools: z.array(enabledEnum).describe('Array of tool names for this job. Allowed values are dynamically enumerated.'),
    });
    const createJobDynamicSchema = { description: 'Creates a new job definition or a new version of an existing job.', inputSchema: createJobInputDynamic.shape } as any;

    const jobDefDynamic = z.object({
      name: z.string().describe('The name of the job'),
      description: z.string().optional().describe('Optional description of the job purpose'),
      prompt_content: z.string().describe('The full prompt content for this job'),
      enabled_tools: z.array(enabledEnum).describe('Array of tool names this job can use. Allowed values are dynamically enumerated.'),
    });
    const createJobBatchInputDynamic = tools.createJobBatchParams.extend({
      jobs: z.array(jobDefDynamic).min(1).describe('Array of job definitions to create. Each job needs name, prompt_content, and enabled_tools.'),
    });
    const createJobBatchDynamicSchema = { description: 'Creates multiple job definitions with specified sequencing (parallel or serial execution).', inputSchema: createJobBatchInputDynamic.shape } as any;

    // Register all tools, swapping schemas for create_job and create_job_batch
    for (const tool of serverTools) {
      if (tool.name === 'create_job') {
        server.registerTool(tool.name, createJobDynamicSchema, tool.handler);
      } else if (tool.name === 'create_job_batch') {
        server.registerTool(tool.name, createJobBatchDynamicSchema, tool.handler);
      } else {
        if (tool.name !== 'get_schema') {
          server.registerTool(tool.name, tool.schema as any, tool.handler);
        }
      }
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