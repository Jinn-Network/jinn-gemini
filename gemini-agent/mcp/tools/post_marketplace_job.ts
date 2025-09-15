import { z } from 'zod';
import { getCurrentJobContext } from './shared/context.js';
import { tableNameSchema } from './shared/types.js';
import { supabase } from './shared/supabase.js';
import { get_mech_config } from '../../../../mech-client-ts/dist/config.js';
import { marketplaceInteract } from '../../../../mech-client-ts/dist/marketplace_interact.js';

export const postMarketplaceJobParams = z.object({
  prompt: z.string().min(1),
  priorityMech: z.string().startsWith('0x'),
  tools: z.array(z.string()).default([]),
  chainConfig: z.string().default('base'),
});

export const postMarketplaceJobSchema = {
  description: 'Posts a new job to the Mech Marketplace on the specified chain. Embeds parentRequestId when present.',
  inputSchema: postMarketplaceJobParams.shape,
};

export async function postMarketplaceJob(params: z.infer<typeof postMarketplaceJobParams>) {
  try {
    const parse = postMarketplaceJobParams.safeParse(params);
    if (!parse.success) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: parse.error.message } }) }] };
    }
    const { prompt, priorityMech, tools, chainConfig } = parse.data;

    const ctx = getCurrentJobContext();
    const extraAttributes: Record<string, any> = {};
    if (ctx.requestId) extraAttributes.parentRequestId = ctx.requestId;
    if (ctx.jobName) extraAttributes.parentJobName = ctx.jobName;

    const res = await marketplaceInteract({
      prompts: [prompt],
      priorityMech,
      tools,
      extraAttributes,
      chainConfig,
      postOnly: true,
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: res, meta: { ok: true } }) }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'POST_ERROR', message: e?.message || String(e) } }) }] };
  }
}


