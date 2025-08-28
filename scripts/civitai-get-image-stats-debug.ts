#!/usr/bin/env tsx
import 'dotenv/config';

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

type Args = {
  postIds: number[];
  limit?: number; // per-page limit for API (1..200)
  pageCap?: number; // safety cap on pages per post
};

function parseArgs(argv: string[]): Args {
  const out: Args = { postIds: [], limit: 200, pageCap: 25 };
  const map: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      (map[key] ||= []).push('true');
    } else {
      i++;
      (map[key] ||= []).push(next);
    }
  }
  const singles = (map['post-id'] || []).map(Number).filter(n => Number.isFinite(n));
  const listStr = (map['post-ids'] || [])[0];
  const list = listStr ? listStr.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n)) : [];
  out.postIds = [...new Set([...singles, ...list])];
  if (map['limit']?.[0]) out.limit = Math.min(200, Math.max(1, Number(map['limit'][0]) || 100));
  if (map['page-cap']?.[0]) out.pageCap = Math.max(1, Number(map['page-cap'][0]) || 25);
  return out;
}

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
    if (!res.ok) {
      // stop on error; return what we have
      break;
    }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.postIds.length) {
    console.error('Usage: tsx scripts/civitai-get-image-stats-debug.ts --post-ids <id1,id2,...> [--limit 200] [--page-cap 25]');
    process.exit(2);
  }

  const results: any[] = [];
  for (const postId of args.postIds) {
    const images = await fetchImagesForPost(postId, args.limit || 100, args.pageCap || 25);
    const totals = sumStats(images);
    // Determine top performing images by likes and hearts as a simple signal
    const byLikes = [...images].sort((a, b) => (b.stats?.likeCount || 0) - (a.stats?.likeCount || 0));
    const byHearts = [...images].sort((a, b) => (b.stats?.heartCount || 0) - (a.stats?.heartCount || 0));
    results.push({
      post_id: postId,
      totals,
      counts: {
        images: images.length,
      },
      highlights: {
        top_like: byLikes[0]?.id ? { id: byLikes[0].id, url: byLikes[0].url, likeCount: byLikes[0].stats?.likeCount || 0 } : undefined,
        top_heart: byHearts[0]?.id ? { id: byHearts[0].id, url: byHearts[0].url, heartCount: byHearts[0].stats?.heartCount || 0 } : undefined,
      },
      images,
    });
  }

  const output = {
    meta: {
      ok: true,
      requested: {
        post_ids: args.postIds,
        limit: args.limit,
        page_cap: args.pageCap,
        endpoint: 'https://civitai.com/api/v1/images',
      },
    },
    data: results,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ meta: { ok: false, code: 'UNEXPECTED_ERROR', message: e?.message || String(e) } }, null, 2));
  process.exit(1);
});


