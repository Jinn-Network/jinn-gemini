import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';

export const sendMessageParams = z.object({
  to_job_definition_id: z.string().uuid().describe('Target job definition ID (required).'),
  content: z
    .string()
    .min(1)
    .describe('Message body. Keep concise; large payloads should be artifacts.'),
});

export const sendMessageSchema = {
  description: 'Sends a message to another job definition. Use this to escalate, request clarification, or hand off. To send a message to a human supervisor, set `to_job_definition_id` to "eb462084-3fc4-49da-b92d-a050fad82d63". Writes to the messages table via DB RPC with lineage injection.',
  inputSchema: sendMessageParams.shape,
};

export async function sendMessage(params: z.infer<typeof sendMessageParams>) {
  try {
    const parseResult = sendMessageParams.safeParse(params);
    if (!parseResult.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined } })
        }]
      };
    }

    const { to_job_definition_id, content } = parseResult.data;
    const { jobId, jobDefinitionId, jobName, projectRunId, sourceEventId } = getCurrentJobContext();

    const payload: Record<string, any> = {
      // addressing
      to_job_definition_id: to_job_definition_id ?? null,
      content,
      // status defaults to PENDING at DB level
      // lineage (source)
      job_id: jobId ?? null,
      job_definition_id: jobDefinitionId ?? null,
      project_run_id: projectRunId ?? null,
      source_event_id: sourceEventId ?? null,
      project_definition_id: null,
    };

    // If context carries project definition, include it
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (process.env.JINN_PROJECT_DEFINITION_ID) {
      payload.project_definition_id = process.env.JINN_PROJECT_DEFINITION_ID;
    }

    // Enforce DB-function-only write path
    const { data: newId, error } = await supabase.rpc('create_record', {
      p_table_name: 'messages',
      p_data: payload,
    });
    if (error) throw error;

    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: { id: newId }, meta: { ok: true } }) }] };
  } catch (e: any) {
    return {
      content: [
        { type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error sending message: ${e.message}` } }) },
      ],
    };
  }
}


