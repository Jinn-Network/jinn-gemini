import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKER_MODEL, selectGeminiModelWithPolicy } from 'jinn-node/shared/gemini-models.js';

describe('selectGeminiModelWithPolicy', () => {
  it('falls back from experimental models to policy default', () => {
    const selection = selectGeminiModelWithPolicy(
      'gemini-2.5-pro-exp-v1',
      { defaultModel: 'gemini-3-flash', allowedModels: [] },
      DEFAULT_WORKER_MODEL,
    );

    expect(selection.selected).toBe('gemini-3-flash-preview');
    expect(selection.reason).toBe('policy_fallback');
  });

  it('enforces allowlist and falls back to default', () => {
    const selection = selectGeminiModelWithPolicy(
      'gemini-3-pro-preview',
      { defaultModel: 'gemini-3-flash', allowedModels: ['gemini-3-flash'] },
      DEFAULT_WORKER_MODEL,
    );

    expect(selection.selected).toBe('gemini-3-flash-preview');
    expect(selection.reason).toBe('policy_fallback');
  });

  it('accepts allowed model after normalization', () => {
    const selection = selectGeminiModelWithPolicy(
      'models/gemini-3-flash',
      { defaultModel: 'gemini-3-flash', allowedModels: ['gemini-3-flash'] },
      DEFAULT_WORKER_MODEL,
    );

    expect(selection.selected).toBe('gemini-3-flash-preview');
  });
});
