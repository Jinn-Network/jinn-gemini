/**
 * Centralized tool policy configuration
 * 
 * This module defines which tools are available to agents based on job configuration.
 * It handles both MCP tool inclusion/exclusion and CLI native tool whitelisting.
 * 
 * Tool categories:
 * - Universal tools: Always available to all agents (MCP tools for job management, artifacts, etc.)
 * - Job-specific tools: Explicitly enabled by the job definition
 * - Native tools: File system and shell operations that require CLI whitelisting
 */

/**
 * Universal tools that every agent gets automatically
 * These ensure all agents can plan projects, create jobs, manage artifacts, etc.
 */
export const UNIVERSAL_TOOLS = [
  // MCP server tools (job management, artifacts, search)
  'list_tools',
  'get_details',
  'get_job_context',
  'dispatch_new_job',
  'dispatch_existing_job',
  'create_artifact',
  'search_jobs',
  'search_artifacts',
  'google_web_search',
  'web_fetch',
  // Read-only native file tools (always available)
  'list_directory',
  'read_file',
  'search_file_content',
  'glob',
  'read_many_files'
] as const;

/**
 * All native tools that can be enabled/disabled per job
 * These require explicit CLI whitelisting via --allowed-tools flag
 */
export const NATIVE_TOOLS = [
  'list_directory',
  'read_file',
  'write_file',
  'search_file_content',
  'glob',
  'replace',
  'read_many_files',
  'run_shell_command',
  'save_memory',
] as const;

/**
 * Native tools that are always enabled regardless of job configuration
 * These are safe and essential for basic agent operation
 */
export const ALWAYS_ENABLED_NATIVE_TOOLS = [
  'web_fetch',
  'google_web_search',
] as const;

/**
 * Result of tool policy computation
 */
export interface ToolPolicyResult {
  /** MCP tools to include (universal + job-specific, deduplicated) */
  mcpIncludeTools: string[];
  /** Native tools to exclude from MCP (tools not in the include list) */
  mcpExcludeTools: string[];
  /** Native tools to whitelist for CLI --allowed-tools flag */
  cliAllowedTools: string[];
}

/**
 * Compute tool policy for a job based on its enabled tools
 * 
 * @param jobEnabledTools - Tools explicitly enabled by the job definition (may be empty)
 * @returns Tool policy result with MCP and CLI configurations
 */
export function computeToolPolicy(jobEnabledTools: string[] = []): ToolPolicyResult {
  // Merge universal tools with job-specific tools, removing duplicates
  const allTools = [...UNIVERSAL_TOOLS, ...jobEnabledTools];
  const uniqueTools = [...new Set(allTools)];

  // MCP include: all tools the agent should have access to
  const mcpIncludeTools = uniqueTools;

  // MCP exclude: native tools that are NOT in the include list AND NOT always-enabled
  const nativeToolsToExclude = NATIVE_TOOLS.filter(tool =>
    !uniqueTools.includes(tool) && !ALWAYS_ENABLED_NATIVE_TOOLS.includes(tool)
  );

  // CLI allowed tools: native tools that ARE in the include list OR are always-enabled
  // These are the tools that need --allowed-tools flag for auto-approval
  // Note: Always-enabled tools must be included even if they're not in NATIVE_TOOLS
  const cliAllowedTools = [
    ...NATIVE_TOOLS.filter(tool => uniqueTools.includes(tool)),
    ...ALWAYS_ENABLED_NATIVE_TOOLS
  ];
  // Remove duplicates while preserving order
  const uniqueCliAllowedTools = [...new Set(cliAllowedTools)];

  return {
    mcpIncludeTools,
    mcpExcludeTools: nativeToolsToExclude,
    cliAllowedTools: uniqueCliAllowedTools
  };
}

