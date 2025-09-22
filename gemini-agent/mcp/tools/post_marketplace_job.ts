import { z } from 'zod';
import { marketplaceInteract } from 'mech-client-ts/dist/marketplace_interact.js';
import { getCurrentJobContext } from './shared/context.js';

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
      nonce: (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...parentContext,
    };

    const result = await (marketplaceInteract as any)({
      prompts: [prompt],
      priorityMech: '0xaB15F8d064b59447Bd8E9e89DD3FA770aBF5EEb7',
      tools: enabledTools || [],
      ipfsJsonContents: [ipfsContent],
      chainConfig: 'base',
      postOnly: true,
    });

    // Enrich with IPFS gateway link by querying subgraph for the request's ipfsHash
    let ipfsGatewayUrl: string | null = null;
    try {
      const gqlUrl = process.env.PONDER_GRAPHQL_URL;
      const firstRequestId = Array.isArray((result as any)?.request_ids) ? (result as any).request_ids[0] : undefined;
      if (gqlUrl && firstRequestId) {
        const query = `query ($id: String!) { request(id: $id) { ipfsHash } }`;
        
        // Retry a few times as subgraph indexing may take a moment
        for (let attempt = 0; attempt < 5; attempt++) {
          if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between retries
          }
          
          const resp = await fetch(gqlUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query, variables: { id: firstRequestId } }),
          });
          if (resp.ok) {
            const json = await resp.json();
            const ipfsHash = json?.data?.request?.ipfsHash as string | undefined;
            if (ipfsHash) {
              ipfsGatewayUrl = `https://gateway.autonolas.tech/ipfs/${ipfsHash}`;
              break; // Success, exit retry loop
            }
          }
        }
      }
    } catch (_) {
      // best-effort enrichment; ignore failures
    }

    const enriched = {
      ...result,
      ipfs_gateway_url: ipfsGatewayUrl,
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: enriched, meta: { ok: true } }) }] };
  } catch (error: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'EXECUTION_ERROR', message: error.message } }) }] };
  }
}