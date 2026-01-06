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
 * Base universal tools available to all agents
 * These include job management, artifacts, search, and read-only file tools
 */
export const BASE_UNIVERSAL_TOOLS = [
  // MCP server tools (job management, artifacts, search)
  'list_tools',
  'get_details',
  'inspect_situation',
  'dispatch_new_job',
  'dispatch_existing_job',
  'create_artifact',
  'search_jobs',
  'search_artifacts',
  'google_web_search',
  'web_fetch',
  // Read-only native file tools
  'list_directory',
  'read_file',
  'search_file_content',
  'glob',
  'read_many_files',
] as const;

/**
 * Coding tools available only to coding jobs
 * These include git workflow and file write/edit operations
 */
export const CODING_UNIVERSAL_TOOLS = [
  'process_branch',
  'write_file',
  'replace',
  'run_shell_command',
  'write_todos'
] as const;

/**
 * Universal tools that every coding agent gets automatically
 * For artifact-only jobs, use BASE_UNIVERSAL_TOOLS instead
 */
export const UNIVERSAL_TOOLS = [
  ...BASE_UNIVERSAL_TOOLS,
  ...CODING_UNIVERSAL_TOOLS
] as const;

/**
 * All native/CLI tools that can be enabled/disabled per job.
 * These are the tools the Gemini CLI expects in its `coreTools` whitelist.
 */
export const NATIVE_TOOLS = [
  'list_directory',
  'read_file',
  'write_file',
  'search_file_content',
  'glob',
  'web_fetch',
  'google_web_search',
  'replace',
  'read_many_files',
  'run_shell_command',
  'save_memory',
  'write_todos',
] as const;

/**
 * Native tools that are always enabled regardless of job configuration
 * These are safe and essential for basic agent operation
 */
export const ALWAYS_ENABLED_NATIVE_TOOLS: readonly (typeof NATIVE_TOOLS[number])[] = [] as const;

/**
 * Chrome DevTools browser automation tools
 * All 26 tools are enabled as a single unit via the 'browser_automation' meta-tool
 * When an agent includes 'browser_automation' in enabledTools, the chrome-devtools MCP server is activated
 */
export const BROWSER_AUTOMATION_TOOLS = [
  // Input automation
  'click', 'drag', 'fill', 'fill_form', 'handle_dialog', 'hover', 'press_key', 'upload_file',
  // Navigation
  'close_page', 'list_pages', 'navigate_page', 'new_page', 'select_page', 'wait_for',
  // Emulation
  'emulate', 'resize_page',
  // Performance
  'performance_analyze_insight', 'performance_start_trace', 'performance_stop_trace',
  // Network
  'get_network_request', 'list_network_requests',
  // Debugging
  'evaluate_script', 'get_console_message', 'list_console_messages', 'take_screenshot', 'take_snapshot',
] as const;

/**
 * Check if browser automation is enabled in the tools list
 */
export function hasBrowserAutomation(enabledTools: string[]): boolean {
  return enabledTools.includes('browser_automation');
}

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
 * Tools that reflection agents should NOT have access to.
 * Reflection agents run without full job context (no requestId, workstreamId),
 * so they must not dispatch jobs which would create orphaned workstreams.
 */
export const REFLECTION_EXCLUDED_TOOLS = [
  'dispatch_new_job',      // Would create jobs without workstream context
  'dispatch_existing_job', // Would dispatch jobs without workstream context
  'google_web_search',     // Not needed for reflection, wastes time/tokens
  'web_fetch',             // Not needed for reflection, wastes time/tokens
] as const;

/**
 * Compute tool policy for a job based on its enabled tools and job type
 * 
 * @param jobEnabledTools - Tools explicitly enabled by the job definition (may be empty)
 * @param options - Configuration options including whether this is a coding job or reflection agent
 * @returns Tool policy result with MCP and CLI configurations
 */
export function computeToolPolicy(
  jobEnabledTools: string[] = [],
  options?: { isCodingJob?: boolean; isReflectionAgent?: boolean }
): ToolPolicyResult {
  // Determine if this is a coding job (default to true for backward compatibility)
  const isCodingJob = options?.isCodingJob !== false;
  const isReflectionAgent = options?.isReflectionAgent === true;

  // Select the appropriate universal tools based on job type
  const baseUniversalTools = isCodingJob
    ? UNIVERSAL_TOOLS
    : BASE_UNIVERSAL_TOOLS;

  // Filter out excluded tools for reflection agents
  const effectiveUniversalTools = isReflectionAgent
    ? baseUniversalTools.filter(t => !REFLECTION_EXCLUDED_TOOLS.includes(t as any))
    : baseUniversalTools;

  // Merge universal tools with job-specific tools, removing duplicates
  const allTools = [...effectiveUniversalTools, ...jobEnabledTools];

  // Expand browser_automation meta-tool to individual tools
  // This ensures chrome-devtools server receives actual tool names in includeTools
  let expandedTools = allTools;
  if (allTools.includes('browser_automation')) {
    expandedTools = [
      ...allTools.filter(t => t !== 'browser_automation'),
      ...BROWSER_AUTOMATION_TOOLS
    ];
  }
  const uniqueTools = [...new Set(expandedTools)];

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

