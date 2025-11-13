import { describe, it, expect } from 'vitest';
import { computeToolPolicy, UNIVERSAL_TOOLS, NATIVE_TOOLS } from '../../../gemini-agent/toolPolicy.js';
import { REGISTERED_MCP_TOOLS } from '../../../gemini-agent/mcp/server.js';

describe('computeToolPolicy', () => {
  it('exposes universal web tooling to both MCP and CLI whitelists', () => {
    const policy = computeToolPolicy();

    expect(policy.mcpIncludeTools).toContain('web_fetch');
    expect(policy.mcpIncludeTools).toContain('google_web_search');
    expect(policy.cliAllowedTools).toContain('web_fetch');
    expect(policy.cliAllowedTools).toContain('google_web_search');
  });

  it('ensures all MCP tools in UNIVERSAL_TOOLS are actually registered in the MCP server', () => {
    // Filter UNIVERSAL_TOOLS to get only MCP tools (exclude native tools)
    const nativeToolSet = new Set(NATIVE_TOOLS);
    const universalMcpTools = UNIVERSAL_TOOLS.filter(tool => !nativeToolSet.has(tool));
    
    // Check that every MCP tool in UNIVERSAL_TOOLS is registered
    const registeredToolSet = new Set(REGISTERED_MCP_TOOLS);
    const missingTools = universalMcpTools.filter(tool => !registeredToolSet.has(tool));
    
    expect(missingTools).toEqual([]);
  });
});


