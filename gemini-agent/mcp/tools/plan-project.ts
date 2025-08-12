import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { randomUUID } from 'crypto';

// Input schemas
export const planProjectParams = z.object({
  project_definition: z.object({
    id: z.string().uuid().optional().describe('Existing project_definition ID if updating in place.'),
    // Make name optional at the MCP boundary; infer internally from job context when missing
    name: z.string().min(1).optional().describe('Canonical project name (stable, human-readable).'),
    objective: z.string().optional().describe('Concise mission/objective for the project run family.'),
    strategy: z.string().optional().describe('High-level approach/plan. Free-form text; can include bullet points.'),
    kpis: z
      .record(z.any())
      .optional()
      .describe(
        'KPIs for measuring success. Suggested shape: { "north_star"?: string, "metrics"?: [ { name: string, target?: number|string, unit?: string, direction?: "up"|"down", cadence?: "daily"|"weekly"|"monthly" } ], "notes"?: string }. Free-form JSON allowed.'
      )
  })
    .optional()
    .describe('Canonical project definition metadata'),
  jobs: z
    .array(
      z.object({
        id: z.string().uuid().optional().describe('Optional job definition ID if updating an existing definition.'),
        version: z.number().int().optional().describe('Optional explicit version; omitted means default versioning in DB.'),
        name: z.string().describe('Unique, human-readable job name.'),
        description: z.string().optional().describe('Short description of the job purpose.'),
        prompt_content: z.string().describe('System prompt for the job.'),
        enabled_tools: z
          .array(z.string())
          .optional()
          .describe(
            'Allowed MCP tools for this job. Must match registered tool names. If omitted, defaults to [].'
          ),
        schedule_config: z
          .record(z.any())
          .optional()
          .describe(
            'Trigger config for dispatcher. Example: { "trigger": "on_new_event", "filters": { "event_type": "analysis.complete", "payload"?: { ... } } }.'
          ),
      })
    )
    .default([])
    .describe('Job definitions to create for this project')
});

export const planProjectSchema = {
  description: 'Create or reuse a project_definition, instantiate a project_run, and create one or more jobs in a single transaction.',
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

  // project_definition is optional at boundary; will be normalized below
  const { project_definition, jobs } = parsed.data;
  try {
    // Resolve owner_job_definition_id automatically from current job context
    const { jobId, jobName } = getCurrentJobContext();
    if (!jobId && !jobName) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'NO_JOB_CONTEXT', message: 'Job context not available to infer owner_agent_id' } }) }]
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
      if (jbErr) throw jbErr;
      if (jb && (jb as any).job_definition_id) ownerJobDefinitionId = (jb as any).job_definition_id as string;
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
      if (jErr) throw jErr;
      if (jobDef && (jobDef as any).id) ownerJobDefinitionId = (jobDef as any).id as string;
    }

    if (!ownerJobDefinitionId) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'OWNER_JOB_DEFINITION_RESOLUTION_FAILED', message: 'Could not resolve owner_job_definition_id from job context' } }) }]
      };
    }

    // Infer project name if missing by looking up the current job's project_name on job_board
    let effectiveProjectDefinition: Record<string, any> = { ...(project_definition || {}) };
    if (!effectiveProjectDefinition.name) {
      let inferredName: string | null = null;
      if (jobId) {
        const { data: jbNameRow, error: jbNameErr } = await supabase
          .from('job_board')
          .select('project_name')
          .eq('id', jobId)
          .maybeSingle();
        if (jbNameErr) throw jbNameErr;
        inferredName = (jbNameRow as any)?.project_name ?? null;
      }
      if (!inferredName && jobName) {
        inferredName = jobName;
      }
      if (!inferredName) {
        inferredName = `Project ${randomUUID().slice(0, 8)}`;
      }
      effectiveProjectDefinition.name = inferredName;
    }

    // If no id was provided, try to reuse existing project_definition by name to avoid unique violation
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

    const definitionWithOwner = { ...effectiveProjectDefinition, owner_job_definition_id: ownerJobDefinitionId } as Record<string, any>;

    // Normalize jobs: inject job_id, is_active, default model
    const normalizedJobs = jobs.map((j) => {
      const copy: any = { ...j };
      copy.job_id = randomUUID();
      copy.is_active = true;
      if (!copy.model_settings || typeof copy.model_settings !== 'object') {
        copy.model_settings = { model: 'gemini-2.5-flash' };
      } else if (!copy.model_settings.model) {
        copy.model_settings.model = 'gemini-2.5-flash';
      }
      if (!copy.enabled_tools) copy.enabled_tools = [];
      return copy;
    });

    const { data, error } = await supabase.rpc('plan_project', {
      p_project_definition: definitionWithOwner,
      p_jobs: normalizedJobs,
    });
    if (error) throw error;
    // data is a rowset from RETURNS TABLE; normalize to first row
    const result = Array.isArray(data) ? data[0] : data;
    const payload = { data: result ?? null, meta: { ok: true } };
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
  } catch (e: any) {
    const payload = { data: null, meta: { ok: false, code: 'DB_ERROR', message: String(e?.message || e) } };
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
  }
}


