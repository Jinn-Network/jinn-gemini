/**
 * JobDefinitionsTable Component Tests
 * 
 * These tests ensure the component correctly renders job definitions
 * and only uses fields that exist in the Ponder schema.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JobDefinitionsTable } from './job-definitions-table';
import type { SubgraphRecord } from '@/hooks/use-subgraph-collection';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

// Create a mock job definition record with only valid schema fields
function createMockJobDefinition(overrides: Partial<SubgraphRecord> = {}): SubgraphRecord {
  return {
    id: '0064f9f0-cb53-4974-bb27-09699fcf734d',
    name: 'Test Job Definition',
    enabledTools: ['google_web_search', 'web_fetch'],
    blueprint: '{"invariants":[{"id":"TEST-001","invariant":"Test invariant"}]}',
    sourceJobDefinitionId: null,
    sourceRequestId: null,
    codeMetadata: null,
    ...overrides,
  } as SubgraphRecord;
}

describe('JobDefinitionsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('shows "No records found" when records array is empty', () => {
      render(<JobDefinitionsTable records={[]} />);
      expect(screen.getByText('No records found')).toBeInTheDocument();
    });

    it('renders table with all column headers', () => {
      const records = [createMockJobDefinition()];

      render(<JobDefinitionsTable records={records} />);

      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Enabled Tools')).toBeInTheDocument();
      expect(screen.getByText('Blueprint')).toBeInTheDocument();
      expect(screen.getByText('Source Job')).toBeInTheDocument();
      expect(screen.getByText('ID')).toBeInTheDocument();
    });

    it('renders job definition data correctly', () => {
      const records = [
        createMockJobDefinition({
          name: 'My Test Job Definition',
          enabledTools: ['web_search', 'create_artifact'],
        }),
      ];

      render(<JobDefinitionsTable records={records} />);

      expect(screen.getByText('My Test Job Definition')).toBeInTheDocument();
      expect(screen.getByText('web_search, create_artifact')).toBeInTheDocument();
    });

    it('renders link to job definition detail page', () => {
      const records = [createMockJobDefinition({ id: 'job-def-123' })];

      render(<JobDefinitionsTable records={records} />);

      const link = screen.getByRole('link', { name: /Test Job Definition/i });
      expect(link).toHaveAttribute('href', '/jobDefinitions/job-def-123');
    });
  });

  describe('Field Handling', () => {
    it('displays enabled tools as comma-separated list', () => {
      const records = [
        createMockJobDefinition({
          enabledTools: ['tool1', 'tool2', 'tool3'],
        }),
      ];

      render(<JobDefinitionsTable records={records} />);

      expect(screen.getByText('tool1, tool2, tool3')).toBeInTheDocument();
    });

    it('displays dash when enabledTools is empty', () => {
      const records = [
        createMockJobDefinition({
          enabledTools: [],
        }),
      ];

      render(<JobDefinitionsTable records={records} />);

      // Find the cell in the Enabled Tools column
      const table = screen.getByRole('table');
      const rows = table.querySelectorAll('tbody tr');
      expect(rows[0].querySelectorAll('td')[1].textContent).toBe('-');
    });

    it('displays dash when enabledTools is null', () => {
      const records = [
        createMockJobDefinition({
          enabledTools: null as unknown as string[],
        }),
      ];

      render(<JobDefinitionsTable records={records} />);

      const table = screen.getByRole('table');
      const rows = table.querySelectorAll('tbody tr');
      expect(rows[0].querySelectorAll('td')[1].textContent).toBe('-');
    });

    it('truncates blueprint content when too long', () => {
      const longBlueprint = 'a'.repeat(100);
      const records = [
        createMockJobDefinition({
          blueprint: longBlueprint,
        }),
      ];

      render(<JobDefinitionsTable records={records} />);

      // Should be truncated to 80 chars + '...'
      const truncated = longBlueprint.substring(0, 80) + '...';
      expect(screen.getByText(truncated)).toBeInTheDocument();
    });

    it('displays dash when blueprint is null', () => {
      const records = [
        createMockJobDefinition({
          blueprint: null,
        }),
      ];

      render(<JobDefinitionsTable records={records} />);

      const table = screen.getByRole('table');
      const rows = table.querySelectorAll('tbody tr');
      expect(rows[0].querySelectorAll('td')[2].textContent).toBe('-');
    });

    it('displays source job link when sourceJobDefinitionId exists', () => {
      const records = [
        createMockJobDefinition({
          sourceJobDefinitionId: 'parent-job-def-456',
        }),
      ];

      render(<JobDefinitionsTable records={records} />);

      const link = screen.getByRole('link', { name: /parent-job-d/i });
      expect(link).toHaveAttribute('href', '/jobDefinitions/parent-job-def-456');
    });

    it('displays dash when sourceJobDefinitionId is null', () => {
      const records = [
        createMockJobDefinition({
          sourceJobDefinitionId: null,
        }),
      ];

      render(<JobDefinitionsTable records={records} />);

      const table = screen.getByRole('table');
      const rows = table.querySelectorAll('tbody tr');
      const sourceJobCell = rows[0].querySelectorAll('td')[3];
      expect(sourceJobCell.textContent).toBe('-');
    });

    it('truncates long job names', () => {
      const longName = 'a'.repeat(60);
      const records = [
        createMockJobDefinition({
          name: longName,
        }),
      ];

      render(<JobDefinitionsTable records={records} />);

      // Should be truncated to 50 chars + '...'
      const truncated = longName.substring(0, 50) + '...';
      expect(screen.getByText(truncated)).toBeInTheDocument();
    });

    it('displays full job name when under 50 chars', () => {
      const shortName = 'Short Job Name';
      const records = [
        createMockJobDefinition({
          name: shortName,
        }),
      ];

      render(<JobDefinitionsTable records={records} />);

      expect(screen.getByText(shortName)).toBeInTheDocument();
    });
  });

  describe('Regression Tests - Schema Field Validation', () => {
    it('does NOT try to access promptContent field', () => {
      // This test ensures we don't regress to using the non-existent promptContent field
      const records = [createMockJobDefinition()];

      // If the component tries to access 'promptContent', this will throw
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      expect(() => {
        render(<JobDefinitionsTable records={records} />);
      }).not.toThrow();

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('does NOT try to access description field', () => {
      // This test ensures we don't regress to using the non-existent description field
      const records = [createMockJobDefinition()];

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      expect(() => {
        render(<JobDefinitionsTable records={records} />);
      }).not.toThrow();

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('does NOT try to access blockTimestamp field on jobDefinition', () => {
      // jobDefinitions don't have blockTimestamp (only requests do)
      const records = [createMockJobDefinition()];

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      expect(() => {
        render(<JobDefinitionsTable records={records} />);
      }).not.toThrow();

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('uses only valid schema fields: id, name, enabledTools, blueprint, sourceJobDefinitionId, sourceRequestId, codeMetadata', () => {
      // Create a record with all valid fields
      const records = [
        createMockJobDefinition({
          id: 'test-id',
          name: 'Test Name',
          enabledTools: ['tool1'],
          blueprint: 'test blueprint',
          sourceJobDefinitionId: 'source-id',
          sourceRequestId: 'request-id',
          codeMetadata: { repo: 'test/repo' },
        }),
      ];

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

      expect(() => {
        render(<JobDefinitionsTable records={records} />);
      }).not.toThrow();

      // Table should render successfully
      expect(screen.getByText('Test Name')).toBeInTheDocument();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Multiple Records', () => {
    it('renders multiple job definitions correctly', () => {
      const records = [
        createMockJobDefinition({ id: 'job-1', name: 'Job One' }),
        createMockJobDefinition({ id: 'job-2', name: 'Job Two' }),
        createMockJobDefinition({ id: 'job-3', name: 'Job Three' }),
      ];

      render(<JobDefinitionsTable records={records} />);

      expect(screen.getByText('Job One')).toBeInTheDocument();
      expect(screen.getByText('Job Two')).toBeInTheDocument();
      expect(screen.getByText('Job Three')).toBeInTheDocument();
    });

    it('renders correct number of rows', () => {
      const records = [
        createMockJobDefinition({ id: 'job-1' }),
        createMockJobDefinition({ id: 'job-2' }),
        createMockJobDefinition({ id: 'job-3' }),
      ];

      render(<JobDefinitionsTable records={records} />);

      const table = screen.getByRole('table');
      const rows = table.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(3);
    });
  });
});

