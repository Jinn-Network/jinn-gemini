import { z } from 'zod';
import { supabase } from './shared/supabase.js';
import { getCurrentJobContext } from './shared/context.js';
import { getCivitaiApiKey, airCreateImage, extractFirstImageUrl, checkModelAvailability, waitForImageUrlByToken } from './shared/civitai.js';
import { randomUUID } from 'crypto';

// Schema for image generation using Civitai AIR. The tool waits for completion
// (within MCP/tool time limits) and then creates an artifact with the image URL.

export const civitaiGenerateImageParams = z.object({
  prompt: z.string().min(1),
  negative_prompt: z.string().optional(),
  model_urn: z.string().min(1).describe('AIR URN, e.g., urn:air:sd1:checkpoint:civitai:4201@130072'),
  width: z.number().int().positive().default(512),
  height: z.number().int().positive().default(512),
  steps: z.number().int().positive().max(200).optional(),
  cfg_scale: z.number().positive().max(30).optional(),
  scheduler: z.string().optional(),
  seed: z.number().int().optional(),

  // Optional escape hatch for development/testing to bypass AIR call
  image_url_override: z.string().url().optional().describe('Development override: use this URL as the generated image'),

  // Optional context overrides for non-job testing
  project_run_id: z.string().uuid().optional(),
  project_definition_id: z.string().uuid().optional(),
});

export type CivitaiGenerateImageParams = z.infer<typeof civitaiGenerateImageParams>;

export const civitaiGenerateImageSchema = {
  description: 'Generate an image with Civitai AIR and persist a durable public URL as an artifact (topic: image.generated). Returns { artifact_id, image_url }.',
  inputSchema: civitaiGenerateImageParams.shape,
};

export async function civitaiGenerateImage(params: CivitaiGenerateImageParams) {
  try {
    const parsed = civitaiGenerateImageParams.safeParse(params);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parsed.error.message}`, details: parsed.error.flatten?.() } }, null, 2) }]
      };
    }

    const {
      prompt,
      negative_prompt,
      model_urn,
      width,
      height,
      steps,
      cfg_scale,
      scheduler,
      seed,
      image_url_override,
      project_run_id,
      project_definition_id,
    } = parsed.data;

    const { jobId, jobDefinitionId, projectRunId, projectDefinitionId } = getCurrentJobContext();

    // Resolve project context (prefer job context; allow explicit params for non-job tests)
    const resolvedProjectRunId = projectRunId || project_run_id || null;
    const resolvedProjectDefinitionId = projectDefinitionId || project_definition_id || null;

    if (!resolvedProjectRunId) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'MISSING_PROJECT_CONTEXT', message: 'Cannot create an artifact. The job has no project_run_id context.' } }, null, 2) }]
      };
    }

    // 1) Obtain image URL either via AIR or override (for development/testing)
    let finalImageUrl: string | null = null;

    if (image_url_override) {
      finalImageUrl = image_url_override;
    } else {
      const apiKey = getCivitaiApiKey();
      if (!apiKey) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'MISSING_API_KEY', message: 'CIVITAI_API_TOKEN/CIVITAI_API_KEY is not set. Provide an API key or use image_url_override for development.' } }, null, 2) }]
        };
      }

      // Check model availability first to debug API access
      const modelCheck = await checkModelAvailability();
      if (!modelCheck.available) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'API_ACCESS_DENIED', message: `Civitai API access check failed: ${modelCheck.error}` } }, null, 2) }]
        };
      }

      // Create the AIR job (we default to wait=false in SDK wrapper to avoid noisy logs)
      const createRes = await airCreateImage({
        model: model_urn,
        params: {
          prompt,
          negativePrompt: negative_prompt,
          width,
          height,
          steps,
          cfgScale: cfg_scale,
          scheduler,
          seed,
        }
      });

      // Try immediate URL first (covers cases where output is present)
      let immediateUrl = extractFirstImageUrl(createRes);
      if (!immediateUrl && (createRes as any)?.token) {
        // Quiet manual polling using token until URL is available
        const token = (createRes as any).token as string;
        immediateUrl = await waitForImageUrlByToken(token);
      }
      if (!immediateUrl) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'AIR_NO_IMAGE_URL', message: `No image URL found after generation. status=${createRes?.status ?? 'unknown'}` } }, null, 2) }]
        };
      }
      finalImageUrl = immediateUrl;
    }

    // 2) Rehost to Supabase Storage for a durable public URL
    const fetchFn: any = (globalThis as any).fetch;
    if (!fetchFn) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'FETCH_UNAVAILABLE', message: 'fetch is not available in this runtime; cannot rehost image' } }, null, 2) }]
      };
    }

    let durableUrl: string | null = null;
    try {
      const res = await fetchFn(finalImageUrl);
      if (!res?.ok) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DOWNLOAD_FAILED', message: `Failed to download generated image (status ${res?.status})` } }, null, 2) }]
        };
      }
      const contentType = (res.headers?.get?.('content-type') as string) || 'application/octet-stream';
      const buf = await res.arrayBuffer();

      // Derive extension from content-type
      let ext = 'bin';
      if (contentType.includes('png')) ext = 'png';
      else if (contentType.includes('webp')) ext = 'webp';
      else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';

      const now = new Date();
      const year = now.getUTCFullYear();
      const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const day = String(now.getUTCDate()).padStart(2, '0');
      const fileKey = `${year}/${month}/${day}/${randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase
        .storage
        .from('generated-images')
        .upload(fileKey, new Uint8Array(buf), { contentType, upsert: true });

      if (uploadError) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'UPLOAD_FAILED', message: `Failed to upload durable image: ${uploadError.message}` } }, null, 2) }]
        };
      }

      const { data: publicData } = supabase.storage.from('generated-images').getPublicUrl(fileKey);
      durableUrl = (publicData as any)?.publicUrl || null;
      if (!durableUrl) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'PUBLIC_URL_FAILED', message: 'Could not resolve public URL for uploaded image' } }, null, 2) }]
        };
      }
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'REHOST_ERROR', message: `Failed to rehost image: ${e?.message || String(e)}` } }, null, 2) }]
      };
    }

    // 3) Persist artifact when job context is available; otherwise return URL only
    if (jobId) {
      const newArtifact = {
        project_run_id: resolvedProjectRunId,
        project_definition_id: resolvedProjectDefinitionId || null,
        content: durableUrl,
        topic: 'image.generated',
        status: 'READY',
        job_id: jobId,
        parent_job_definition_id: jobDefinitionId,
      } as any;

      const { data: createdArtifact, error: createError } = await supabase
        .from('artifacts')
        .insert(newArtifact)
        .select('id')
        .single();

      if (createError) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'CREATE_FAILED', message: `Failed to create artifact: ${createError.message}` } }, null, 2) }]
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: { artifact_id: createdArtifact.id, image_url: durableUrl }, meta: { ok: true } }, null, 2) }]
      };
    } else {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: { artifact_id: null, image_url: durableUrl }, meta: { ok: true, warning: 'NO_JOB_CONTEXT' } }, null, 2) }]
      };
    }
  } catch (e: any) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'UNEXPECTED_ERROR', message: `civitai_generate_image failed: ${e?.message || String(e)}` } }, null, 2) }]
    };
  }
}

 