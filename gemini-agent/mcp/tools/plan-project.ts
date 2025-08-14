import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { randomUUID } from 'crypto';

const JobDefinitionForProjectSchema = z.object({
  name: z.string().describe('The name of the job.'),
  description: z.string().optional().describe('A brief description of the job\'s purpose.'),
  prompt_content: z.string().describe('The full prompt content for this job.'),
  enabled_tools: z.array(z.string()).describe('Array of tool names this job can use.')
});

// Input schema (flattened)
export const planProjectParams = z.object({
  name: z.string().min(1).describe('Canonical project name (stable, human-readable).'),
  objective: z.string().optional().describe('Concise mission/objective for the project run family.'),
  strategy: z.string().optional().describe('High-level approach/plan. Free-form text; can include bullet points.'),
  kpis: z
    .record(z.any())
    .optional()
    .describe(
      'KPIs for measuring success. Suggested shape: { "north_star"?: string, "metrics"?: [ { name: string, target?: number|string, unit?: string, direction?: "up"|"down", cadence?: "daily"|"weekly"|"monthly" } ], "notes"?: string }. Free-form JSON allowed.'
    ),
  jobs: z.array(JobDefinitionForProjectSchema).optional().describe('An array of initial jobs to bootstrap the project. The first job is the lead; others run after it completes.')
});

export const planProjectSchema = {
  description: 'Create or reuse a project_definition, instantiate a project_run, and optionally bootstrap it with an initial set of jobs. The first job in the `jobs` array is the lead; all subsequent jobs are scheduled to run after the lead job completes.',
  inputSchema: planProjectParams.shape,
};

export async function planProject(params: z.infer<typeof planProjectParams>) {
  const parsed = planProjectParams.safeParse(params ?? {});
  if (!parsed.success) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message } })
      }]
    };
  }

  const { name, objective, strategy, kpis, jobs } = parsed.data;
  try {
    // Resolve owner_job_definition_id automatically from current job context
    const { jobId, jobName, jobDefinitionId } = getCurrentJobContext();
    if (!jobId && !jobName) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'NO_JOB_CONTEXT', message: 'Job context not available to infer owner_job_definition_id' } }) }]
      };
    }

    // Primary: look up the job_definition_id from job_board using the current job run id
    let ownerJobDefinitionId: string | null = null;
    if (jobId) {
      const { data: jb, error: jbErr } = await supabase
        .from('job_board')
        .select('job_definition_id')
        .eq('id', jobId)
        .maybeSingle();
      if (jbErr) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error checking job board: ${jbErr.message}` } }) }]
        };
      }
      if (jb && (jb as any).job_definition_id) ownerJobDefinitionId = (jb as any).job_definition_id as string;
    }

    // Fallback: use jobDefinitionId from context if available
    if (!ownerJobDefinitionId && jobDefinitionId) {
      ownerJobDefinitionId = jobDefinitionId;
    }

    // Fallback: resolve by job name to latest active version
    if (!ownerJobDefinitionId && jobName) {
      const { data: jobDef, error: jErr } = await supabase
        .from('jobs')
        .select('id, version')
        .eq('name', jobName)
        .eq('is_active', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (jErr) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error checking jobs: ${jErr.message}` } }) }]
        };
      }
      if (jobDef && (jobDef as any).id) ownerJobDefinitionId = (jobDef as any).id as string;
    }

    if (!ownerJobDefinitionId) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'OWNER_JOB_DEFINITION_RESOLUTION_FAILED', message: 'Could not resolve owner_job_definition_id from job context' } }) }]
      };
    }

    // Resolve parent_project_definition_id from current job's project context
    let parentProjectDefinitionId: string | null = null;
    if (jobId) {
      const { data: jb, error: jbErr } = await supabase
        .from('job_board')
        .select('project_definition_id')
        .eq('id', jobId)
        .maybeSingle();
      if (jbErr) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error checking job board project: ${jbErr.message}` } }) }]
        };
      }
      if (jb && (jb as any).project_definition_id) parentProjectDefinitionId = (jb as any).project_definition_id as string;
    }

    // Guardrail: Prevent recursive project delegation
    if (parentProjectDefinitionId) {
      const { data: parentProject, error: parentErr } = await supabase
        .from('project_definitions')
        .select('name')
        .eq('id', parentProjectDefinitionId)
        .single();
      
      if (parentErr) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error checking parent project: ${parentErr.message}` } }) }]
        };
      }

      if (parentProject && parentProject.name === name) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              data: null,
              meta: {
                ok: false,
                code: 'RECURSIVE_PROJECT_DELEGATION',
                message: `Error: You are attempting to delegate a new project with the name "${name}", but you are already working within a project of the same name. This creates a recursive loop. Instead of delegating, you should decompose the work by creating smaller, specific jobs within the current project using the 'create_job' tool.`
              }
            })
          }]
        };
      }
    }

    // Fallback: use project_definition_id from environment context
    if (!parentProjectDefinitionId && process.env.JINN_PROJECT_DEFINITION_ID) {
      parentProjectDefinitionId = process.env.JINN_PROJECT_DEFINITION_ID;
    }

    // Build effective project definition from inputs
    let effectiveProjectDefinition: Record<string, any> = { name, objective, strategy, kpis };

    // Try to reuse existing project_definition by name to avoid unique violation
    if (!effectiveProjectDefinition.id && effectiveProjectDefinition.name) {
      const { data: existingDef, error: existingErr } = await supabase
        .from('project_definitions')
        .select('id')
        .eq('name', effectiveProjectDefinition.name)
        .maybeSingle();
      if (!existingErr && existingDef && (existingDef as any).id) {
        effectiveProjectDefinition.id = (existingDef as any).id;
      }
    }

    // Set the owner and parent IDs
    const definitionWithOwner = { 
      ...effectiveProjectDefinition, 
      owner_job_definition_id: ownerJobDefinitionId,
      parent_project_definition_id: parentProjectDefinitionId
    } as Record<string, any>;

    const { data, error } = await supabase.rpc('plan_project', {
      p_project_definition: definitionWithOwner,
      p_project_run: {},
      p_jobs: jobs || []
    });
    if (error) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error calling plan_project: ${error.message}` } }) }]
      };
    }
    // data is a rowset from RETURNS TABLE; normalize to first row
    const result = Array.isArray(data) ? data[0] : data;
    const payload = {
      data: result ?? null,
      meta: { ok: true },
      next_step_note: 'Create a project lead job associated with this project definition.'
    };
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
  } catch (e: any) {
    const payload = { data: null, meta: { ok: false, code: 'DB_ERROR', message: String(e?.message || e) } };
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
  }
}


