import { z } from 'zod';
// Schema for MCP registration - permissive to allow MCP to pass through to handler
const signalCompletionParamsBase = z.object({
    status: z.string().min(1),
    message: z.string().min(1),
});
// Strict validation schema for handler
export const signalCompletionParams = z.object({
    status: z.enum(['COMPLETED', 'FAILED']),
    message: z.string().min(1),
});
export const signalCompletionSchema = {
    description: 'Signal that this job has reached a TERMINAL state and notify the parent job if one exists. ONLY use when the job is completely finished - either COMPLETED (success) or FAILED (error). Do NOT use for intermediate states like delegating work to child jobs or waiting for responses. The status must be either "COMPLETED" or "FAILED".',
    inputSchema: signalCompletionParamsBase.shape,
};
export async function signalCompletion(args) {
    try {
        const parsed = signalCompletionParams.safeParse(args);
        if (!parsed.success) {
            // Extract the actual status value if provided for better error message
            const providedStatus = args?.status;
            const baseMessage = parsed.error.message;
            const helpfulMessage = providedStatus
                ? `Invalid status "${providedStatus}". The signal_completion tool only accepts "COMPLETED" or "FAILED" for terminal job states. Do not use this tool for intermediate states like delegating or waiting. ${baseMessage}`
                : baseMessage;
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            data: null,
                            meta: {
                                ok: false,
                                code: 'VALIDATION_ERROR',
                                message: helpfulMessage
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
                    type: 'text',
                    text: JSON.stringify({
                        data: result,
                        meta: { ok: true }
                    })
                }]
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{
                    type: 'text',
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
