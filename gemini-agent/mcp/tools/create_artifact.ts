import { z } from 'zod';
import { pushJsonToIpfs } from '../../../packages/mech-client-ts/dist/ipfs.js';

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

    const [, cidHex] = await pushJsonToIpfs(payload);
    const cid = cidHex; // gateway-compatible CIDv1 hex string already returned by helper

    const result = { cid, name, topic, contentPreview };
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: result, meta: { ok: true } }) }] };
  } catch (error: any) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'EXECUTION_ERROR', message: error?.message || String(error) } }) }] };
  }
}

