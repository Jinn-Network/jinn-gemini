/*
  Debug script for Civitai SDK image generation.
  Mirrors civitai_generate_image tool behavior with verbose logging.
  Usage examples:
    CIVITAI_API_TOKEN=... tsx scripts/civitai-sdk-debug.ts \
      --model urn:air:sd1:checkpoint:civitai:4201@130072 \
      --prompt "a cat in a field of flowers" \
      --steps 20 --cfg 7 --width 512 --height 512 --scheduler EulerA
*/

import { argv } from 'node:process';
import { getCivitaiApiKey, checkModelAvailability, airCreateImage, extractFirstImageUrl } from '../gemini-agent/mcp/tools/shared/civitai.js';

type Args = {
  model: string;
  prompt: string;
  negative?: string;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  scheduler?: string;
  seed?: number;
};

function parseArgs(): Args {
  const out: any = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k.startsWith('--')) continue;
    switch (k) {
      case '--model': out.model = v; i++; break;
      case '--prompt': out.prompt = v; i++; break;
      case '--negative': out.negative = v; i++; break;
      case '--steps': out.steps = Number(v); i++; break;
      case '--cfg': out.cfg = Number(v); i++; break;
      case '--width': out.width = Number(v); i++; break;
      case '--height': out.height = Number(v); i++; break;
      case '--scheduler': out.scheduler = v; i++; break;
      case '--seed': out.seed = Number(v); i++; break;
    }
  }
  return out as Args;
}

async function main() {
  console.log('[debug] Starting Civitai SDK debug script');
  const args = parseArgs();
  console.log('[debug] Args:', JSON.stringify(args));

  const apiKey = getCivitaiApiKey();
  console.log('[debug] API key present:', Boolean(apiKey), 'len=', apiKey?.length ?? 0);
  if (!apiKey) {
    console.error('[error] Missing CIVITAI_API_TOKEN/CIVITAI_API_KEY');
    process.exit(1);
  }

  try {
    console.log('[debug] Checking model availability...');
    const check = await checkModelAvailability();
    console.log('[debug] Model availability:', check);
  } catch (err) {
    console.warn('[warn] Model availability check failed:', err);
  }

  try {
    console.log('[debug] Calling airCreateImage with wait=true...');
    const res = await airCreateImage({
      model: args.model,
      params: {
        prompt: args.prompt,
        negativePrompt: args.negative,
        steps: args.steps,
        cfgScale: args.cfg,
        width: args.width,
        height: args.height,
        scheduler: args.scheduler,
        seed: args.seed,
      },
    });
    console.log('[debug] AIR response keys:', Object.keys(res || {}));
    console.log('[debug] AIR response status:', (res as any)?.status);
    console.log('[debug] AIR response images length:', Array.isArray((res as any)?.images) ? (res as any).images.length : 'n/a');
    const url = extractFirstImageUrl(res as any);
    console.log('[result] image_url =', url);
    if (!url) {
      console.error('[error] No image URL found in response. Full response snippet:', JSON.stringify(res, null, 2).substring(0, 5000));
      process.exit(2);
    }
    process.exit(0);
  } catch (err: any) {
    console.error('[error] SDK call failed:', err?.message || String(err));
    if (err?.response && typeof err.response === 'object') {
      console.error('[error] SDK error response:', JSON.stringify(err.response).substring(0, 2000));
    }
    console.error('[error] stack:', err?.stack?.substring(0, 1000));
    process.exit(3);
  }
}

main();


