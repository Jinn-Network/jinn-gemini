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
  description:'Lists all tools available in the system for job configuration. These tools may not be enabled for the current job but can be configured for future jobs. Returns descriptions, parameters, and optional usage examples.',
  inputSchema: listToolsParams.shape,
};

export async function listTools(params: any, serverTools: any[]) {
  try {
    const validatedParams = listToolsParams.parse(params);
    const { include_examples = false, include_parameters = false, tool_name } = validatedParams;

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
          content: [{
            type: 'text' as const,
            text: `Tool '${tool_name}' not found. Available tools: ${availableToolNames}`
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
        text: JSON.stringify({ total_tools: toolsInfo.length, tools: toolsInfo }, null, 2)
      }]
    };
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: `Error listing tools: ${e.message}` },
      ],
    };
  }
}