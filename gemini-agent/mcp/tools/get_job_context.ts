import fetch from 'cross-fetch';
import { z } from 'zod';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management';

// MCP registration schema (permissive) to avoid -32602 pre-validation failures
const getJobContextBase = z.object({
    rootJobId: z.string().optional().describe('Starting job ID. If omitted, uses current job context.'),
    maxDepth: z.number().int().min(1).max(5).optional().describe('Maximum hierarchy traversal depth (default: 3, max: 5).'),
    cursor: z.string().optional().describe('Opaque cursor for fetching the next page of results.'),
});

// Strict internal schema used by the handler after normalization
export const getJobContextParams = z.object({
    rootJobId: z.string().optional(),
    maxDepth: z.number().int().min(1).max(5).default(3),
    cursor: z.string().optional(),
});

export type GetJobContextParams = z.infer<typeof getJobContextParams>;

export const getJobContextSchema = {
    description: 'Get lightweight job hierarchy context with references for deeper investigation. Returns job metadata, request IDs, and artifact references without full content.',
    inputSchema: getJobContextBase.shape,
};

interface JobHierarchyItem {
    jobId: string;
    name: string;
    level: number;
    parentJobId: string | null;
    status: 'active' | 'completed' | 'failed' | 'unknown';
    requestIds: string[];
    artifactRefs: {
        id: string;
        name: string;
        topic: string;
        cid: string;
    }[];
}

async function fetchJobHierarchy(rootJobId: string, maxDepth: number): Promise<JobHierarchyItem[]> {
    const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
    const visited = new Set<string>();
    const hierarchy: JobHierarchyItem[] = [];

    async function traverseJob(jobId: string, level: number, parentJobId: string | null): Promise<void> {
        if (level > maxDepth || visited.has(jobId)) {
            return;
        }
        
        visited.add(jobId);

        try {
            // Fetch job definition
            const jobRes = await fetch(PONDER_GRAPHQL_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `query($id: String!) { 
                        jobDefinition(id: $id) { 
                            id name promptContent sourceJobDefinitionId 
                        } 
                    }`,
                    variables: { id: jobId }
                })
            });
            const jobJson = await jobRes.json();
            const job = jobJson?.data?.jobDefinition;
            
            if (!job) {
                return;
            }

            // Fetch requests for this job
            const requestsRes = await fetch(PONDER_GRAPHQL_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `query($jobId: String!) { 
                        requests(where: { sourceJobDefinitionId: { equals: $jobId } }, limit: 100) { 
                            items { 
                                id delivered blockTimestamp 
                            } 
                        } 
                    }`,
                    variables: { jobId }
                })
            });
            const requestsJson = await requestsRes.json();
            const requests = requestsJson?.data?.requests?.items || [];

            // Fetch artifacts for this job
            const artifactsRes = await fetch(PONDER_GRAPHQL_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `query($jobId: String!) { 
                        artifacts(where: { sourceJobDefinitionId: { equals: $jobId } }, limit: 100) { 
                            items { 
                                id name topic cid 
                            } 
                        } 
                    }`,
                    variables: { jobId }
                })
            });
            const artifactsJson = await artifactsRes.json();
            const artifacts = artifactsJson?.data?.artifacts?.items || [];

            // Determine job status based on requests
            let status: 'active' | 'completed' | 'failed' | 'unknown' = 'unknown';
            if (requests.length > 0) {
                const hasDelivered = requests.some((r: any) => r.delivered);
                const hasUndelivered = requests.some((r: any) => !r.delivered);
                
                if (hasDelivered && !hasUndelivered) {
                    status = 'completed';
                } else if (hasUndelivered) {
                    status = 'active';
                }
            }

            // Add to hierarchy
            hierarchy.push({
                jobId,
                name: job.name || 'Unnamed Job',
                level,
                parentJobId,
                status,
                requestIds: requests.map((r: any) => r.id),
                artifactRefs: artifacts.map((a: any) => ({
                    id: a.id,
                    name: a.name,
                    topic: a.topic,
                    cid: a.cid
                }))
            });

            // Fetch child jobs
            const childrenRes = await fetch(PONDER_GRAPHQL_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `query($parentId: String!) { 
                        jobDefinitions(where: { sourceJobDefinitionId: { equals: $parentId } }, limit: 100) { 
                            items { id } 
                        } 
                    }`,
                    variables: { parentId: jobId }
                })
            });
            const childrenJson = await childrenRes.json();
            const children = childrenJson?.data?.jobDefinitions?.items || [];

            // Recursively process children
            for (const child of children) {
                await traverseJob(child.id, level + 1, jobId);
            }

        } catch (error) {
            console.warn(`Failed to fetch job ${jobId} at level ${level}:`, error);
        }
    }

    await traverseJob(rootJobId, 0, null);
    
    // Sort by level first, then by name for consistent ordering
    return hierarchy.sort((a, b) => {
        if (a.level !== b.level) {
            return a.level - b.level;
        }
        return a.name.localeCompare(b.name);
    });
}

export async function getJobContext(params: GetJobContextParams) {
    try {
        // Parse and validate parameters
        const parseResult = getJobContextParams.safeParse(params);
        if (!parseResult.success) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ 
                        ok: false, 
                        code: 'VALIDATION_ERROR', 
                        message: `Invalid parameters: ${parseResult.error.message}` 
                    }, null, 2)
                }]
            };
        }

        const { rootJobId, maxDepth, cursor } = parseResult.data;
        const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };

        // TODO: Get rootJobId from current job context if not provided
        // For now, require it to be specified
        if (!rootJobId) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ 
                        ok: false, 
                        code: 'MISSING_ROOT_JOB', 
                        message: 'rootJobId is required (current job context detection not yet implemented)' 
                    }, null, 2)
                }]
            };
        }

        // Fetch the job hierarchy
        const hierarchy = await fetchJobHierarchy(rootJobId, maxDepth);

        // Use context management for pagination and token budgets
        const composed = composeSinglePageResponse(hierarchy, {
            startOffset: keyset.offset,
            truncateChars: 500, // Moderate truncation for job names/descriptions
            requestedMeta: { 
                cursor, 
                rootJobId, 
                maxDepth,
                totalJobs: hierarchy.length 
            }
        });

        return { 
            content: [{ 
                type: 'text' as const, 
                text: JSON.stringify({ 
                    data: composed.data, 
                    meta: composed.meta 
                }, null, 2) 
            }] 
        };

    } catch (e: any) {
        return {
            content: [{ 
                type: 'text' as const, 
                text: JSON.stringify({ 
                    data: null, 
                    meta: { 
                        ok: false, 
                        code: 'FETCH_ERROR', 
                        message: `Error fetching job context: ${e.message}` 
                    } 
                }, null, 2) 
            }] 
        };
    }
}