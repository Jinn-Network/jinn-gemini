/**
 * Unit tests for gemini-agent/mcp/tools/register_template.ts
 *
 * Tests template registration MCP tool - registers ventures as templates in Ponder.
 *
 * Priority: P1 (High Priority)
 * Business Impact: Agent Functionality - Template Marketplace
 * Coverage Target: 100% of registration logic
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registerTemplate } from '../../../../../gemini-agent/mcp/tools/register_template.js';

// Mock Supabase client
vi.mock('../../../../../gemini-agent/mcp/tools/shared/supabase.js', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

// Mock env loader
vi.mock('../../../../../gemini-agent/mcp/tools/shared/env.js', () => ({
    loadEnvOnce: vi.fn(),
}));

import { supabase } from '../../../../../gemini-agent/mcp/tools/shared/supabase.js';

describe('registerTemplate', () => {
    let mockFrom: any;
    let mockSelect: any;
    let mockEq: any;
    let mockSingle: any;
    let mockInsert: any;
    let mockUpdate: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup mock chain for SELECT
        mockSingle = vi.fn();
        mockEq = vi.fn().mockReturnValue({ single: mockSingle });
        mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

        // Setup mock chain for INSERT
        mockInsert = vi.fn().mockResolvedValue({ error: null });

        // Setup mock chain for UPDATE
        mockUpdate = vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
        });

        mockFrom = vi.fn().mockReturnValue({
            select: mockSelect,
            insert: mockInsert,
            update: mockUpdate,
        });

        (supabase.from as any) = mockFrom;
    });

    describe('validation', () => {
        it('validates required name field', async () => {
            const args = {
                description: 'A test template',
                blueprintCid: 'QmTest123',
                priceWei: '1000000000000000',
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(false);
            expect(response.meta.code).toBe('VALIDATION_ERROR');
            expect(response.meta.message).toContain('name');
        });

        it('validates required description field', async () => {
            const args = {
                name: 'Test Template',
                blueprintCid: 'QmTest123',
                priceWei: '1000000000000000',
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(false);
            expect(response.meta.code).toBe('VALIDATION_ERROR');
            expect(response.meta.message).toContain('description');
        });

        it('validates required blueprintCid field', async () => {
            const args = {
                name: 'Test Template',
                description: 'A test template for validation',
                priceWei: '1000000000000000',
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(false);
            expect(response.meta.code).toBe('VALIDATION_ERROR');
            expect(response.meta.message).toContain('blueprintCid');
        });

        it('validates required priceWei field', async () => {
            const args = {
                name: 'Test Template',
                description: 'A test template for validation',
                blueprintCid: 'QmTest123',
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(false);
            expect(response.meta.code).toBe('VALIDATION_ERROR');
            expect(response.meta.message).toContain('priceWei');
        });

        it('validates description minimum length (10 chars)', async () => {
            const args = {
                name: 'Test',
                description: 'Short', // Less than 10 chars
                blueprintCid: 'QmTest123',
                priceWei: '1000000000000000',
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(false);
            expect(response.meta.code).toBe('VALIDATION_ERROR');
        });

        it('validates status enum values', async () => {
            const args = {
                name: 'Test Template',
                description: 'A test template for validation',
                blueprintCid: 'QmTest123',
                priceWei: '1000000000000000',
                status: 'invalid' as any,
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(false);
            expect(response.meta.code).toBe('VALIDATION_ERROR');
        });
    });

    describe('template ID generation', () => {
        it('generates slug ID from template name', async () => {
            mockSingle.mockResolvedValue({ data: null, error: null });
            mockInsert.mockResolvedValue({ error: null });

            const args = {
                name: 'My Awesome Template',
                description: 'A really awesome template for testing',
                blueprintCid: 'QmTest123',
                priceWei: '1000000000000000',
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(true);
            expect(response.data.templateId).toMatch(/^my-awesome-template-/);
        });

        it('handles special characters in template name', async () => {
            mockSingle.mockResolvedValue({ data: null, error: null });
            mockInsert.mockResolvedValue({ error: null });

            const args = {
                name: 'Template (v2) - Special & Cool!',
                description: 'A special template with weird characters',
                blueprintCid: 'QmTest123',
                priceWei: '1000000000000000',
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(true);
            // Should be slugified
            expect(response.data.templateId).toMatch(/^template-v2-special-cool-/);
        });
    });

    describe('successful template creation', () => {
        it('creates new template when not exists', async () => {
            mockSingle.mockResolvedValue({ data: null, error: null });
            mockInsert.mockResolvedValue({ error: null });

            const args = {
                name: 'New Venture',
                description: 'A brand new venture template',
                blueprintCid: 'QmNewVenture123',
                priceWei: '5000000000000000',
                tags: ['defi', 'trading'],
                enabledTools: ['web_search', 'create_artifact'],
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(true);
            expect(response.data.action).toBe('created');
            expect(response.data.status).toBe('hidden');
            expect(response.data.templateId).toBeDefined();
            expect(response.data.marketplaceUrl).toContain('x402.jinn.network/templates/');
            expect(response.data.note).toContain('requires approval');
        });

        it('defaults status to hidden', async () => {
            mockSingle.mockResolvedValue({ data: null, error: null });
            mockInsert.mockResolvedValue({ error: null });

            const args = {
                name: 'Hidden Template',
                description: 'This should be hidden by default',
                blueprintCid: 'QmHidden123',
                priceWei: '1000000000000000',
                // No status provided
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(true);
            expect(response.data.status).toBe('hidden');
        });

        it('allows explicit visible status', async () => {
            mockSingle.mockResolvedValue({ data: null, error: null });
            mockInsert.mockResolvedValue({ error: null });

            const args = {
                name: 'Visible Template',
                description: 'This template should be visible',
                blueprintCid: 'QmVisible123',
                priceWei: '1000000000000000',
                status: 'visible' as const,
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(true);
            expect(response.data.status).toBe('visible');
        });
    });

    describe('template update', () => {
        it('updates existing template preserving visible status', async () => {
            // Template already exists and is visible
            mockSingle.mockResolvedValue({
                data: { id: 'existing-template-abc123', status: 'visible' },
                error: null
            });

            const args = {
                name: 'Existing Template',
                description: 'Updated description for existing template',
                blueprintCid: 'QmUpdated123',
                priceWei: '2000000000000000',
                status: 'hidden' as const, // Trying to set hidden
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(true);
            expect(response.data.action).toBe('updated');
            // Should preserve visible status
            expect(response.data.status).toBe('visible');
        });
    });

    describe('error handling', () => {
        it('handles database insert failure', async () => {
            mockSingle.mockResolvedValue({ data: null, error: null });
            mockInsert.mockResolvedValue({ error: { message: 'Database connection failed' } });

            const args = {
                name: 'Failing Template',
                description: 'This template will fail to insert',
                blueprintCid: 'QmFail123',
                priceWei: '1000000000000000',
            };

            const result = await registerTemplate(args);
            const response = JSON.parse(result.content[0].text);

            expect(response.meta.ok).toBe(false);
            expect(response.meta.code).toBe('EXECUTION_ERROR');
            expect(response.meta.message).toContain('Database connection failed');
        });
    });

    describe('MCP response format', () => {
        it('returns proper MCP content array format', async () => {
            mockSingle.mockResolvedValue({ data: null, error: null });
            mockInsert.mockResolvedValue({ error: null });

            const args = {
                name: 'Format Test',
                description: 'Testing MCP response format',
                blueprintCid: 'QmFormat123',
                priceWei: '1000000000000000',
            };

            const result = await registerTemplate(args);

            expect(result).toHaveProperty('content');
            expect(Array.isArray(result.content)).toBe(true);
            expect(result.content).toHaveLength(1);
            expect(result.content[0].type).toBe('text');
            expect(typeof result.content[0].text).toBe('string');
        });

        it('returns valid JSON in response text', async () => {
            mockSingle.mockResolvedValue({ data: null, error: null });
            mockInsert.mockResolvedValue({ error: null });

            const args = {
                name: 'JSON Test',
                description: 'Testing JSON response format',
                blueprintCid: 'QmJson123',
                priceWei: '1000000000000000',
            };

            const result = await registerTemplate(args);

            // Should not throw
            const parsed = JSON.parse(result.content[0].text);

            expect(parsed).toHaveProperty('data');
            expect(parsed).toHaveProperty('meta');
        });
    });
});
