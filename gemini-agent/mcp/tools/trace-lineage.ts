import { z } from 'zod';
import { supabase } from './shared/supabase.js';

const traceLineageParams = z.object({
  artifact_id: z.string().uuid().optional().describe('UUID of the artifact to trace lineage from'),
  job_id: z.string().uuid().optional().describe('UUID of the job to trace lineage from'),
  max_depth: z.number().int().min(1).max(20).default(10).describe('Maximum depth to traverse (default: 10)'),
  random_string: z.string().optional().describe('Dummy parameter for no-parameter tools')
}).refine(
  (data) => {
    // Accept if direct params are provided
    if (data.artifact_id !== undefined || data.job_id !== undefined) {
      return true;
    }
    // Always accept if random_string is provided (we'll handle parsing errors in the function)
    if (data.random_string !== undefined) {
      return true;
    }
    return false;
  },
  {
    message: "Either artifact_id or job_id must be provided (directly or via random_string JSON)",
    path: ["artifact_id", "job_id", "random_string"]
  }
);

export type TraceLineageParams = z.infer<typeof traceLineageParams>;

export { traceLineageParams };

export const traceLineageSchema = {
  description: 'Traces the complete causal lineage of events forwards and backwards from any artifact or job. Reveals the full chain of causation in the universal event architecture.',
  inputSchema: traceLineageParams.shape,
};

/**
 * Trace Lineage - Follow the causal chain of execution
 * 
 * This tool enables universal causal tracing by walking the execution graph
 * forwards and backwards from any event (artifact or job). It reveals the
 * complete chain of causation for any action in the system.
 * 
 * Supports both direct parameter calls (for agents) and random_string JSON 
 * envelope calls (for chat wrappers that require dummy parameters).
 */
export async function traceLineage(params: TraceLineageParams) {
  const parsedParams = traceLineageParams.parse(params);
  
  try {
    let artifact_id = parsedParams.artifact_id;
    let job_id = parsedParams.job_id;
    let max_depth = parsedParams.max_depth || 10;

    // If direct params not provided, try parsing from random_string
    if (!artifact_id && !job_id && parsedParams.random_string) {
      try {
        const jsonParams = JSON.parse(parsedParams.random_string);
        artifact_id = jsonParams.artifact_id;
        job_id = jsonParams.job_id;
        max_depth = jsonParams.max_depth || max_depth;
      } catch (parseError) {
        const result = {
          success: false,
          error: 'Failed to parse random_string as JSON',
          starting_point: { artifact_id, job_id }
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      }
    }

    const starting_point = { artifact_id, job_id };
    
    // Call the database function
    const { data, error } = await supabase.rpc('trace_lineage_data', {
      input_artifact_id: artifact_id || null,
      input_job_id: job_id || null,
      max_depth
    });

    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }

    if (!data || data.length === 0) {
      const result = {
        success: true,
        starting_point,
        lineage: [],
        message: 'No lineage data found for the specified entity'
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }

    // Organize the lineage data by direction and depth
    const organized = {
      center: data.filter(item => item.direction === 'center'),
      backward: data.filter(item => item.direction === 'backward').sort((a, b) => a.depth - b.depth),
      forward: data.filter(item => item.direction === 'forward').sort((a, b) => a.depth - b.depth)
    };

    // Create a summary of the causal chain
    const summary = {
      total_entities: data.length,
      causes: organized.backward.length,
      effects: organized.forward.length,
      max_depth_reached: Math.max(...data.map(item => item.depth)),
      entity_types: {
        artifacts: data.filter(item => item.entity_type === 'artifact').length,
        jobs: data.filter(item => item.entity_type === 'job').length
      }
    };

    const result = {
      success: true,
      starting_point,
      lineage: {
        center: organized.center,
        causes: organized.backward,
        effects: organized.forward
      },
      summary,
      raw_data: data // Include raw data for advanced analysis
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    console.error('Error in traceLineage:', error);
    const result = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      starting_point: { artifact_id: parsedParams.artifact_id, job_id: parsedParams.job_id }
    };
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  }
}