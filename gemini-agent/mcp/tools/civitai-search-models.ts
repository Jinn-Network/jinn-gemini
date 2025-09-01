import { z } from 'zod';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';
import { getBaseModelEnumValues } from './shared/civitai-discovery.js';

// Inputs follow Civitai Public REST for models (single tag only)
const civitaiSearchModelsBase = z.object({
  // Search modes (choose exactly one): query | username | tag
  query: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),

  // Optional filters (constrained below)
  types: z.array(z.enum([
    'Checkpoint', 'TextualInversion', 'Hypernetwork', 'AestheticGradient', 'LORA', 'Controlnet', 'Poses'
  ])).optional(),
  // Dynamic enum sourced from discovery cache; falls back to defaults
  base_models: z.array(z.enum(getBaseModelEnumValues())).optional(),
  sort: z.enum(['Highest Rated', 'Most Downloaded', 'Newest']).optional(),
  period: z.enum(['AllTime', 'Year', 'Month', 'Week', 'Day']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  // Cursor encodes { page } for non-query mode, { cursor } for query mode
  cursor: z.string().optional(),
  page: z.number().int().min(1).optional(),
});

export const civitaiSearchModelsParams = civitaiSearchModelsBase.superRefine((val, ctx) => {
  const modes = [Boolean(val.query), Boolean(val.username), Boolean(val.tag)].filter(Boolean).length;
  if (modes === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of: 'query', 'username', or 'tag'" });
  }
  if (modes > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "'query', 'username', and 'tag' are mutually exclusive. Choose one." });
  }

  // With query mode, enforce types XOR base_models (not both)
  const inQueryMode = Boolean(val.query);
  const hasTypes = Array.isArray(val.types) && val.types.length > 0;
  const hasBaseModels = Array.isArray(val.base_models) && val.base_models.length > 0;
  if (inQueryMode && hasTypes && hasBaseModels) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "With 'query', use either 'types' or 'base_models' (not both)." });
  }

  // base_models must be a single value if provided
  if (hasBaseModels && val.base_models!.length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "'base_models' accepts a single value." });
  }
});

export type CivitaiSearchModelsParams = z.infer<typeof civitaiSearchModelsParams>;

export const civitaiSearchModelsSchema = {
  description: 'Find models on Civitai with explicit, API-safe parameter rules. Modes: exactly one of query | username | tag. With query: use either types or a single base model (not both). Sorting and period are optional. Returns normalized results and cursor meta.',
  inputSchema: civitaiSearchModelsBase.shape,
};

type CivitaiModel = any; // Keep flexible, we normalize below

function mapSort(val?: string): string | undefined {
  if (!val) return undefined;
  switch (val) {
    case 'Most Downloaded': return 'Most Downloaded';
    case 'Highest Rated': return 'Highest Rated';
    case 'Newest': return 'Newest';
    default: return val;
  }
}

function normalizeBaseModels(values?: string[]): string[] | undefined {
  if (!values || !values.length) return undefined;
  const map: Record<string, string> = {
    'sdxl': 'SDXL 1.0', 'sdxl1.0': 'SDXL 1.0', 'sdxl10': 'SDXL 1.0', 'sdxl 1.0': 'SDXL 1.0',
    'sd 1.5': 'SD 1.5', 'sd1.5': 'SD 1.5', '1.5': 'SD 1.5', 'sd15': 'SD 1.5',
    'sd 2.1': 'SD 2.1', 'sd2.1': 'SD 2.1', '2.1': 'SD 2.1', 'sd21': 'SD 2.1',
    'pony': 'Pony', 'ponyxl': 'Pony',
    'illustrious': 'Illustrious', 'illustrious xl': 'Illustrious',
  };
  const allowed = new Set(['SD 1.5','SDXL 1.0','SD 2.1','Pony','Illustrious']);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const key = String(v).trim().toLowerCase();
    const mapped = map[key] || v;
    if (allowed.has(mapped) && !seen.has(mapped)) {
      seen.add(mapped); out.push(mapped);
    }
  }
  return out.length ? out : undefined;
}

function buildQuery(params: (CivitaiSearchModelsParams & { page?: number; cursorVal?: string })) : string {
  const q = new URLSearchParams();
  if (params.limit) q.set('limit', String(params.limit));
  // Query-mode (name search) cannot use page; must use cursor
  const queryMode = Boolean(params.query);
  if (queryMode) {
    if (params.cursorVal) q.set('cursor', String(params.cursorVal));
  } else {
    q.set('page', String(params.page || 1));
  }
  if (params.query) q.set('query', params.query);
  if (params.tag) q.set('tag', params.tag);
  if (params.username) q.set('username', params.username);
  if (params.types && params.types.length) q.set('types', params.types.join(','));
  const baseModels = normalizeBaseModels(params.base_models);
  // Enforce single base model if present
  if (baseModels && baseModels.length) q.set('baseModels', baseModels[0]);
  const sort = mapSort(params.sort as any);
  if (sort) q.set('sort', sort);
  if (params.period) q.set('period', params.period);
  return q.toString();
}

function normalizeModel(m: CivitaiModel) {
  const firstVersion = Array.isArray(m?.modelVersions) ? m.modelVersions[0] : undefined;
  const primaryFile = Array.isArray(firstVersion?.files) ? firstVersion.files.find((f: any) => f?.primary) || firstVersion.files[0] : undefined;
  const previewImage = Array.isArray(firstVersion?.images) ? firstVersion.images[0]?.url : undefined;
  return {
    id: m?.id,
    name: m?.name,
    type: m?.type,
    tags: Array.isArray(m?.tags) ? m.tags.map((t: any) => typeof t === 'string' ? t : t?.name).filter(Boolean) : [],
    creator: {
      username: m?.creator?.username,
      image: m?.creator?.image,
    },
    stats: m?.stats ? {
      downloadCount: m.stats.downloadCount,
      favoriteCount: m.stats.favoriteCount,
      ratingCount: m.stats.ratingCount,
      rating: m.stats.rating,
    } : undefined,
    primaryVersion: firstVersion ? {
      id: firstVersion.id,
      name: firstVersion.name,
      baseModel: firstVersion.baseModel,
      trainedWords: firstVersion.trainedWords,
      files: firstVersion.files,
      images: firstVersion.images,
    } : undefined,
    links: {
      modelUrl: m?.id ? `https://civitai.com/models/${m.id}` : undefined,
      downloadUrl: primaryFile?.downloadUrl,
      previewImageUrl: previewImage,
    },
  };
}

export async function civitaiSearchModels(params: CivitaiSearchModelsParams) {
  try {
    const parsed = civitaiSearchModelsParams.safeParse(params);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message } }) }]
      };
    }
    const input = parsed.data;

    const limit = input.limit ?? 20;
    // Determine applied base model (only the first will be used)
    const normalizedBaseModels = normalizeBaseModels(input.base_models);
    const appliedBaseModel = normalizedBaseModels && normalizedBaseModels.length > 0 ? normalizedBaseModels[0] : undefined;
    // Resolve pagination strategy
    const queryMode = Boolean(input.query);
    let page = 1;
    let cursorVal: string | undefined;
    if (queryMode) {
      const decodedC = decodeCursor<{ cursor: string }>(input.cursor);
      cursorVal = decodedC?.cursor;
    } else {
      const decodedP = decodeCursor<{ page: number }>(input.cursor);
      page = decodedP?.page || input.page || 1;
    }

    const qs = buildQuery({ ...input, page, limit, cursorVal });
    const url = `https://civitai.com/api/v1/models?${qs}`;

    const res = await fetch(url);
    if (!res.ok) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'HTTP_ERROR', status: res.status, url } }) }]
      };
    }
    const json: any = await res.json();
    const items: any[] = Array.isArray(json?.items) ? json.items : (Array.isArray(json?.data) ? json.data : json);
    const models = Array.isArray(items) ? items.map(normalizeModel) : [];

    // Determine next cursor
    let nextCursor: string | undefined;
    let hasMore = false;
    if (queryMode) {
      const nextRaw = (json?.metadata?.nextCursor ?? json?.nextCursor) as any;
      if (nextRaw != null) {
        hasMore = true;
        nextCursor = Buffer.from(JSON.stringify({ v: 1, k: { cursor: String(nextRaw) } }), 'utf8').toString('base64');
      }
    } else {
      hasMore = models.length >= limit;
      nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, k: { page: page + 1 } }), 'utf8').toString('base64') : undefined;
    }

    const pageResponse = composeSinglePageResponse(models, {
      requestedMeta: queryMode ? { cursor: cursorVal, limit, url } : { page, limit, url },
      pageTokenBudget: 15_000,
      nextCursor, // not used by composer, we will override below
    } as any);

    // Override with our page-based cursor
    pageResponse.meta.next_cursor = nextCursor;
    pageResponse.meta.has_more = Boolean(nextCursor);

    // Inject explicit meta for applied base model and warnings when multiple provided
    const warnings: string[] = Array.isArray(pageResponse.meta.warnings) ? [...(pageResponse.meta.warnings as string[])] : [];
    if (Array.isArray(input.base_models) && input.base_models.length > 1) {
      warnings.push('Multiple base models provided; only the first was used.');
    }
    if (warnings.length) {
      (pageResponse.meta as any).warnings = warnings;
    }
    if (appliedBaseModel) {
      (pageResponse.meta as any).applied_base_model = appliedBaseModel;
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ data: pageResponse.data, meta: { ok: true, ...pageResponse.meta } }) }]
    };
  } catch (e: any) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'UNEXPECTED_ERROR', message: e?.message || String(e) } }) }]
    };
  }
}


