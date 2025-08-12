import { z } from 'zod';

// Common table names used across multiple tools
export const tableNames = [
  'artifacts',
  'job_board',
  'jobs',
  'job_reports',
  'memories',
  'messages',
  'threads',
  'system_state', // Read-only - cannot be modified by agents
  'project_definitions',
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

export type TraceThreadParams = z.infer<typeof traceThreadParams>;

export type ReconstructJobParams = z.infer<typeof reconstructJobParams>;

// Search events types
export const searchEventsParams = z.object({
  event_type: z.enum(['ARTIFACT_CREATED', 'JOB_CREATED', 'THREAD_CREATED']).optional().describe('Filter by specific event type.'),
  status: z.string().optional().describe('Filter by status (e.g., COMPLETED, PENDING).'),
  job_name: z.string().optional().describe('Filter by job name pattern.'),
  topic: z.string().optional().describe('Filter by artifact topic pattern.'),
  thread_id: z.string().uuid().optional().describe('Filter by specific thread ID.'),
  time_range_hours: z.number().int().min(1).optional().describe('Limit results to events within the last X hours.'),
  cursor: z.string().optional().describe('Opaque cursor for fetching the next page of results.'),
});
export type SearchEventsParams = z.infer<typeof searchEventsParams>;

// Job-related types for the unified jobs table
export interface ScheduleFilters {
  [key: string]: string | number | boolean | string[];
}

export interface ScheduleConfig {
  trigger: 'on_new_artifact' | 'on_job_status_change' | 'on_new_thread' | 'cron' | 'manual';
  filters: ScheduleFilters;
  cron_pattern?: string;
}

export interface Job {
  id: string; // UUID of this specific version
  job_id: string; // Shared UUID across all versions
  version: number;
  name: string;
  description?: string;
  prompt_content: string;
  enabled_tools: string[];
  schedule_config: ScheduleConfig;
  is_active: boolean;
  created_at: string; // ISO 8601 Date
  updated_at: string; // ISO 8601 Date
}

// Zod schemas for job creation
export const ScheduleConfigSchema = z.object({
  trigger: z.enum(['on_new_artifact', 'on_job_status_change', 'on_new_thread', 'cron', 'manual']),
  filters: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  cron_pattern: z.string().optional(),
});

export const CreateJobInputSchema = z.object({
  name: z.string().describe('The name of the job'),
  description: z.string().optional().describe('Optional description of the job purpose'),
  prompt_content: z.string().describe('The full prompt content for this job'),
  enabled_tools: z.array(z.string()).describe('Array of tool names this job can use'),
  schedule_config: ScheduleConfigSchema.describe('Schedule and trigger configuration'),
  // To create a new version of an existing job, provide this ID.
  // If omitted, a new job (and job_id) will be created.
  existing_job_id: z.string().uuid().optional().describe('UUID of existing job to create new version for'),
});

export type CreateJobInput = z.infer<typeof CreateJobInputSchema>; 
