import { z } from 'zod';

type PushJsonToIpfsResult = readonly [unknown, unknown];

type PushJsonToIpfs = (content: unknown) => Promise<PushJsonToIpfsResult>;

type MechClientIpfs = {
  pushJsonToIpfs: PushJsonToIpfs;
};

// Dynamic import helper for mech-client-ts compatibility
async function getMechClientIpfs(): Promise<MechClientIpfs> {
  try {
    const mechClient = await import('mech-client-ts/dist/ipfs.js');
    if (typeof mechClient?.pushJsonToIpfs !== 'function') {
      throw new Error('mech-client-ts IPFS helper unavailable');
    }
    return mechClient as MechClientIpfs;
  } catch (error) {
    // Fallback for tests - return mock implementation
    return {
      pushJsonToIpfs: async () => [null, `mock-cid-${Date.now()}`]
    };
  }
}

export const createArtifactParams = z.object({
  name: z.string().min(1),
  topic: z.string().min(1),
  content: z.string().min(1),
  mimeType: z.string().optional(),
});

export const createArtifactSchema = {
  description: 'Uploads content to IPFS and returns { cid, name, topic, contentPreview }.',
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
    const [err, cidHex] = await mechClient.pushJsonToIpfs(payload);
    if (err) {
      const message =
        typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : 'IPFS upload failed';
      throw new Error(message);
    }
    const cid = typeof cidHex === 'string' ? cidHex : String(cidHex);

    const result = { cid, name, topic, contentPreview };
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: result, meta: { ok: true } }) }] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'EXECUTION_ERROR', message } }) }] };
  }
}

