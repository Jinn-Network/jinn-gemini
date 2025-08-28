import { z } from 'zod';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';

type ImageStats = {
  cryCount: number;
  laughCount: number;
  likeCount: number;
  dislikeCount: number;
  heartCount: number;
  commentCount: number;
};

type ImageItem = {
  id: number;
  url?: string;
  width?: number;
  height?: number;
  nsfw?: boolean;
  nsfwLevel?: string;
  createdAt?: string;
  postId?: number;
  username?: string;
  stats?: Partial<ImageStats>;
  meta?: Record<string, any> | null;
};

export const civitaiGetImageStatsParams = z.object({
  post_ids: z.array(z.number().int().positive()).min(1).describe('One or more Civitai post IDs'),
  // Optional context/output controls
  cursor: z.string().optional().describe('Opaque cursor for paginating results across posts'),
  page_token_budget: z.number().int().positive().optional().describe('Token budget for the page (default: 15k)'),
  truncate_chars: z.number().int().nonnegative().optional().describe('Default truncation for string fields (default: 200)'),
  per_field_max_chars: z.number().int().positive().optional().describe('Hard clamp for any string field (default: 4k)'),
  // Optional API knobs (not required). Kept optional to honor "only post_ids required".
  api_limit: z.number().int().min(1).max(200).optional().describe('Per-request limit when fetching images (default: 200)'),
  page_cap: z.number().int().min(1).optional().describe('Safety cap on pages fetched per post (default: 25)'),
});

export type CivitaiGetImageStatsParams = z.infer<typeof civitaiGetImageStatsParams>;

export const civitaiGetImageStatsSchema = {
  description: 'Get image performance stats for one or more Civitai post IDs. Aggregates reactions/comments per post and paginates across posts using a context-managed page.',
  inputSchema: civitaiGetImageStatsParams.shape,
};

function sumStats(images: ImageItem[]): ImageStats {
  const zero: ImageStats = { cryCount: 0, laughCount: 0, likeCount: 0, dislikeCount: 0, heartCount: 0, commentCount: 0 };
  for (const img of images) {
    const s = img.stats || {};
    zero.cryCount += s.cryCount || 0;
    zero.laughCount += s.laughCount || 0;
    zero.likeCount += s.likeCount || 0;
    zero.dislikeCount += s.dislikeCount || 0;
    zero.heartCount += s.heartCount || 0;
    zero.commentCount += s.commentCount || 0;
  }
  return zero;
}

async function fetchImagesForPost(postId: number, limit: number, pageCap: number): Promise<ImageItem[]> {
  const all: ImageItem[] = [];
  let page = 1;
  let pagesFetched = 0;
  while (pagesFetched < pageCap) {
    const url = `https://civitai.com/api/v1/images?limit=${encodeURIComponent(String(limit))}&postId=${encodeURIComponent(String(postId))}&page=${encodeURIComponent(String(page))}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const json: any = await res.json();
    const items: any[] = Array.isArray(json?.items) ? json.items : [];
    for (const m of items) {
      all.push({
        id: m?.id,
        url: m?.url,
        width: m?.width,
        height: m?.height,
        nsfw: m?.nsfw,
        nsfwLevel: m?.nsfwLevel,
        createdAt: m?.createdAt,
        postId: m?.postId,
        username: m?.username,
        stats: m?.stats,
        meta: m?.meta ?? null,
      });
    }
    pagesFetched++;
    const nextPageUrl: string | undefined = json?.metadata?.nextPage;
    if (!nextPageUrl || items.length < limit) break;
    page += 1;
  }
  return all;
}

export async function civitaiGetImageStats(params: CivitaiGetImageStatsParams) {
  try {
    const parsed = civitaiGetImageStatsParams.safeParse(params);
    if (!parsed.success) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          data: [],
          meta: {
            ok: false,
            code: 'VALIDATION_ERROR',
            message: parsed.error.message,
            details: parsed.error.flatten?.() ?? undefined,
          }
        }) }]
      };
    }

    const input = parsed.data;
    const apiLimit = input.api_limit ?? 200;
    const pageCap = input.page_cap ?? 25;

    const cursor = decodeCursor<{ offset: number }>(input.cursor);
    const startOffset = cursor?.offset ?? 0;

    // Fetch per-post aggregates
    const perPostResults: any[] = [];
    for (const postId of input.post_ids) {
      const images = await fetchImagesForPost(postId, apiLimit, pageCap);
      const totals = sumStats(images);
      const byLikes = [...images].sort((a, b) => (b.stats?.likeCount || 0) - (a.stats?.likeCount || 0));
      const byHearts = [...images].sort((a, b) => (b.stats?.heartCount || 0) - (a.stats?.heartCount || 0));
      perPostResults.push({
        post_id: postId,
        totals,
        counts: { images: images.length },
        highlights: {
          top_like: byLikes[0]?.id ? { id: byLikes[0].id, url: byLikes[0].url, likeCount: byLikes[0].stats?.likeCount || 0 } : undefined,
          top_heart: byHearts[0]?.id ? { id: byHearts[0].id, url: byHearts[0].url, heartCount: byHearts[0].stats?.heartCount || 0 } : undefined,
        },
        images,
      });
    }

    // Compose a single page across posts
    const pageResponse = composeSinglePageResponse(perPostResults, {
      startOffset,
      pageTokenBudget: input.page_token_budget ?? 15_000,
      truncateChars: input.truncate_chars ?? 200,
      perFieldMaxChars: input.per_field_max_chars ?? 4_000,
      requestedMeta: {
        post_ids: input.post_ids,
        api_limit: apiLimit,
        page_cap: pageCap,
        endpoint: 'https://civitai.com/api/v1/images',
      },
    });

    return {
      content: [{ type: 'text', text: JSON.stringify({
        data: pageResponse.data,
        meta: { ok: true, ...pageResponse.meta }
      }) }]
    };
  } catch (e: any) {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        data: [],
        meta: { ok: false, code: 'UNEXPECTED_ERROR', message: e?.message || String(e) }
      }) }]
    };
  }
}


