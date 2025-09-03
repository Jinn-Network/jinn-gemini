#!/usr/bin/env tsx
import 'dotenv/config';

type Args = {
  query?: string;
  username?: string;
  tag?: string;
  types?: string[];
  baseModel?: string;
  sort?: 'Most Downloaded' | 'Highest Rated' | 'Newest';
  period?: 'AllTime' | 'Year' | 'Month' | 'Week' | 'Day';
  limit?: number;
  page?: number;
  cursor?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  const arr: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      arr[key] = ['true'];
    } else {
      i++;
      if (key === 'types') {
        const values = (arr[key] || []);
        values.push(next);
        arr[key] = values;
      } else {
        arr[key] = [next];
      }
    }
  }
  if (arr['query']) out.query = arr['query'][0];
  if (arr['username']) out.username = arr['username'][0];
  if (arr['tag']) out.tag = arr['tag'][0];
  if (arr['types']) out.types = arr['types'];
  if (arr['base-model']) out.baseModel = arr['base-model'][0];
  if (arr['sort']) out.sort = arr['sort'][0] as any;
  if (arr['period']) out.period = arr['period'][0] as any;
  if (arr['limit']) out.limit = Number(arr['limit'][0]);
  if (arr['page']) out.page = Number(arr['page'][0]);
  if (arr['cursor']) out.cursor = arr['cursor'][0];
  return out;
}

function mapSort(val?: string): string | undefined {
  if (!val) return undefined;
  switch (val) {
    case 'Most Downloaded': return 'Most Downloaded';
    case 'Highest Rated': return 'Highest Rated';
    case 'Newest': return 'Newest';
    default: return val;
  }
}

function normalizeBaseModel(value?: string): string | undefined {
  if (!value) return undefined;
  const map: Record<string, string> = {
    'sdxl': 'SDXL 1.0', 'sdxl1.0': 'SDXL 1.0', 'sdxl10': 'SDXL 1.0', 'sdxl 1.0': 'SDXL 1.0',
    'sd 1.5': 'SD 1.5', 'sd1.5': 'SD 1.5', '1.5': 'SD 1.5', 'sd15': 'SD 1.5',
    'sd 2.1': 'SD 2.1', 'sd2.1': 'SD 2.1', '2.1': 'SD 2.1', 'sd21': 'SD 2.1',
    'pony': 'Pony', 'ponyxl': 'Pony',
    'illustrious': 'Illustrious', 'illustrious xl': 'Illustrious',
  };
  const allowed = new Set(['SD 1.5','SDXL 1.0','SD 2.1','Pony','Illustrious']);
  const key = String(value).trim().toLowerCase();
  const mapped = map[key] || value;
  return allowed.has(mapped) ? mapped : undefined;
}

function decodeCursor(cursor?: string): { page?: number; cursor?: string } | undefined {
  if (!cursor) return undefined;
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed.k as any;
  } catch { return undefined; }
}

function buildQuery(params: (Required<Pick<Args, 'limit'>> & Args & { page?: number; cursorVal?: string })): string {
  const q = new URLSearchParams();
  q.set('limit', String(params.limit));
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
  const baseModel = normalizeBaseModel(params.baseModel);
  if (baseModel) q.set('baseModels', baseModel);
  const sort = mapSort(params.sort);
  if (sort) q.set('sort', sort);
  if (params.period) q.set('period', params.period);
  return q.toString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const decoded = decodeCursor(args.cursor);
  const queryMode = Boolean(args.query);
  const page = queryMode ? 1 : (decoded?.page || args.page || 1);
  const limit = args.limit ?? 10;
  const cursorVal = queryMode ? decoded?.cursor : undefined;
  const qs = buildQuery({ ...args, page, limit, cursorVal } as any);
  const url = `https://civitai.com/api/v1/models?${qs}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(JSON.stringify({ data: [], meta: { ok: false, code: 'HTTP_ERROR', status: res.status, url } }, null, 2));
    process.exit(1);
  }
  const json: any = await res.json();
  const items: any[] = Array.isArray(json?.items) ? json.items : (Array.isArray(json?.data) ? json.data : json);

  let nextCursor: string | undefined;
  let hasMore = false;
  if (queryMode) {
    const nextRaw = (json?.metadata?.nextCursor ?? json?.nextCursor) as any;
    if (nextRaw != null) {
      hasMore = true;
      nextCursor = Buffer.from(JSON.stringify({ v: 1, k: { cursor: String(nextRaw) } }), 'utf8').toString('base64');
    }
  } else {
    hasMore = Array.isArray(items) && items.length >= limit;
    nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, k: { page: page + 1 } }), 'utf8').toString('base64') : undefined;
  }
  const requested = queryMode ? { cursor: cursorVal, limit, url } : { page, limit, url };
  console.log(JSON.stringify({ data: items, meta: { ok: true, requested, has_more: Boolean(nextCursor), next_cursor: nextCursor } }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ data: [], meta: { ok: false, code: 'UNEXPECTED_ERROR', message: e?.message || String(e) } }, null, 2));
  process.exit(1);
});


