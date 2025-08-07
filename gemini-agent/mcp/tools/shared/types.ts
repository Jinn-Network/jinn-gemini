import { z } from 'zod';

// Common table names used across multiple tools
export const tableNames = [
  'artifacts',
  'job_board',
  'job_definitions',
  'job_schedules',
  'job_reports',
  'memories',
  'messages',
  'prompt_library',
  'threads',
  'system_state', // Read-only - cannot be modified by agents
] as const;

export const tableNameSchema = z.enum(tableNames);

// Memory-related types
export const linkTypeSchema = z.enum(['CAUSE', 'EFFECT', 'ELABORATION', 'CONTRADICTION', 'SUPPORT']);

export interface Memory {
  id: string;
  content: string;
  embedding: string;
  created_at: string;
  last_accessed_at?: string;
  metadata?: Record<string, any>;
  linked_memory_id?: string;
  link_type?: z.infer<typeof linkTypeSchema>;
  linked_memory?: Memory; // For populated linked memories
}

export type LinkType = z.infer<typeof linkTypeSchema>;

// Type for linked memories query result (partial memory data)
export interface LinkedMemory {
  id: string;
  content: string;
  metadata?: Record<string, any>;
}

// Tool parameter schemas
export const traceThreadParams = z.object({
  thread_id: z.string().uuid().describe('The ID of the thread to trace')
});

export const reconstructJobParams = z.object({
  job_id: z.string().uuid().describe('The ID of the job to reconstruct')
});

export const searchEventsParams = z.object({
  query: z.string().describe('Search query for events'),
  limit: z.number().optional().describe('Maximum number of results to return')
});

export type TraceThreadParams = z.infer<typeof traceThreadParams>;
export type ReconstructJobParams = z.infer<typeof reconstructJobParams>;
export type SearchEventsParams = z.infer<typeof searchEventsParams>; 