import { z } from 'zod';

type PushJsonToIpfsResult = readonly [string, string];

type PushJsonToIpfs = (content: unknown) => Promise<PushJsonToIpfsResult>;

type MechClientIpfs = {
  pushJsonToIpfs: PushJsonToIpfs;
};

// Dynamic import helper for mech-client-ts; no silent fallback
async function getMechClientIpfs(): Promise<MechClientIpfs> {
  const mechClient = await import('mech-client-ts/dist/ipfs.js');
  if (typeof (mechClient as any)?.pushJsonToIpfs !== 'function') {
    throw new Error('mech-client-ts IPFS helper unavailable');
  }
  return mechClient as MechClientIpfs;
}

export const createArtifactParams = z.object({
  name: z.string().min(1),
  topic: z.string().min(1),
  content: z.string().min(1),
  mimeType: z.string().optional(),
});

export const createArtifactSchema = {
  description: `Uploads content to IPFS and returns { cid, name, topic, contentPreview }.

MANDATORY USE CASES:
- Research findings and analysis results
- Generated code, configurations, schemas
- Multi-step process outputs and summaries
- Data extractions or transformations
- Any substantial deliverable for parent job review

Execution summaries document process; artifacts persist deliverables. Use create_artifact liberally for all substantial work outputs to ensure discoverability via search_artifacts.`,
  inputSchema: createArtifactParams.shape,
};

export async function createArtifact(args: unknown) {
  try {
    const parsed = createArtifactParams.safeParse(args);
    if (!parsed.success) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message } }) }] };
    }
    const { name, topic, content, mimeType } = parsed.data;

    const contentPreview = content.slice(0, 100);
    const payload = { name, topic, content, mimeType: mimeType || 'text/plain' } as const;

    // Get mech-client-ts functions dynamically
    const mechClient = await getMechClientIpfs();
    const [digestHex, cidHex] = await mechClient.pushJsonToIpfs(payload);
    console.error('[create_artifact] pushJsonToIpfs result', {
      digestHex,
      cidHex,
      cidHexType: typeof cidHex,
      digestHexType: typeof digestHex,
    });
    if (typeof cidHex !== 'string' || cidHex.length === 0) {
      throw new Error('IPFS upload failed: missing CID');
    }
    const cid = cidHex;

    const result = { cid, name, topic, contentPreview };
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: result, meta: { ok: true } }) }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'EXECUTION_ERROR', message } }) }] };
  }
}
