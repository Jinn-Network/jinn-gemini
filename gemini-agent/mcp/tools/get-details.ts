// Supabase legacy path removed
import fetch from 'cross-fetch';
import { z } from 'zod';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management';
import { resolveRequestIpfsContent } from './shared/ipfs';

// MCP registration schema (permissive) to avoid -32602 pre-validation failures.
// We normalize and strictly validate inside the handler.
const getDetailsBase = z.object({
    ids: z.any(),
    cursor: z.string().optional().describe('Opaque cursor for fetching the next page of results.'),
    descendants: z.boolean().optional().describe('If true and an id is a job definition (jobs.id), include related items for descendant job definitions.'),
});

// Strict internal schema used by the handler after normalization (on-chain only)
export const getDetailsParams = z.object({
    ids: z.array(z.string()).describe('Array of IDs. 0x-prefixed on-chain request IDs are supported.'),
    cursor: z.string().optional().describe('Opaque cursor for fetching the next page of results.'),
    descendants: z.boolean().optional().describe('No-op in on-chain mode.'),
    resolve_ipfs: z.boolean().optional().default(true).describe('If true, resolve and embed IPFS content for requests.'),
});

export type GetDetailsParams = z.infer<typeof getDetailsParams>;

export const getDetailsSchema = {
    description: 'Retrieves on-chain request and artifact records by ID from the Ponder subgraph (on-chain only).',
    inputSchema: getDetailsBase.shape,
};

export async function getDetails(params: GetDetailsParams) {
    try {
        // First normalize permissive inputs (string or array) into the strict shape
        const raw: any = params ?? {};
        let { ids, cursor, descendants, resolve_ipfs } = raw as { ids: any; cursor?: string; descendants?: boolean, resolve_ipfs?: boolean };
        if (typeof ids === 'string') {
            ids = [ids];
        }
        // If ids is missing, allow empty array (handled below)
        if (ids === undefined || ids === null) {
            ids = [];
        }

        // Use safeParse with strict schema after normalization to avoid exceptions
        const parseResult = getDetailsParams.safeParse({ ids, cursor, descendants, resolve_ipfs });
        if (!parseResult.success) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
                }]
            };
        }
        const { ids: validIds, cursor: validCursor, resolve_ipfs: shouldResolveIpfs } = parseResult.data;
        const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };

        // Handle empty array case
        if (validIds.length === 0) {
            const composed = composeSinglePageResponse([], {
                startOffset: keyset.offset,
                truncateChars: 0,
                requestedMeta: { cursor: validCursor }
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: composed.meta }, null, 2) }] };
        }

        // Partition into request IDs and artifact IDs
        const isRequestId = (s: string) => /^0x[0-9a-fA-F]+$/.test(s);
        const isArtifactId = (s: string) => /^0x[0-9a-fA-F]+:\d+$/.test(s);

        const requestIds = (validIds || []).filter((x) => typeof x === 'string' && isRequestId(x)) as string[];
        const artifactIds = (validIds || []).filter((x) => typeof x === 'string' && isArtifactId(x)) as string[];

        const requestRecords: any[] = [];
        const artifactRecords: any[] = [];

        const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';

        // Fetch requests
        if (requestIds.length > 0) {
            for (const id of requestIds) {
                try {
                    const res = await fetch(PONDER_GRAPHQL_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: `query($id: String!) { request(id: $id) { id mech sender ipfsHash deliveryIpfsHash requestData blockTimestamp delivered } }`,
                            variables: { id }
                        })
                    });
                    const json = await res.json();
                    const r = json?.data?.request;
                    if (r) {
                        const record = { ...r, _source_table: 'ponder_request' } as any;
                        if (shouldResolveIpfs && record.ipfsHash) {
                            record.ipfsContent = await resolveRequestIpfsContent(record.ipfsHash, 10000);
                        }
                        requestRecords.push(record);
                    }
                } catch {}
            }
        }

        // Fetch artifacts
        if (artifactIds.length > 0) {
            for (const id of artifactIds) {
                try {
                    const res = await fetch(PONDER_GRAPHQL_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: `query($id: String!) { artifact(id: $id) { id requestId name topic cid contentPreview } }`,
                            variables: { id }
                        })
                    });
                    const json = await res.json();
                    const a = json?.data?.artifact;
                    if (a) {
                        const record: any = { ...a, _source_table: 'ponder_artifact' };
                        if (shouldResolveIpfs && record.cid) {
                            record.ipfsContent = await resolveRequestIpfsContent(record.cid, 10000);
                        }
                        artifactRecords.push(record);
                    }
                } catch {}
            }
        }

        // Return combined results in the same order as requested IDs, with no truncation (pagination only)
        const requestMap = new Map<string, any>();
        for (const r of requestRecords) requestMap.set(r.id, r);
        const artifactMap = new Map<string, any>();
        for (const a of artifactRecords) artifactMap.set(a.id, a);
        const combined: any[] = [];
        for (const id of validIds) {
            if (isRequestId(id)) {
                const r = requestMap.get(id);
                if (r) combined.push(r);
            } else if (isArtifactId(id)) {
                const a = artifactMap.get(id);
                if (a) combined.push(a);
            }
        }
        const composed = composeSinglePageResponse(combined, {
            startOffset: keyset.offset,
            truncateChars: -1,
            enforceHardFieldClamp: false,
            requestedMeta: { cursor: validCursor, resolve_ipfs: shouldResolveIpfs }
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: composed.meta }, null, 2) }] };

        // Legacy/hybrid path removed. This tool is on-chain only.
        // Any code below this point has been intentionally deleted to prevent fallback to legacy tables.

    } catch (e: any) {
        return {
            content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error getting details: ${e.message}` } }, null, 2) }] 
        };
    }
}
