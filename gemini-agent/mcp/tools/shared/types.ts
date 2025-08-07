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

// Trace thread types
export const traceThreadParams = z.object({
  thread_id: z.string().uuid().describe('The ID of the thread to trace.'),
});

export type TraceThreadParams = z.infer<typeof traceThreadParams>;

// Reconstruct job types
export const reconstructJobParams = z.object({
  job_id: z.string().uuid().describe('The ID of the job to reconstruct.'),
});
export type ReconstructJobParams = z.infer<typeof reconstructJobParams>;

// Search events types
export const searchEventsParams = z.object({
  event_type: z.enum(['ARTIFACT_CREATED', 'JOB_CREATED', 'THREAD_CREATED']).optional().describe('Filter by specific event type.'),
  status: z.string().optional().describe('Filter by status (e.g., COMPLETED, PENDING).'),
  job_name: z.string().optional().describe('Filter by job name pattern.'),
  topic: z.string().optional().describe('Filter by artifact topic pattern.'),
  thread_id: z.string().uuid().optional().describe('Filter by specific thread ID.'),
  time_range_hours: z.number().int().min(1).max(168).optional().describe('Limit results to events within the last X hours (max 168 = 1 week).'),
});
export type SearchEventsParams = z.infer<typeof searchEventsParams>; 