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
  'system_state',
] as const;

export const tableNameSchema = z.enum(tableNames); 