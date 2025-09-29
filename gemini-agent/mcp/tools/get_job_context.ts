import fetch from 'cross-fetch';
import { z } from 'zod';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';
import { getCurrentJobContext } from './shared/context.js';
import { mcpLogger } from '../../../worker/logger.js';

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
    // Use source linkage terminology; parentJobId is legacy
    sourceJobDefinitionId: string | null;
    status: 'active' | 'completed' | 'failed' | 'unknown';
    requestIds: string[];
    artifactRefs: {
        id: string;
        name: string;
        topic: string;
        cid: string;
    }[];
    messageRefs: {
        id: string;
        content: string;
        from: string | null;
        blockTimestamp: string;
    }[];
}

interface BatchedJobData {
    jobDefinitions: Array<{
        id: string;
        name: string;
        promptContent?: string;
        sourceJobDefinitionId?: string;
    }>;
    requests: Array<{
        id: string;
        delivered: boolean;
        blockTimestamp: string;
        sourceJobDefinitionId?: string;
    }>;
    artifacts: Array<{
        id: string;
        name: string;
        topic: string;
        cid: string;
        sourceJobDefinitionId?: string;
    }>;
    childJobs: Array<{
        id: string;
        sourceJobDefinitionId?: string;
    }>;
    messages: Array<{
        id: string;
        content: string;
        sourceJobDefinitionId?: string;
        to?: string;
        blockTimestamp: string;
    }>;
}

async function fetchBatchedJobData(jobIds: string[], PONDER_GRAPHQL_URL: string): Promise<BatchedJobData> {
    const batchQuery = `
        query GetBatchedJobData($jobIds: [String!]!) {
            jobDefinitions(where: { id_in: $jobIds }, limit: 1000) {
                items {
                    id
                    name
                    promptContent
                    sourceJobDefinitionId
                }
            }
            requests(where: { sourceJobDefinitionId_in: $jobIds }, limit: 1000) {
                items {
                    id
                    delivered
                    blockTimestamp
                    sourceJobDefinitionId
                }
            }
            artifacts(where: { sourceJobDefinitionId_in: $jobIds }, limit: 1000) {
                items {
                    id
                    name
                    topic
                    cid
                    sourceJobDefinitionId
                }
            }
            childJobs: jobDefinitions(where: { sourceJobDefinitionId_in: $jobIds }, limit: 1000) {
                items {
                    id
                    sourceJobDefinitionId
                }
            }
            messages(where: { to_in: $jobIds }, limit: 1000) {
                items {
                    id
                    content
                    sourceJobDefinitionId
                    to
                    blockTimestamp
                }
            }
        }
    `;

    const res = await fetch(PONDER_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: batchQuery,
            variables: { jobIds }
        })
    });

    if (!res.ok) {
        throw new Error(`GraphQL request failed: HTTP ${res.status}`);
    }

    const json = await res.json();
    if (json.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    return {
        jobDefinitions: json.data?.jobDefinitions?.items || [],
        requests: json.data?.requests?.items || [],
        artifacts: json.data?.artifacts?.items || [],
        childJobs: json.data?.childJobs?.items || [],
        messages: json.data?.messages?.items || []
    };
}

async function fetchJobHierarchy(rootJobId: string, maxDepth: number): Promise<{
    hierarchy: JobHierarchyItem[];
    errors: Array<{jobId: string, level: number, error: string}>;
}> {
    const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
    const visited = new Set<string>();
    const hierarchy: JobHierarchyItem[] = [];
    const errors: Array<{jobId: string, level: number, error: string}> = [];

    // Process jobs level by level using batched queries
    let currentLevel = [{ jobId: rootJobId, level: 0, sourceId: null as string | null }];
    
    while (currentLevel.length > 0 && currentLevel[0].level <= maxDepth) {
        // Filter out already visited jobs
        const newJobs = currentLevel.filter(job => !visited.has(job.jobId));
        if (newJobs.length === 0) break;

        // Mark as visited
        newJobs.forEach(job => visited.add(job.jobId));
        
        const jobIds = newJobs.map(job => job.jobId);
        
        try {
            // Fetch all data for current level in a single batched query
            const batchData = await fetchBatchedJobData(jobIds, PONDER_GRAPHQL_URL);
            
            // Create lookup maps for efficient processing
            const jobDefMap = new Map(batchData.jobDefinitions.map(job => [job.id, job]));
            const requestsByJob = new Map<string, typeof batchData.requests>();
            const artifactsByJob = new Map<string, typeof batchData.artifacts>();
            const childrenByJob = new Map<string, typeof batchData.childJobs>();
            const messagesByJob = new Map<string, typeof batchData.messages>();
            
            // Group related data by job ID
            batchData.requests.forEach(req => {
                if (req.sourceJobDefinitionId) {
                    const existing = requestsByJob.get(req.sourceJobDefinitionId) || [];
                    existing.push(req);
                    requestsByJob.set(req.sourceJobDefinitionId, existing);
                }
            });
            
            batchData.artifacts.forEach(artifact => {
                if (artifact.sourceJobDefinitionId) {
                    const existing = artifactsByJob.get(artifact.sourceJobDefinitionId) || [];
                    existing.push(artifact);
                    artifactsByJob.set(artifact.sourceJobDefinitionId, existing);
                }
            });
            
            batchData.childJobs.forEach(child => {
                if (child.sourceJobDefinitionId) {
                    const existing = childrenByJob.get(child.sourceJobDefinitionId) || [];
                    existing.push(child);
                    childrenByJob.set(child.sourceJobDefinitionId, existing);
                }
            });
            
            batchData.messages.forEach(msg => {
                if (msg.to) {
                    const existing = messagesByJob.get(msg.to) || [];
                    existing.push(msg);
                    messagesByJob.set(msg.to, existing);
                }
            });

            // Process each job in current level
            const nextLevel: Array<{jobId: string, level: number, sourceId: string | null}> = [];
            
            for (const { jobId, level, sourceId } of newJobs) {
                const job = jobDefMap.get(jobId);
                if (!job) {
                    errors.push({ jobId, level, error: 'Job definition not found' });
                    continue;
                }

                const requests = requestsByJob.get(jobId) || [];
                const artifacts = artifactsByJob.get(jobId) || [];
                const children = childrenByJob.get(jobId) || [];

                // Determine job status based on requests
                let status: 'active' | 'completed' | 'failed' | 'unknown' = 'unknown';
                if (requests.length > 0) {
                    const hasDelivered = requests.some(r => r.delivered);
                    const hasUndelivered = requests.some(r => !r.delivered);
                    
                    if (hasDelivered && !hasUndelivered) {
                        status = 'completed';
                    } else if (hasUndelivered) {
                        status = 'active';
                    }
                }

                // Add to hierarchy
                const messages = messagesByJob.get(jobId) || [];
                hierarchy.push({
                    jobId,
                    name: job.name || 'Unnamed Job',
                    level,
                    sourceJobDefinitionId: sourceId,
                    status,
                    requestIds: requests.map(r => r.id),
                    artifactRefs: artifacts.map(a => ({
                        id: a.id,
                        name: a.name,
                        topic: a.topic,
                        cid: a.cid
                    })),
                    messageRefs: messages.map(m => ({
                        id: m.id,
                        content: m.content,
                        from: m.sourceJobDefinitionId || null,
                        blockTimestamp: m.blockTimestamp
                    }))
                });

                // Add children to next level (if not exceeding max depth)
                if (level < maxDepth) {
                    children.forEach(child => {
                        nextLevel.push({
                            jobId: child.id,
                            level: level + 1,
                            sourceId: jobId
                        });
                    });
                }
            }
            
            currentLevel = nextLevel;
            
        } catch (error) {
            // Log batch error and mark all jobs in current level as failed
            newJobs.forEach(job => {
                errors.push({ 
                    jobId: job.jobId, 
                    level: job.level, 
                    error: `Batch fetch failed: ${error instanceof Error ? error.message : String(error)}` 
                });
            });
            break;
        }
    }

    // Log errors using proper MCP logger
    if (errors.length > 0) {
        mcpLogger.warn({ 
            tool: 'get_job_context', 
            rootJobId, 
            maxDepth, 
            errorCount: errors.length, 
            errors 
        }, `Job hierarchy traversal encountered ${errors.length} errors`);
    }
    
    // Sort by level first, then by name for consistent ordering
    const sortedHierarchy = hierarchy.sort((a, b) => {
        if (a.level !== b.level) {
            return a.level - b.level;
        }
        return a.name.localeCompare(b.name);
    });

    return { hierarchy: sortedHierarchy, errors };
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

        let { rootJobId, maxDepth, cursor } = parseResult.data;
        const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };

        // Auto-detect root job from current job context if not provided
        if (!rootJobId) {
            try {
                const ctx = getCurrentJobContext?.();
                if (ctx && typeof ctx.jobDefinitionId === 'string' && ctx.jobDefinitionId) {
                    rootJobId = ctx.jobDefinitionId;
                }
            } catch {}
        }
        if (!rootJobId) {
            return {
                isError: true,
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ 
                        ok: false, 
                        code: 'MISSING_ROOT_JOB', 
                        message: 'rootJobId is required and could not be inferred from current job context.' 
                    }, null, 2)
                }]
            };
        }

        // Fetch the job hierarchy
        const { hierarchy, errors } = await fetchJobHierarchy(rootJobId, maxDepth);

        // Use context management for pagination and token budgets
        const composed = composeSinglePageResponse(hierarchy, {
            startOffset: keyset.offset,
            truncateChars: 500, // Moderate truncation for job names/descriptions
            requestedMeta: { 
                cursor, 
                rootJobId, 
                maxDepth,
                totalJobs: hierarchy.length,
                traversalErrors: errors.length > 0 ? errors : undefined
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
