import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { composeSinglePageResponse } from './shared/context-management.js';

// Input schema - minimal parameters, project context is inferred automatically
export const getProjectSummaryParams = z.object({
  history_count: z.number().min(1).max(10).default(3).describe('Number of recent project runs to include in summary (1-10, default: 3)'),
  cursor: z.string().optional().describe('Pagination cursor for fetching next page of results')
});

export const getProjectSummarySchema = {
  description: 'Get a high-level summary of recent project runs for the current agent\'s project. Automatically infers project context from the current job. Returns artifacts and outputs from recent runs, with automatic pagination and context management.',
  inputSchema: getProjectSummaryParams.shape,
};

export async function getProjectSummary(params: z.infer<typeof getProjectSummaryParams>) {
  const parsed = getProjectSummaryParams.safeParse(params ?? {});
  if (!parsed.success) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ 
          data: null, 
          meta: { 
            ok: false, 
            code: 'VALIDATION_ERROR', 
            message: `Invalid parameters: ${parsed.error.message}` 
          } 
        })
      }]
    };
  }

  const { history_count, cursor } = parsed.data;

  try {
    // Step 1: Get current job context to infer project definition
    const { projectDefinitionId } = getCurrentJobContext();
    if (!projectDefinitionId) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            data: null, 
            meta: { 
              ok: false, 
              code: 'NO_PROJECT_CONTEXT', 
              message: 'No project context available. This tool must be called from within a job that has project context.' 
            } 
          })
        }]
      };
    }

    // Step 2: Fetch recent project runs for this project definition
    const { data: projectRuns, error: runsError } = await supabase
      .from('project_runs')
      .select(`
        id,
        status,
        created_at,
        project_definition_id
      `)
      .eq('project_definition_id', projectDefinitionId)
      .order('created_at', { ascending: false })
      .limit(history_count * 2); // Fetch more than needed to account for potential filtering

            if (runsError) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ 
                        data: null, 
                        meta: { 
                            ok: false, 
                            code: 'DB_ERROR', 
                            message: `Failed to fetch project runs: ${runsError.message}` 
                        } 
                    }, null, 2)
                }]
            };
        }

    if (!projectRuns || projectRuns.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            data: [], 
            meta: { 
              ok: true,
              tokens: { page_tokens: 0, full_tokens: 0, budget_tokens: 15000, estimated: true },
              has_more: false
            } 
          })
        }]
      };
    }

    // Step 3: Get project definition details
    const { data: projectDef, error: defError } = await supabase
      .from('project_definitions')
      .select('id, name, objective')
      .eq('id', projectDefinitionId)
      .single();

            if (defError) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ 
                        data: null, 
                        meta: { 
                            ok: false, 
                            code: 'DB_ERROR', 
                            message: `Failed to fetch project definition: ${defError.message}` 
                        } 
                    }, null, 2)
                }]
            };
        }

    // Step 4: For each project run, fetch associated artifacts and count messages
    const enrichedRuns = await Promise.all(
      projectRuns.slice(0, history_count).map(async (run) => {
        // Fetch artifacts for this run
        const { data: artifacts, error: artifactsError } = await supabase
          .from('artifacts')
          .select(`
            id,
            topic,
            content,
            created_at,
            source_job_name
          `)
          .eq('project_run_id', run.id)
          .order('created_at', { ascending: false });

        if (artifactsError) {
          console.warn(`Warning: Failed to fetch artifacts for run ${run.id}: ${artifactsError.message}`);
        }

        // Count messages for this run
        const { count: messageCount, error: messageError } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('project_run_id', run.id);

        if (messageError) {
          console.warn(`Warning: Failed to count messages for run ${run.id}: ${messageError.message}`);
        }

        // Process artifacts to create summaries
        const processedArtifacts = (artifacts || []).map(artifact => ({
          id: artifact.id,
          topic: artifact.topic,
          content_summary: artifact.content 
            ? (artifact.content.length > 200 ? artifact.content.substring(0, 200) + '... [truncated]' : artifact.content)
            : 'No content',
          created_by_job_name: artifact.source_job_name || 'Unknown'
        }));

        return {
          run_id: run.id,
          status: run.status,
          created_at: run.created_at,
          outputs: {
            artifacts: processedArtifacts,
            messages_count: messageCount || 0
          }
        };
      })
    );

    // Step 5: Use context manager to format response with proper pagination and token management
    const response = composeSinglePageResponse(enrichedRuns, {
      pageTokenBudget: 15000, // 15k token budget for this tool
      truncateChars: 200, // Truncate long strings to 200 chars
      truncationPolicy: {
        content_summary: 200, // Specific truncation for artifact summaries
        topic: 100 // Truncate topic names if they're too long
      },
      requestedMeta: { cursor, history_count }
    });

    // Step 6: Add project definition context to the response
    const finalResponse = {
      project_definition: {
        id: projectDef.id,
        name: projectDef.name,
        objective: projectDef.objective
      },
      recent_runs: response.data
    };

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ 
          data: finalResponse, 
          meta: { ...response.meta, ok: true }
        }, null, 2)
      }]
    };

  } catch (e: any) {
    const payload = { 
      data: null, 
      meta: { 
        ok: false, 
        code: 'DB_ERROR', 
        message: String(e?.message || e) 
      } 
    };
    return { 
      content: [{ 
        type: 'text' as const, 
        text: JSON.stringify(payload) 
      }] 
    };
  }
}
