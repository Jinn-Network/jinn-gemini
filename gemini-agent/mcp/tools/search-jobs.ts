import { z } from 'zod';
import fetch from 'cross-fetch';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';
import { resolveRequestIpfsContent } from './shared/ipfs.js';

const base = z.object({
  query: z.string().min(1).describe('Case-insensitive text to match against job name and description.'),
  cursor: z.string().optional().describe('Opaque cursor for pagination.'),
  resolve_ipfs: z.boolean().optional().default(true).describe('If true, resolve and embed IPFS content for requests.'),
});

export const searchJobsParams = base;
export type SearchJobsParams = z.infer<typeof searchJobsParams>;

export const searchJobsSchema = {
  description: 'Search job definitions by name/description. Returns lightweight rows with pagination.',
  inputSchema: searchJobsParams.shape,
};

export async function searchJobs(params: SearchJobsParams) {
  try {
    const parsed = searchJobsParams.safeParse(params);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message } }) }]
      };
    }

    const { query, cursor, resolve_ipfs } = parsed.data;
    const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };

    // Use Ponder GraphQL to search requests by id/mech/sender substring
    const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
    const gql = `query Search($q: String!, $limit: Int!) {
      requests(where: { OR: [
        { id_contains: $q }, { mech_contains: $q }, { sender_contains: $q }
      ] }, orderBy: "blockTimestamp", orderDirection: "desc", limit: $limit) {
        items { id mech sender ipfsHash blockTimestamp delivered }
      }
    }`;
    const variables = { q: query, limit: 50 };
    const res = await fetch(PONDER_GRAPHQL_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: gql, variables })
    });
    const json = await res.json();
    const items = json?.data?.requests?.items || [];
    let sliced = items.slice(keyset.offset, keyset.offset + 50);

    // Optionally resolve IPFS content for each item
    if (resolve_ipfs) {
      sliced = await Promise.all(
        sliced.map(async (it: any) => {
          try {
            if (it?.ipfsHash) {
              const ipfsContent = await resolveRequestIpfsContent(it.ipfsHash, 10000);
              return { ...it, ipfsContent };
            }
          } catch {}
          return it;
        })
      );
    }

    const composed = composeSinglePageResponse(sliced, {
      startOffset: keyset.offset,
      truncateChars: 2000,
      perFieldMaxChars: 10000,
      requestedMeta: { cursor, query, resolve_ipfs }
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: { ok: true, ...composed.meta, source: 'ponder' } }) }] };
  } catch (e: any) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'UNEXPECTED_ERROR', message: e?.message || String(e) } }) }]
    };
  }
}


