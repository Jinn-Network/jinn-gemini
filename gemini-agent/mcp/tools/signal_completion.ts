import { z } from 'zod';

export const signalCompletionParams = z.object({
  status: z.enum(['COMPLETED', 'FAILED']),
  message: z.string().min(1),
});

export const signalCompletionSchema = {
  description: 'Signal that this job has reached a terminal state (COMPLETED or FAILED) and notify the parent job if one exists. Use this when a child job finishes its work to trigger the Work Protocol.',
  inputSchema: signalCompletionParams.shape,
};

export async function signalCompletion(args: unknown) {
  try {
    const parsed = signalCompletionParams.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            data: null,
            meta: {
              ok: false,
              code: 'VALIDATION_ERROR',
              message: parsed.error.message
            }
          })
        }]
      };
    }

    const { status, message } = parsed.data;

    // This tool just records the signal - the worker will detect it from telemetry
    // and handle the actual parent dispatch logic
    const result = {
      status,
      message,
      signaled_at: new Date().toISOString()
    };

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: result,
          meta: { ok: true }
        })
      }]
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: null,
          meta: {
            ok: false,
            code: 'EXECUTION_ERROR',
            message
          }
        })
      }]
    };
  }
}