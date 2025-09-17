import { z } from 'zod';
import { getCurrentJobContext } from './shared/context.js';
import { createArtifact, isControlApiEnabled } from './shared/control_api.js';

export const createArtifactParams = z.object({
  topic: z.string().describe('The topic/category for this artifact (e.g., "analysis", "result", "output")'),
  content: z.string().describe('The content of the artifact to store'),
  cid: z.string().optional().describe('Optional IPFS CID if content is already uploaded to IPFS'),
});

export const createArtifactSchema = {
  description: 'Creates an artifact via the Control API for on-chain jobs. Automatically injects request_id and worker_address from job context.',
  inputSchema: createArtifactParams.shape,
};

export async function createArtifactTool(params: z.infer<typeof createArtifactParams>) {
  try {
    const parseResult = createArtifactParams.safeParse(params);
    if (!parseResult.success) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            data: null, 
            meta: { 
              ok: false, 
              code: 'VALIDATION_ERROR', 
              message: `Invalid parameters: ${parseResult.error.message}`,
              details: parseResult.error.flatten?.() ?? undefined 
            } 
          })
        }]
      };
    }

    const { topic, content, cid } = parseResult.data;
    const { requestId } = getCurrentJobContext();

    if (!isControlApiEnabled()) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            data: null, 
            meta: { 
              ok: false, 
              code: 'CONTROL_API_DISABLED', 
              message: 'Control API is disabled. Use create_record tool instead.' 
            } 
          })
        }]
      };
    }

    if (!requestId) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            data: null, 
            meta: { 
              ok: false, 
              code: 'MISSING_REQUEST_ID', 
              message: 'requestId is required for on-chain artifact creation. This tool only works within on-chain job context.' 
            } 
          })
        }]
      };
    }

    const artifactData = {
      cid: cid || 'inline',
      topic,
      content,
    };

    const artifactId = await createArtifact(requestId, artifactData);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ 
          data: { 
            id: artifactId,
            request_id: requestId,
            topic,
            cid: artifactData.cid
          }, 
          meta: { 
            ok: true, 
            source: 'control_api' 
          } 
        })
      }]
    };
  } catch (e: any) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ 
          data: null, 
          meta: { 
            ok: false, 
            code: 'CONTROL_API_ERROR', 
            message: `Control API error: ${e.message}` 
          } 
        })
      }]
    };
  }
}
