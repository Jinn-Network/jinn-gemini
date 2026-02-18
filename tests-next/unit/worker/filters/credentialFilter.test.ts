/**
 * Unit Test: Credential-Based Job Filtering
 * Module: worker/filters/credentialFilter.ts
 *
 * Tests tool-to-credential mapping, job eligibility checking,
 * credential requirement resolution, and bridge-probed capability discovery.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('jinn-node/logging/index.js', () => ({
  workerLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('jinn-node/env/operate-profile.js', () => ({
  getServicePrivateKey: vi.fn(() => '0x' + 'ab'.repeat(32)),
}));

import {
  TOOL_CREDENTIAL_MAP,
  getRequiredCredentials,
  isJobEligibleForWorker,
  jobRequiresCredentials,
  probeCredentialBridge,
  getWorkerCredentialInfo,
  _resetCredentialInfoCache,
} from 'jinn-node/worker/filters/credentialFilter.js';

describe('credentialFilter', () => {
  afterEach(() => {
    _resetCredentialInfoCache();
    delete process.env.X402_GATEWAY_URL;
    vi.restoreAllMocks();
  });

  describe('TOOL_CREDENTIAL_MAP', () => {
    it('maps telegram tools to telegram provider', () => {
      expect(TOOL_CREDENTIAL_MAP['telegram_send_message']).toEqual(['telegram']);
      expect(TOOL_CREDENTIAL_MAP['telegram_send_photo']).toEqual(['telegram']);
      expect(TOOL_CREDENTIAL_MAP['telegram_send_document']).toEqual(['telegram']);
    });

    it('github tools are operator-level (not in credential map)', () => {
      expect(TOOL_CREDENTIAL_MAP['get_file_contents']).toBeUndefined();
      expect(TOOL_CREDENTIAL_MAP['search_code']).toBeUndefined();
      expect(TOOL_CREDENTIAL_MAP['list_commits']).toBeUndefined();
    });

    it('maps meta-tools', () => {
      expect(TOOL_CREDENTIAL_MAP['telegram_messaging']).toEqual(['telegram']);
      expect(TOOL_CREDENTIAL_MAP['fireflies_meetings']).toEqual(['fireflies']);
      expect(TOOL_CREDENTIAL_MAP['railway_deployment']).toEqual(['railway']);
    });

    it('maps OpenAI-backed tools', () => {
      expect(TOOL_CREDENTIAL_MAP['embed_text']).toEqual(['openai']);
      expect(TOOL_CREDENTIAL_MAP['search_similar_situations']).toEqual(['openai']);
    });

    it('does not include credential-free tools', () => {
      expect(TOOL_CREDENTIAL_MAP['dispatch_new_job']).toBeUndefined();
      expect(TOOL_CREDENTIAL_MAP['create_artifact']).toBeUndefined();
      expect(TOOL_CREDENTIAL_MAP['blog_create_post']).toBeUndefined();
    });
  });

  describe('getRequiredCredentials', () => {
    it('returns empty array for credential-free tools', () => {
      expect(getRequiredCredentials(['dispatch_new_job', 'create_artifact'])).toEqual([]);
    });

    it('returns single provider for single tool', () => {
      expect(getRequiredCredentials(['telegram_send_message'])).toEqual(['telegram']);
    });

    it('deduplicates providers from multiple tools of same type', () => {
      const result = getRequiredCredentials(['telegram_send_message', 'telegram_send_photo']);
      expect(result).toEqual(['telegram']);
    });

    it('returns multiple providers for tools requiring different credentials', () => {
      const result = getRequiredCredentials(['telegram_send_message', 'embed_text']);
      expect(result).toContain('telegram');
      expect(result).toContain('openai');
      expect(result).toHaveLength(2);
    });

    it('handles mixed credential and non-credential tools', () => {
      const result = getRequiredCredentials(['dispatch_new_job', 'telegram_send_message', 'create_artifact']);
      expect(result).toEqual(['telegram']);
    });

    it('returns empty for empty input', () => {
      expect(getRequiredCredentials([])).toEqual([]);
    });

    it('handles unknown tool names gracefully', () => {
      expect(getRequiredCredentials(['nonexistent_tool'])).toEqual([]);
    });
  });

  describe('isJobEligibleForWorker', () => {
    it('returns true when worker has all required credentials', () => {
      expect(isJobEligibleForWorker(
        ['telegram_send_message'],
        new Set(['telegram']),
      )).toBe(true);
    });

    it('returns false when worker lacks required credentials', () => {
      expect(isJobEligibleForWorker(
        ['telegram_send_message'],
        new Set(),
      )).toBe(false);
    });

    it('returns false when worker has some but not all required credentials', () => {
      expect(isJobEligibleForWorker(
        ['embed_text', 'telegram_send_message'],
        new Set(['openai']),
      )).toBe(false);
    });

    it('returns true when job needs no credentials', () => {
      expect(isJobEligibleForWorker(
        ['dispatch_new_job', 'create_artifact'],
        new Set(),
      )).toBe(true);
    });

    it('returns true for undefined enabledTools', () => {
      expect(isJobEligibleForWorker(undefined, new Set())).toBe(true);
    });

    it('returns true for empty enabledTools', () => {
      expect(isJobEligibleForWorker([], new Set())).toBe(true);
    });
  });

  describe('jobRequiresCredentials', () => {
    it('returns true for credential-requiring tools', () => {
      expect(jobRequiresCredentials(['telegram_send_message'])).toBe(true);
    });

    it('returns false for credential-free tools', () => {
      expect(jobRequiresCredentials(['dispatch_new_job'])).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(jobRequiresCredentials(undefined)).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(jobRequiresCredentials([])).toBe(false);
    });
  });

  describe('probeCredentialBridge', () => {
    it('returns empty when X402_GATEWAY_URL is not set', async () => {
      const result = await probeCredentialBridge();
      expect(result.isTrusted).toBe(false);
      expect(result.providers.size).toBe(0);
    });

    it('returns providers from bridge on success', async () => {
      process.env.X402_GATEWAY_URL = 'http://localhost:3001';
      const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ providers: ['github', 'telegram'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await probeCredentialBridge();
      expect(result.isTrusted).toBe(true);
      expect(result.providers).toEqual(new Set(['github', 'telegram']));
      expect(mockFetch).toHaveBeenCalledOnce();

      const callArg = mockFetch.mock.calls[0][0];
      const callUrl = typeof callArg === 'string' ? callArg : (callArg as Request).url;
      expect(callUrl).toBe('http://localhost:3001/credentials/capabilities');
    });

    it('returns empty when bridge returns non-200', async () => {
      process.env.X402_GATEWAY_URL = 'http://localhost:3001';
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Unauthorized', { status: 401 }),
      );

      const result = await probeCredentialBridge();
      expect(result.isTrusted).toBe(false);
      expect(result.providers.size).toBe(0);
    });

    it('returns empty when fetch throws (network error)', async () => {
      process.env.X402_GATEWAY_URL = 'http://localhost:3001';
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await probeCredentialBridge();
      expect(result.isTrusted).toBe(false);
      expect(result.providers.size).toBe(0);
    });

    it('returns empty providers as not trusted', async () => {
      process.env.X402_GATEWAY_URL = 'http://localhost:3001';
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ providers: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await probeCredentialBridge();
      expect(result.isTrusted).toBe(false);
      expect(result.providers.size).toBe(0);
    });

    it('strips trailing slash from bridge URL', async () => {
      process.env.X402_GATEWAY_URL = 'http://localhost:3001/';
      const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ providers: ['github'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await probeCredentialBridge();
      const callArg = mockFetch.mock.calls[0][0];
      const callUrl = typeof callArg === 'string' ? callArg : (callArg as Request).url;
      expect(callUrl).toBe('http://localhost:3001/credentials/capabilities');
    });
  });

  describe('getWorkerCredentialInfo (async caching)', () => {
    it('caches result across calls', async () => {
      process.env.X402_GATEWAY_URL = 'http://localhost:3001';
      const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ providers: ['github'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const first = await getWorkerCredentialInfo();
      const second = await getWorkerCredentialInfo();

      // Should be the same cached value, only one fetch call
      expect(first).toBe(second);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('resets with _resetCredentialInfoCache', async () => {
      process.env.X402_GATEWAY_URL = 'http://localhost:3001';
      const mockFetch = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ providers: ['github'] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ providers: ['github', 'telegram'] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const first = await getWorkerCredentialInfo();
      expect(first.providers.size).toBe(1);

      _resetCredentialInfoCache();
      const second = await getWorkerCredentialInfo();
      expect(second.providers.size).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
