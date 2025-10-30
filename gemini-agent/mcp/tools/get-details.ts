// Supabase legacy path removed
import fetch from 'cross-fetch';
import { z } from 'zod';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';
import { resolveRequestIpfsContent } from './shared/ipfs.js';

// MCP registration schema (permissive) to avoid -32602 pre-validation failures.
// We normalize and strictly validate inside the handler.
const getDetailsBase = z.object({
    ids: z.union([z.string(), z.array(z.string())]).describe('ID or array of IDs to retrieve. Supports 0x-prefixed request IDs, artifact IDs (requestId:index), and job definition UUIDs.'),
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

        // Partition into request IDs, artifact IDs, and jobDefinition IDs (uuid)
        const isRequestId = (s: string) => /^0x[0-9a-fA-F]+$/.test(s);
        const isArtifactId = (s: string) => /^0x[0-9a-fA-F]+:\d+$/.test(s);
        const isJobDefId = (s: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(s);

        const requestIds = (validIds || []).filter((x) => typeof x === 'string' && isRequestId(x)) as string[];
        const artifactIds = (validIds || []).filter((x) => typeof x === 'string' && isArtifactId(x)) as string[];
        const jobDefIds = (validIds || []).filter((x) => typeof x === 'string' && isJobDefId(x)) as string[];

        const requestRecords: any[] = [];
        const artifactRecords: any[] = [];
        const jobDefRecords: any[] = [];
        const errors: string[] = [];

        const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || `http://localhost:${process.env.PONDER_PORT || '42069'}/graphql`;

        // Fetch requests (and also fetch delivery for each to expose delivery provenance)
        if (requestIds.length > 0) {
            for (const id of requestIds) {
                try {
                    const res = await fetch(PONDER_GRAPHQL_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: `query($id: String!) { request(id: $id) { id mech sender sourceJobDefinitionId sourceRequestId ipfsHash deliveryIpfsHash requestData blockTimestamp delivered } delivery(id: $id) { id sourceJobDefinitionId sourceRequestId } }`,
                            variables: { id }
                        })
                    });
                    if (!res.ok) {
                        errors.push(`request:${id}: HTTP ${res.status}`);
                        continue;
                    }
                    const json = await res.json();
                    if (Array.isArray(json?.errors) && json.errors.length) {
                        errors.push(`request:${id}: ${json.errors.map((e: any) => e?.message || 'Unknown error').join('; ')}`);
                        continue;
                    }
                    const r = json?.data?.request;
                    const d = json?.data?.delivery;
                    if (r) {
                        const record: any = { ...r, _source_table: 'ponder_request' };
                        // Attach delivery provenance if available
                        if (d) {
                            if (d.sourceJobDefinitionId && !record.deliveryJobDefinitionId) {
                                record.deliveryJobDefinitionId = d.sourceJobDefinitionId;
                            }
                            if (d.sourceRequestId && !record.deliverySourceRequestId) {
                                record.deliverySourceRequestId = d.sourceRequestId;
                            }
                        }
                        if (shouldResolveIpfs && record.ipfsHash) {
                            record.ipfsContent = await resolveRequestIpfsContent(record.ipfsHash, 10000);
                        }
                        // Fetch IPFS content for SITUATION artifacts (for recognition analysis)
                        if (shouldResolveIpfs && record.artifacts?.items?.length > 0) {
                            for (const artifact of record.artifacts.items) {
                                if (artifact.type === 'SITUATION' && artifact.cid) {
                                    try {
                                        artifact.ipfsContent = await resolveRequestIpfsContent(artifact.cid, 10000);
                                    } catch (err: any) {
                                        // Silently skip if IPFS fetch fails
                                    }
                                }
                            }
                        }
                        requestRecords.push(record);
                    }
                } catch (error: any) {
                    errors.push(`request:${id}: ${error?.message || String(error)}`);
                }
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
                            query: `query($id: String!) { artifact(id: $id) { id requestId sourceRequestId sourceJobDefinitionId name topic cid contentPreview } }`,
                            variables: { id }
                        })
                    });
                    if (!res.ok) {
                        errors.push(`artifact:${id}: HTTP ${res.status}`);
                        continue;
                    }
                    const json = await res.json();
                    if (Array.isArray(json?.errors) && json.errors.length) {
                        errors.push(`artifact:${id}: ${json.errors.map((e: any) => e?.message || 'Unknown error').join('; ')}`);
                        continue;
                    }
                    const a = json?.data?.artifact;
                    if (a) {
                        const record: any = { ...a, _source_table: 'ponder_artifact' };
                        if (shouldResolveIpfs && record.cid) {
                            record.ipfsContent = await resolveRequestIpfsContent(record.cid, 10000);
                        }
                        artifactRecords.push(record);
                    }
                } catch (error: any) {
                    errors.push(`artifact:${id}: ${error?.message || String(error)}`);
                }
            }
        }

        // Fetch jobDefinitions
        if (jobDefIds.length > 0) {
            for (const id of jobDefIds) {
                try {
                    const res = await fetch(PONDER_GRAPHQL_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            // Align with Ponder schema: include sourceRequestId and sourceJobDefinitionId
                            query: `query($id: String!) { jobDefinition(id: $id) { id name enabledTools promptContent sourceJobDefinitionId sourceRequestId } }`,
                            variables: { id }
                        })
                    });
                    if (!res.ok) {
                        errors.push(`jobDefinition:${id}: HTTP ${res.status}`);
                        continue;
                    }
                    const json = await res.json();
                    if (Array.isArray(json?.errors) && json.errors.length) {
                        errors.push(`jobDefinition:${id}: ${json.errors.map((e: any) => e?.message || 'Unknown error').join('; ')}`);
                        continue;
                    }
                    const j = json?.data?.jobDefinition;
                    if (j) {
                        jobDefRecords.push({ ...j, _source_table: 'ponder_jobDefinition' });
                    }
                } catch (error: any) {
                    errors.push(`jobDefinition:${id}: ${error?.message || String(error)}`);
                }
            }
        }

        // Return combined results in the same order as requested IDs, with no truncation (pagination only)
        const requestMap = new Map<string, any>();
        for (const r of requestRecords) requestMap.set(r.id, r);
        const artifactMap = new Map<string, any>();
        for (const a of artifactRecords) artifactMap.set(a.id, a);
        const jobDefMap = new Map<string, any>();
        for (const j of jobDefRecords) jobDefMap.set(j.id, j);
        const combined: any[] = [];
        for (const id of validIds) {
            if (isRequestId(id)) {
                const r = requestMap.get(id);
                if (r) combined.push(r);
            } else if (isArtifactId(id)) {
                const a = artifactMap.get(id);
                if (a) combined.push(a);
            } else if (isJobDefId(id)) {
                const j = jobDefMap.get(id);
                if (j) combined.push(j);
            }
        }
        const composed = composeSinglePageResponse(combined, {
            startOffset: keyset.offset,
            truncateChars: -1,
            enforceHardFieldClamp: false,
            requestedMeta: { cursor: validCursor, resolve_ipfs: shouldResolveIpfs }
        });
        const meta = errors.length ? { ...composed.meta, errors } : composed.meta;
        return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta }, null, 2) }] };

        // Legacy/hybrid path removed. This tool is on-chain only.
        // Any code below this point has been intentionally deleted to prevent fallback to legacy tables.

    } catch (e: any) {
        return {
            content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error getting details: ${e.message}` } }, null, 2) }] 
        };
    }
}
