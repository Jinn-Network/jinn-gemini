import { describe, it, expect } from 'vitest';
import { extractSchemaEnvVars } from 'jinn-node/shared/job-env.js';

describe('extractSchemaEnvVars', () => {
  it('extracts env vars from schema properties with envVar + matching input', () => {
    const schema = {
      properties: {
        websiteId: { type: 'string', envVar: 'JINN_JOB_WEBSITE_ID' },
        apiKey: { type: 'string', envVar: 'JINN_JOB_API_KEY' },
      },
    };
    const input = { websiteId: 'site-123', apiKey: 'key-abc' };

    const result = extractSchemaEnvVars(schema, input, 'test');

    expect(result).toEqual({
      JINN_JOB_WEBSITE_ID: 'site-123',
      JINN_JOB_API_KEY: 'key-abc',
    });
  });

  it('returns undefined when no envVar fields exist in schema', () => {
    const schema = {
      properties: {
        name: { type: 'string' },
        count: { type: 'number', default: 5 },
      },
    };
    const input = { name: 'test', count: 10 };

    expect(extractSchemaEnvVars(schema, input, 'test')).toBeUndefined();
  });

  it('returns undefined when schema has no properties', () => {
    expect(extractSchemaEnvVars({}, { foo: 'bar' }, 'test')).toBeUndefined();
    expect(extractSchemaEnvVars({ type: 'object' }, { foo: 'bar' }, 'test')).toBeUndefined();
  });

  it('skips envVar fields when input value is missing', () => {
    const schema = {
      properties: {
        websiteId: { type: 'string', envVar: 'JINN_JOB_WEBSITE_ID' },
        apiKey: { type: 'string', envVar: 'JINN_JOB_API_KEY' },
      },
    };
    const input = { websiteId: 'site-123' }; // apiKey not provided

    const result = extractSchemaEnvVars(schema, input, 'test');

    expect(result).toEqual({ JINN_JOB_WEBSITE_ID: 'site-123' });
  });

  it('returns undefined when all envVar fields lack input values', () => {
    const schema = {
      properties: {
        websiteId: { type: 'string', envVar: 'JINN_JOB_WEBSITE_ID' },
      },
    };
    const input = {}; // no matching input

    expect(extractSchemaEnvVars(schema, input, 'test')).toBeUndefined();
  });

  it('coerces non-string input values via String()', () => {
    const schema = {
      properties: {
        count: { type: 'number', envVar: 'JINN_JOB_COUNT' },
        enabled: { type: 'boolean', envVar: 'JINN_JOB_ENABLED' },
      },
    };
    const input = { count: 42, enabled: true };

    const result = extractSchemaEnvVars(schema, input, 'test');

    expect(result).toEqual({
      JINN_JOB_COUNT: '42',
      JINN_JOB_ENABLED: 'true',
    });
  });

  it('throws on invalid non-JINN_JOB_ env key', () => {
    const schema = {
      properties: {
        secret: { type: 'string', envVar: 'SECRET_KEY' },
      },
    };
    const input = { secret: 'val' };

    expect(() => extractSchemaEnvVars(schema, input, 'test')).toThrow(
      /invalid env key "SECRET_KEY"/
    );
  });

  it('mergedEnv: explicit env overrides schema-extracted values', () => {
    const schema = {
      properties: {
        websiteId: { type: 'string', envVar: 'JINN_JOB_WEBSITE_ID' },
      },
    };
    const input = { websiteId: 'from-schema', env: { JINN_JOB_WEBSITE_ID: 'explicit-override' } };

    const extractedEnv = extractSchemaEnvVars(schema, input, 'test');
    // Simulate the merge logic from ventureDispatch.ts
    const mergedEnv = { ...extractedEnv, ...(input.env || {}) };

    expect(mergedEnv).toEqual({ JINN_JOB_WEBSITE_ID: 'explicit-override' });
  });
});
