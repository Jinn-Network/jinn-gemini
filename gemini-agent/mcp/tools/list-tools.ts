import { z } from 'zod';

// Define the structure for tool information, including optional examples
interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, any>;
  examples?: string[];
}

// Hardcode the core CLI tools that are not part of this MCP server
const CORE_CLI_TOOLS: ToolInfo[] = [
  {
    name: 'web_fetch',
    description: 'Fetches content from URLs. Takes a comprehensive prompt that includes the URL(s) to fetch and specific instructions on how to process their content.',
    parameters: {
      prompt: {
        type: 'string',
        description: 'A comprehensive prompt that includes the URL(s) (up to 20) to fetch and specific instructions on how to process their content. The prompt must contain at least one URL starting with http:// or https://.',
        required: true
      }
    },
    examples: [
      'Fetch and summarize an article: {"prompt": "Can you summarize the main points of https://example.com/news/latest"}',
      'Compare two articles: {"prompt": "What are the differences in the conclusions of these two papers: https://arxiv.org/abs/2401.0001 and https://arxiv.org/abs/2401.0002?"}'
    ]
  },
  {
    name: 'google_web_search',
    description: 'Performs web searches via the Gemini API. Returns a processed summary of the search results, including citations to the original sources.',
    parameters: {
      query: {
        type: 'string',
        description: 'The search query to perform.',
        required: true
      }
    },
    examples: [
      'Search for latest AI advancements: {"query": "latest advancements in AI-powered code generation"}',
      'Search for specific information: {"query": "best practices for TypeScript error handling"}'
    ]
  },
];

export const listToolsParams = z.object({
  include_examples: z.boolean().optional().describe('Whether to include usage examples in the response.'),
  include_parameters: z.boolean().optional().describe('Whether to include full parameter details in the response.'),
  tool_name: z.string().optional().describe('If provided, returns detailed information about a specific tool.'),
});

export const listToolsSchema = {
  description: `Lists all available tools (core CLI + MCP server tools).

MANDATORY: Call this BEFORE using create_job or create_job_batch so you select appropriate enabled_tools. Research jobs should include web search tools (google_web_search or web_fetch) when internet research is required.

Important scope note: This list is a catalog of tools that CAN be enabled for jobs. It does not guarantee they are currently enabled for your job/run. Your effective toolset at runtime is controlled by each job's enabled_tools (plus any universal tools and server exclusions). Use this list to decide which tools to include in enabled_tools when creating jobs.

Usage:
- Default: returns tool names and descriptions
- include_parameters=true: include full parameter schemas
- include_examples=true: include usage examples when available
- tool_name="<name>": return details for a single tool

Response: { data: { total_tools, tools: [{ name, description, parameters?, examples? }] }, meta: { ok: true } }`,
  inputSchema: listToolsParams.shape,
};

export async function listTools(params: any, serverTools: any[]) {
  try {
    const parseResult = listToolsParams.safeParse(params);
    if (!parseResult.success) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
        }]
      };
    }
    const { include_examples = false, include_parameters = false, tool_name } = parseResult.data;

    const dynamicTools: ToolInfo[] = serverTools.map(tool => ({
      name: tool.name,
      description: tool.schema.description,
      parameters: tool.schema.inputSchema,
    }));

    let allTools: ToolInfo[] = [...CORE_CLI_TOOLS, ...dynamicTools];

    if (tool_name) {
      allTools = allTools.filter(tool => tool.name.toLowerCase() === tool_name.toLowerCase());
      if (allTools.length === 0) {
        const availableToolNames = [...CORE_CLI_TOOLS, ...dynamicTools].map(t => t.name).join(', ');
        return {
          isError: true,
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ ok: false, code: 'NOT_FOUND', message: `Tool '${tool_name}' not found.`, details: { available_tools: availableToolNames } }, null, 2)
          }]
        };
      }
    }

    const toolsInfo = allTools.map(tool => {
      const info: any = { name: tool.name, description: tool.description };
      if (include_parameters) {
        info.parameters = tool.parameters;
      }
      if (include_examples && (tool as any).examples) {
        info.examples = (tool as any).examples;
      }
      return info;
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ data: { total_tools: toolsInfo.length, tools: toolsInfo }, meta: { ok: true } }, null, 2)
      }]
    };
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'RUNTIME_ERROR', message: `Error listing tools: ${e.message}` } }, null, 2) },
      ],
    };
  }
}