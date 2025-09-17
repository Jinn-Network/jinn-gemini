import { supabase } from './shared/supabase.js';
import fetch from 'cross-fetch';
import { z } from 'zod';
import { tableNames } from './shared/types.js';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';

// MCP registration schema (permissive) to avoid -32602 pre-validation failures.
// We normalize and strictly validate inside the handler.
const getDetailsBase = z.object({
    ids: z.any(),
    cursor: z.string().optional().describe('Opaque cursor for fetching the next page of results.'),
    descendants: z.boolean().optional().describe('If true and an id is a job definition (jobs.id), include related items for descendant job definitions.'),
});

// Strict internal schema used by the handler after normalization
export const getDetailsParams = z.object({
    ids: z.array(z.string().uuid()).describe('An array containing one or more UUIDs to retrieve. If empty, returns an empty result.'),
    cursor: z.string().optional().describe('Opaque cursor for fetching the next page of results.'),
    descendants: z.boolean().optional().describe('If true and an id is a job definition (jobs.id), include related items for descendant job definitions.'),
});

export type GetDetailsParams = z.infer<typeof getDetailsParams>;

export const getDetailsSchema = {
    description: 'Retrieves one or more records by ID by automatically searching across all tables in the system.',
    // Expose the permissive base to MCP to prevent -32602; validate strictly in handler
    inputSchema: getDetailsBase.shape,
};

export async function getDetails(params: GetDetailsParams) {
    try {
        // First normalize permissive inputs (string or array) into the strict shape
        const raw: any = params ?? {};
        let { ids, cursor, descendants } = raw as { ids: any; cursor?: string; descendants?: boolean };
        if (typeof ids === 'string') {
            ids = [ids];
        }
        // If ids is missing, allow empty array (handled below)
        if (ids === undefined || ids === null) {
            ids = [];
        }

        // Use safeParse with strict schema after normalization to avoid exceptions
        const parseResult = getDetailsParams.safeParse({ ids, cursor, descendants });
        if (!parseResult.success) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ ok: false, code: 'VALIDATION_ERROR', message: `Invalid parameters: ${parseResult.error.message}`, details: parseResult.error.flatten?.() ?? undefined }, null, 2)
                }]
            };
        }
        const { ids: validIds, cursor: validCursor, descendants: includeDescendants } = parseResult.data as { ids: string[]; cursor?: string; descendants?: boolean };
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

        // If IDs look like on-chain request IDs (0x...), fetch from Ponder
        const onchainIds = (validIds || []).filter((x) => typeof x === 'string' && x.startsWith('0x')) as string[];
        const onchainRecords: any[] = [];
        if (onchainIds.length > 0) {
            const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
            for (const id of onchainIds) {
                try {
                    const res = await fetch(PONDER_GRAPHQL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `query($id: String!) { request(id: $id) { id mech sender ipfsHash blockTimestamp delivered } }`, variables: { id } }) });
                    const json = await res.json();
                    const r = json?.data?.request;
                    if (r) onchainRecords.push({ ...r, _source_table: 'ponder_request' });
                } catch {}
            }
        }

        // Search across legacy tables (kept for hybrid support)
        const searchPromises = tableNames.map(async (table) => {
            try {
                const { data, error } = await supabase
                    .from(table)
                    .select('*')
                    .in('id', validIds);
                
                if (error) {
                    // Silently handle table search errors - return empty array
                    return [];
                }
                
                // Add table name to each record for identification
                return (data || []).map(record => ({
                    ...record,
                    _source_table: table
                }));
            } catch (e) {
                // Silently handle table search failures - return empty array
                return [];
            }
        });

        const results = await Promise.all(searchPromises);
        const allRecords: any[] = onchainRecords.concat(results.flat());

        // Build a map from id -> indices to allow in-place augmentation
        const idToIndexes = new Map<string, number[]>();
        for (let i = 0; i < allRecords.length; i++) {
            const rec = allRecords[i];
            const recId = rec?.id as string | undefined;
            if (!recId) continue;
            const arr = idToIndexes.get(recId) ?? [];
            arr.push(i);
            idToIndexes.set(recId, arr);
        }

        // Auto-detect job runs vs job definitions
        const [jobRunsRes, jobDefsRes] = await Promise.all([
            supabase.from('job_board').select('id').in('id', validIds),
            supabase.from('jobs').select('id').in('id', validIds)
        ]);
        const jobRunIds = new Set<string>((jobRunsRes.data || []).map((r: any) => r.id));
        const jobDefIds = new Set<string>((jobDefsRes.data || []).map((r: any) => r.id));

        // Helper to safely query and return [] on error (accepts builder or promise)
        const safeQuery = async <T = any>(fn: () => any): Promise<T[]> => {
            try {
                const res = await fn();
                const data = (res && 'data' in res) ? (res as any).data : null;
                const error = (res && 'error' in res) ? (res as any).error : null;
                if (error) return [];
                return (data || []) as T[];
            } catch {
                return [];
            }
        };

        // =============== JOB RUN RELATED (by job_id) ===============
        const jobRunIdList = Array.from(jobRunIds);
        let jrArtifacts: any[] = [];
        let jrMessages: any[] = [];
        let jrMemories: any[] = [];
        let jrReports: any[] = [];
        if (jobRunIdList.length > 0) {
            [jrArtifacts, jrMessages, jrMemories, jrReports] = await Promise.all([
                safeQuery(() => supabase.from('artifacts').select('id, topic, created_at, job_id').in('job_id', jobRunIdList)),
                safeQuery(() => supabase.from('messages').select('id, status, created_at, job_id').in('job_id', jobRunIdList)),
                safeQuery(() => supabase.from('memories').select('id, created_at, job_id').in('job_id', jobRunIdList)),
                safeQuery(() => supabase.from('job_reports').select('id, status, created_at, job_id').in('job_id', jobRunIdList)),
            ]);
        }

        const jrArtifactsByJob = new Map<string, any[]>();
        const jrMessagesByJob = new Map<string, any[]>();
        const jrMemoriesByJob = new Map<string, any[]>();
        const jrReportsByJob = new Map<string, any[]>();
        for (const a of jrArtifacts) {
            const k = a.job_id as string; if (!jrArtifactsByJob.has(k)) jrArtifactsByJob.set(k, []); jrArtifactsByJob.get(k)!.push({ id: a.id, topic: a.topic, created_at: a.created_at });
        }
        for (const m of jrMessages) {
            const k = m.job_id as string; if (!jrMessagesByJob.has(k)) jrMessagesByJob.set(k, []); jrMessagesByJob.get(k)!.push({ id: m.id, status: m.status, created_at: m.created_at });
        }
        for (const mm of jrMemories) {
            const k = mm.job_id as string; if (!jrMemoriesByJob.has(k)) jrMemoriesByJob.set(k, []); jrMemoriesByJob.get(k)!.push({ id: mm.id, created_at: mm.created_at });
        }
        for (const r of jrReports) {
            const k = r.job_id as string; if (!jrReportsByJob.has(k)) jrReportsByJob.set(k, []); jrReportsByJob.get(k)!.push({ id: r.id, status: r.status, created_at: r.created_at });
        }

        // =============== JOB DEFINITION RELATED (by parent_job_definition_id) ===============
        const jobDefIdList = Array.from(jobDefIds);
        let jdArtifacts: any[] = [];
        let jdMessages: any[] = [];
        let jdMemories: any[] = [];
        let jdReports: any[] = [];
        let jdJobBoard: any[] = [];

        const includeDesc = Boolean(includeDescendants);
        const descendantDepth = new Map<string, number>(); // job_def_id -> depth
        let allDescendants: string[] = [];
        if (includeDesc && jobDefIdList.length > 0) {
            const visited = new Set<string>(jobDefIdList);
            let frontier = jobDefIdList.slice();
            let depth = 0;
            while (frontier.length > 0) {
                depth++;
                const children = await safeQuery(() => supabase
                    .from('jobs')
                    .select('id, parent_job_definition_id')
                    .in('parent_job_definition_id', frontier)
                );
                const next: string[] = [];
                for (const c of children) {
                    const cid = (c as any).id as string;
                    if (visited.has(cid)) continue;
                    visited.add(cid);
                    descendantDepth.set(cid, depth);
                    next.push(cid);
                }
                allDescendants = allDescendants.concat(next);
                frontier = next;
            }
        }

        if (jobDefIdList.length > 0) {
            [jdArtifacts, jdMessages, jdMemories, jdReports, jdJobBoard] = await Promise.all([
                safeQuery(() => supabase.from('artifacts').select('id, topic, created_at, parent_job_definition_id').in('parent_job_definition_id', jobDefIdList)),
                safeQuery(() => supabase.from('messages').select('id, status, created_at, parent_job_definition_id').in('parent_job_definition_id', jobDefIdList)),
                safeQuery(() => supabase.from('memories').select('id, created_at, parent_job_definition_id').in('parent_job_definition_id', jobDefIdList)),
                safeQuery(() => supabase.from('job_reports').select('id, status, created_at, parent_job_definition_id').in('parent_job_definition_id', jobDefIdList)),
                safeQuery(() => supabase.from('job_board').select('id, status, created_at, job_name, parent_job_definition_id').in('parent_job_definition_id', jobDefIdList)),
            ]);
        }

        let dArtifacts: any[] = [];
        let dMessages: any[] = [];
        let dMemories: any[] = [];
        let dReports: any[] = [];
        let dJobBoard: any[] = [];
        if (includeDesc && allDescendants.length > 0) {
            [dArtifacts, dMessages, dMemories, dReports, dJobBoard] = await Promise.all([
                safeQuery(() => supabase.from('artifacts').select('id, topic, created_at, parent_job_definition_id').in('parent_job_definition_id', allDescendants)),
                safeQuery(() => supabase.from('messages').select('id, status, created_at, parent_job_definition_id').in('parent_job_definition_id', allDescendants)),
                safeQuery(() => supabase.from('memories').select('id, created_at, parent_job_definition_id').in('parent_job_definition_id', allDescendants)),
                safeQuery(() => supabase.from('job_reports').select('id, status, created_at, parent_job_definition_id').in('parent_job_definition_id', allDescendants)),
                safeQuery(() => supabase.from('job_board').select('id, status, created_at, job_name, parent_job_definition_id').in('parent_job_definition_id', allDescendants)),
            ]);
        }

        // Group direct job def results
        const jdArtifactsByDef = new Map<string, any[]>();
        const jdMessagesByDef = new Map<string, any[]>();
        const jdMemoriesByDef = new Map<string, any[]>();
        const jdReportsByDef = new Map<string, any[]>();
        const jdJobBoardByDef = new Map<string, any[]>();
        for (const a of jdArtifacts) {
            const k = a.parent_job_definition_id as string; if (!jdArtifactsByDef.has(k)) jdArtifactsByDef.set(k, []); jdArtifactsByDef.get(k)!.push({ id: a.id, topic: a.topic, created_at: a.created_at });
        }
        for (const m of jdMessages) {
            const k = m.parent_job_definition_id as string; if (!jdMessagesByDef.has(k)) jdMessagesByDef.set(k, []); jdMessagesByDef.get(k)!.push({ id: m.id, status: m.status, created_at: m.created_at });
        }
        for (const mm of jdMemories) {
            const k = mm.parent_job_definition_id as string; if (!jdMemoriesByDef.has(k)) jdMemoriesByDef.set(k, []); jdMemoriesByDef.get(k)!.push({ id: mm.id, created_at: mm.created_at });
        }
        for (const r of jdReports) {
            const k = r.parent_job_definition_id as string; if (!jdReportsByDef.has(k)) jdReportsByDef.set(k, []); jdReportsByDef.get(k)!.push({ id: r.id, status: r.status, created_at: r.created_at });
        }
        for (const jb of jdJobBoard) {
            const k = jb.parent_job_definition_id as string; if (!jdJobBoardByDef.has(k)) jdJobBoardByDef.set(k, []); jdJobBoardByDef.get(k)!.push({ id: jb.id, status: jb.status, created_at: jb.created_at, job_name: jb.job_name });
        }

        // Group descendants results per descendant job def id
        const descArtifactsByDef = new Map<string, any[]>();
        const descMessagesByDef = new Map<string, any[]>();
        const descMemoriesByDef = new Map<string, any[]>();
        const descReportsByDef = new Map<string, any[]>();
        const descJobBoardByDef = new Map<string, any[]>();
        for (const a of dArtifacts) {
            const k = a.parent_job_definition_id as string; if (!descArtifactsByDef.has(k)) descArtifactsByDef.set(k, []); descArtifactsByDef.get(k)!.push({ id: a.id, topic: a.topic, created_at: a.created_at });
        }
        for (const m of dMessages) {
            const k = m.parent_job_definition_id as string; if (!descMessagesByDef.has(k)) descMessagesByDef.set(k, []); descMessagesByDef.get(k)!.push({ id: m.id, status: m.status, created_at: m.created_at });
        }
        for (const mm of dMemories) {
            const k = mm.parent_job_definition_id as string; if (!descMemoriesByDef.has(k)) descMemoriesByDef.set(k, []); descMemoriesByDef.get(k)!.push({ id: mm.id, created_at: mm.created_at });
        }
        for (const r of dReports) {
            const k = r.parent_job_definition_id as string; if (!descReportsByDef.has(k)) descReportsByDef.set(k, []); descReportsByDef.get(k)!.push({ id: r.id, status: r.status, created_at: r.created_at });
        }
        for (const jb of dJobBoard) {
            const k = jb.parent_job_definition_id as string; if (!descJobBoardByDef.has(k)) descJobBoardByDef.set(k, []); descJobBoardByDef.get(k)!.push({ id: jb.id, status: jb.status, created_at: jb.created_at, job_name: jb.job_name });
        }

        // Attach related info to matched records (job runs + job definitions with optional descendants)
        for (const id of validIds) {
            const recordIndexes = idToIndexes.get(id);
            if (!recordIndexes || recordIndexes.length === 0) continue;

            const isJobRun = jobRunIds.has(id);
            const isJobDef = jobDefIds.has(id);

            for (const idx of recordIndexes) {
                const rec = allRecords[idx];
                if (!rec) continue;
                if (isJobRun) {
                    rec.related = {
                        type: 'job_run',
                        artifacts: jrArtifactsByJob.get(id) || [],
                        messages: jrMessagesByJob.get(id) || [],
                        memories: jrMemoriesByJob.get(id) || [],
                        job_reports: jrReportsByJob.get(id) || []
                    };
                } else if (isJobDef) {
                    // Build descendants entries if requested
                    let descEntries: any[] | undefined = undefined;
                    if (includeDesc && descendantDepth.size > 0) {
                        // Query subtree iteratively
                        const subtree: string[] = [];
                        const frontierIds = [id];
                        const seen = new Set<string>([id]);
                        while (frontierIds.length > 0) {
                            const parent = frontierIds.pop()!;
                            // eslint-disable-next-line no-await-in-loop
                            const kids = await safeQuery(() => supabase.from('jobs').select('id').eq('parent_job_definition_id', parent));
                            for (const k of kids) {
                                const kid = (k as any).id as string;
                                if (seen.has(kid)) continue;
                                seen.add(kid);
                                subtree.push(kid);
                                frontierIds.push(kid);
                            }
                        }
                        descEntries = subtree.map(childId => ({
                            job_definition_id: childId,
                            depth: descendantDepth.get(childId) ?? 1,
                            artifacts: (descArtifactsByDef.get(childId) || []),
                            messages: (descMessagesByDef.get(childId) || []),
                            memories: (descMemoriesByDef.get(childId) || []),
                            job_reports: (descReportsByDef.get(childId) || []),
                            job_board: (descJobBoardByDef.get(childId) || [])
                        }));
                    }

                    rec.related = {
                        type: 'job_definition',
                        direct: {
                            artifacts: jdArtifactsByDef.get(id) || [],
                            messages: jdMessagesByDef.get(id) || [],
                            memories: jdMemoriesByDef.get(id) || [],
                            job_reports: jdReportsByDef.get(id) || [],
                            job_board: jdJobBoardByDef.get(id) || []
                        },
                        descendants: includeDesc ? descEntries : undefined
                    };
                }
            }
        }

        const composed = composeSinglePageResponse(allRecords, {
            startOffset: keyset.offset,
            truncateChars: 0,
            requestedMeta: { cursor: validCursor }
        });

        return { content: [{ type: 'text' as const, text: JSON.stringify({ data: composed.data, meta: composed.meta }, null, 2) }] };

    } catch (e: any) {
        return {
            content: [{ type: 'text' as const, text: JSON.stringify({ data: null, meta: { ok: false, code: 'DB_ERROR', message: `Error getting details: ${e.message}` } }, null, 2) }] 
        };
    }
}
