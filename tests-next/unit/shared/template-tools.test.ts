import { describe, it, expect } from 'vitest';
import { extractToolName, normalizeToolArray } from '../../../gemini-agent/shared/template-tools.js';

describe('extractToolName', () => {
    it('should extract name from string tool', () => {
        expect(extractToolName('blog_create_post')).toBe('blog_create_post');
    });

    it('should extract name from object tool with name property', () => {
        expect(extractToolName({ name: 'blog_create_post', required: true })).toBe('blog_create_post');
    });

    it('should extract name from object tool without required property', () => {
        expect(extractToolName({ name: 'telegram_send_message' })).toBe('telegram_send_message');
    });

    it('should return null for object without name property', () => {
        expect(extractToolName({ required: true })).toBe(null);
    });

    it('should return null for empty string', () => {
        expect(extractToolName('')).toBe(null);
    });

    it('should return null for whitespace-only string', () => {
        expect(extractToolName('   ')).toBe(null);
    });

    it('should return null for null input', () => {
        expect(extractToolName(null)).toBe(null);
    });

    it('should return null for undefined input', () => {
        expect(extractToolName(undefined)).toBe(null);
    });
});

describe('normalizeToolArray', () => {
    it('should handle mixed array of strings and objects', () => {
        const input = [
            'list_tools',
            { name: 'blog_create_post', required: true },
            { name: 'telegram_send_message' },
            'get_details'
        ];

        expect(normalizeToolArray(input)).toEqual([
            'list_tools',
            'blog_create_post',
            'telegram_send_message',
            'get_details'
        ]);
    });

    it('should filter out invalid entries', () => {
        const input = [
            'valid_tool',
            { name: 'another_tool' },
            { required: true }, // no name - should be filtered
            '',                  // empty string - should be filtered
            null,               // null - should be filtered
        ];

        expect(normalizeToolArray(input)).toEqual([
            'valid_tool',
            'another_tool'
        ]);
    });

    it('should filter out [object Object] strings (legacy corruption)', () => {
        const input = [
            'valid_tool',
            '[object Object]', // corrupted entry - should be filtered
            { name: 'another_tool' }
        ];

        expect(normalizeToolArray(input)).toEqual([
            'valid_tool',
            'another_tool'
        ]);
    });

    it('should return empty array for non-array input', () => {
        expect(normalizeToolArray(null)).toEqual([]);
        expect(normalizeToolArray(undefined)).toEqual([]);
        expect(normalizeToolArray('string')).toEqual([]);
    });
});
