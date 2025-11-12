import { describe, it, expect } from 'vitest';
import { computeToolPolicy } from '../../../gemini-agent/toolPolicy.js';

describe('computeToolPolicy', () => {
  it('exposes universal web tooling to both MCP and CLI whitelists', () => {
    const policy = computeToolPolicy();

    expect(policy.mcpIncludeTools).toContain('web_fetch');
    expect(policy.mcpIncludeTools).toContain('google_web_search');
    expect(policy.cliAllowedTools).toContain('web_fetch');
    expect(policy.cliAllowedTools).toContain('google_web_search');
  });
});

