#!/usr/bin/env tsx
import 'dotenv/config';
import { composeSinglePageResponse, decodeCursor } from '../gemini-agent/mcp/tools/shared/context-management.ts';

type Args = {
  id?: number;
  cursor?: string;
  page_token_budget?: number;
  truncate_chars?: number;
  per_field_max_chars?: number;
  image_limit_per_version?: number;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  const map: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      map[key] = 'true';
    } else {
      i++; map[key] = next;
    }
  }
  if (map['id']) out.id = Number(map['id']);
  if (map['cursor']) out.cursor = map['cursor'];
  if (map['page-token-budget']) out.page_token_budget = Number(map['page-token-budget']);
  if (map['truncate-chars']) out.truncate_chars = Number(map['truncate-chars']);
  if (map['per-field-max-chars']) out.per_field_max_chars = Number(map['per-field-max-chars']);
  if (map['image-limit-per-version']) out.image_limit_per_version = Number(map['image-limit-per-version']);
  return out;
}

function normalizeModel(json: any, imageLimit: number) {
  const tags: string[] = Array.isArray(json?.tags)
    ? json.tags.map((t: any) => typeof t === 'string' ? t : (t?.name ?? t)).filter(Boolean)
    : [];
  const versions = Array.isArray(json?.modelVersions) ? json.modelVersions : [];
  const normVersions = versions.map((v: any) => {
    const files = Array.isArray(v?.files) ? v.files.map((f: any) => ({
      id: f?.id,
      name: f?.name,
      type: f?.type,
      sizeKB: f?.sizeKB,
      primary: Boolean(f?.primary),
      downloadUrl: f?.downloadUrl,
      hashes: f?.hashes
    })) : [];
    const images = (Array.isArray(v?.images) ? v.images : []).slice(0, imageLimit).map((im: any) => ({
      id: im?.id,
      url: im?.url,
      width: im?.width,
      height: im?.height,
      nsfwLevel: im?.nsfwLevel,
      hash: im?.hash,
    }));
    return {
      id: v?.id,
      name: v?.name,
      baseModel: v?.baseModel,
      publishedAt: v?.publishedAt,
      trainedWords: Array.isArray(v?.trainedWords) ? v.trainedWords : [],
      files,
      images,
    };
  });

  return {
    id: json?.id,
    name: json?.name,
    type: json?.type,
    description: typeof json?.description === 'string' ? json.description : undefined,
    tags,
    creator: { username: json?.creator?.username, image: json?.creator?.image },
    stats: json?.stats ? {
      downloadCount: json.stats.downloadCount,
      favoriteCount: json.stats.favoriteCount,
      ratingCount: json.stats.ratingCount,
      rating: json.stats.rating,
    } : undefined,
    links: { modelUrl: json?.id ? `https://civitai.com/models/${json.id}` : undefined },
    versions: normVersions
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id || Number.isNaN(args.id)) {
    console.error(JSON.stringify({ data: [], meta: { ok: false, code: 'VALIDATION_ERROR', message: 'Missing --id <number>' } }, null, 2));
    process.exit(1);
  }

  const url = `https://civitai.com/api/v1/models/${args.id}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(JSON.stringify({ data: [], meta: { ok: false, code: 'HTTP_ERROR', status: res.status, source_url: url } }, null, 2));
    process.exit(1);
  }
  const json: any = await res.json();

  const imageLimit = args.image_limit_per_version ?? 10;
  const normalized = normalizeModel(json, imageLimit);

  const allVersions = Array.isArray(normalized.versions) ? normalized.versions : [];
  const decoded = decodeCursor<{ offset: number }>(args.cursor);
  const startOffset = Number(decoded?.offset || 0);

  const page = composeSinglePageResponse(allVersions, {
    startOffset,
    pageTokenBudget: args.page_token_budget ?? 15_000,
    truncateChars: args.truncate_chars ?? 200,
    perFieldMaxChars: args.per_field_max_chars ?? 4_000,
    requestedMeta: { id: args.id, source_url: url }
  });

  const out = {
    data: { ...normalized, versions: page.data },
    meta: { ok: true, ...page.meta }
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ data: [], meta: { ok: false, code: 'UNEXPECTED_ERROR', message: e?.message || String(e) } }, null, 2));
  process.exit(1);
});


