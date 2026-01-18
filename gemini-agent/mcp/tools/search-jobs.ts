import { z } from 'zod';
import fetch from 'cross-fetch';
import { composeSinglePageResponse, decodeCursor } from './shared/context-management.js';
import { getPonderGraphqlUrl } from './shared/env.js';
import { getCurrentJobContext } from './shared/context.js';

const base = z.object({
  query: z.string().min(1).describe('Case-insensitive text to match against job name and description.'),
  cursor: z.string().optional().describe('Opaque cursor for pagination.'),
  include_requests: z.boolean().optional().default(true).describe('If true, include requests made for each job.'),
  max_requests_per_job: z.number().optional().default(10).describe('Maximum number of requests to include per job.'),
});

export const searchJobsParams = base;
export type SearchJobsParams = z.infer<typeof searchJobsParams>;

export const searchJobsSchema = {
  description: 'Search job definitions by name/description. Returns job definitions with their associated requests.',
  inputSchema: searchJobsParams.shape,
};

async function fetchRequestsForJob(jobId: string, maxRequests: number): Promise<any[]> {
  const PONDER_GRAPHQL_URL = getPonderGraphqlUrl();
  const gql = `query GetJobRequests($jobId: String!, $limit: Int!) {
    requests(where: { sourceJobDefinitionId: $jobId }, 
            orderBy: "blockTimestamp", orderDirection: "desc", limit: $limit) {
      items { 
        id mech sender ipfsHash deliveryIpfsHash 
        blockTimestamp delivered requestData jobName
      }
    }
  }`;

  const variables = { jobId, limit: maxRequests };
  const res = await fetch(PONDER_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql, variables })
  });

  const json = await res.json();
  return json?.data?.requests?.items || [];
}

export async function searchJobs(params: SearchJobsParams) {
  try {
    const parsed = searchJobsParams.safeParse(params);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message } }) }]
      };
    }

    const { query, cursor, include_requests, max_requests_per_job } = parsed.data;
    const keyset = decodeCursor<{ offset: number }>(cursor) ?? { offset: 0 };

    // Get workstream context for scoping (if available)
    const context = getCurrentJobContext();
    const workstreamId = context.workstreamId;

    // Step 1: Search job definitions by name and blueprint
    // Scope to current workstream if context is available
    const PONDER_GRAPHQL_URL = getPonderGraphqlUrl();

    // Build query conditionally based on workstream context
    const jobsGql = workstreamId
      ? `query SearchJobs($q: String!, $workstreamId: String!, $limit: Int!) {
          jobDefinitions(where: {
            workstreamId: $workstreamId,
            OR: [
              { name_contains: $q },
              { blueprint_contains: $q }
            ]
          }, limit: $limit) {
            items {
              id name blueprint enabledTools
              sourceJobDefinitionId sourceRequestId workstreamId
            }
          }
        }`
      : `query SearchJobs($q: String!, $limit: Int!) {
          jobDefinitions(where: { OR: [
            { name_contains: $q },
            { blueprint_contains: $q }
          ] }, limit: $limit) {
            items {
              id name blueprint enabledTools
              sourceJobDefinitionId sourceRequestId workstreamId
            }
          }
        }`;

    const variables = workstreamId
      ? { q: query, workstreamId, limit: 100 }
      : { q: query, limit: 100 };
    const res = await fetch(PONDER_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: jobsGql, variables })
    });

    const json = await res.json();
    const jobs = json?.data?.jobDefinitions?.items || [];

    // Step 2: For each job, fetch its requests (if requested)
    let enrichedJobs = jobs;
    if (include_requests && jobs.length > 0) {
      const requestPromises = jobs.map(async (job: any) => {
        try {
          const requests = await fetchRequestsForJob(job.id, max_requests_per_job || 10);
          return { ...job, requests };
        } catch (error) {
          // If fetching requests fails for a job, include the job without requests
          return { ...job, requests: [], requestsError: 'Failed to fetch requests' };
        }
      });

      enrichedJobs = await Promise.all(requestPromises);
    }

    // Step 3: Apply pagination using context management utilities
    const composed = composeSinglePageResponse(enrichedJobs, {
      startOffset: keyset.offset,
      truncateChars: 1000, // Reduced since we're including more data
      perFieldMaxChars: 5000,
      pageTokenBudget: 10000, // 10k token budget per page
      upstreamLimit: 100, // Database limit - prevents false has_more when offset >= database page
      requestedMeta: { cursor, query, include_requests, max_requests_per_job, workstreamId: workstreamId || null }
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          data: composed.data,
          meta: { ok: true, ...composed.meta, source: 'ponder', type: 'job_definitions' }
        })
      }]
    };
  } catch (e: any) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ data: [], meta: { ok: false, code: 'UNEXPECTED_ERROR', message: e?.message || String(e) } }) }]
    };
  }
}


