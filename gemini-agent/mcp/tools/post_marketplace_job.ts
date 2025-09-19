import { z } from 'zod';
import { marketplaceInteract } from 'mech-client-ts/dist/marketplace_interact';
import { getCurrentJobContext } from './shared/context';

export const postMarketplaceJobParams = z.object({
  prompt: z.string().min(1),
  jobName: z.string().min(1),
  enabledTools: z.array(z.string()).optional(),
});

export const postMarketplaceJobSchema = {
  description: 'Posts a marketplace job by uploading a flattened JSON payload to IPFS and submitting a request to the Mech marketplace.',
  inputSchema: postMarketplaceJobParams.shape,
};

export async function postMarketplaceJob(args: unknown) {
  try {
    const parse = postMarketplaceJobParams.safeParse(args);
    if (!parse.success) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: parse.error.message } }) }] };
    }
    const { prompt, jobName, enabledTools } = parse.data;

    const ctx = getCurrentJobContext();
    const parentContext: Record<string, any> = {};
    if (ctx.requestId) parentContext.parentRequestId = ctx.requestId;
    if (ctx.jobName) parentContext.parentJobName = ctx.jobName;

    // Flatten: combine prompt/jobName/enabledTools with parent context
    const ipfsContent: Record<string, any> = {
      prompt,
      jobName,
      enabledTools,
      ...parentContext,
    };

    const result = await marketplaceInteract({
      prompts: [prompt],
      priorityMech: '0xaB15F8d064b59447Bd8E9e89DD3FA770aBF5EEb7',
      tools: enabledTools || [],
      ipfsJsonContents: [ipfsContent],
      chainConfig: 'base',
      postOnly: true,
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: result, meta: { ok: true } }) }] };
  } catch (error: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'EXECUTION_ERROR', message: error.message } }) }] };
  }
}