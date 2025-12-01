/**
 * Child job queries: query Ponder for child job statuses
 */

import { graphQLRequest } from '../../http/client.js';
import { getPonderGraphqlUrl } from '../../gemini-agent/mcp/tools/shared/env.js';
import { workerLogger } from '../../logging/index.js';
import { serializeError } from '../logging/errors.js';
import type { ChildJobStatus } from '../types.js';

const PONDER_GRAPHQL_URL = getPonderGraphqlUrl();

/**
 * Result of child job status query including timing info
 */
export interface ChildJobStatusResult {
  childJobs: ChildJobStatus[];
  queryDuration_ms: number;
  retryAttempts: number;
}

/**
 * Query Ponder for child jobs of this request with retry logic
 * Returns array of {id, delivered} for each child plus timing info
 */
export async function getChildJobStatus(requestId: string): Promise<ChildJobStatusResult> {
  const maxAttempts = 3;
  const baseDelayMs = 300;
  const queryStart = Date.now();
  let attemptCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptCount = attempt;
    try {
      const data = await graphQLRequest<{ requests: { items: Array<{ id: string; delivered: boolean }> } }>({
        url: PONDER_GRAPHQL_URL,
        query: `
          query GetChildJobs($sourceRequestId: String!) {
            requests(where: { sourceRequestId: $sourceRequestId }) {
              items {
                id
                delivered
              }
            }
          }
        `,
        variables: { sourceRequestId: requestId },
        context: { operation: 'getChildJobStatus', requestId }
      });

      return {
        childJobs: data?.requests?.items || [],
        queryDuration_ms: Date.now() - queryStart,
        retryAttempts: attempt - 1,
      };
    } catch (error: any) {
      const serialized = serializeError(error);
      workerLogger.warn({
        requestId,
        attempt,
        maxAttempts,
        error: serialized
      }, 'Retrying child job status lookup after GraphQL error');

      if (attempt === maxAttempts) {
        const message = 'Failed to query child job status';
        workerLogger.error({
          requestId,
          error: serialized
        }, message);
        const wrapped = new Error(`${message}: ${serialized}`);
        if (error && typeof error === 'object') {
          (wrapped as any).cause = error;
        }
        throw wrapped;
      }

      await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));
    }
  }

  return {
    childJobs: [],
    queryDuration_ms: Date.now() - queryStart,
    retryAttempts: attemptCount - 1,
  };
}

/**
 * Query all requests for a given job definition from Ponder
 * Used to find all runs of a job across its lifetime
 */
export async function queryRequestsByJobDefinition(
  jobDefinitionId: string
): Promise<Array<{ id: string; blockTimestamp: string }>> {
  const maxAttempts = 3;
  const baseDelayMs = 300;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await graphQLRequest<{ 
        requests: { items: Array<{ id: string; blockTimestamp: string }> } 
      }>({
        url: PONDER_GRAPHQL_URL,
        query: `
          query GetRequestsForJobDef($jobDefId: String!) {
            requests(
              where: { jobDefinitionId: $jobDefId }
              orderBy: "blockTimestamp"
              orderDirection: "asc"
              limit: 100
            ) {
              items {
                id
                blockTimestamp
              }
            }
          }
        `,
        variables: { jobDefId: jobDefinitionId },
        context: { operation: 'queryRequestsByJobDefinition', jobDefinitionId }
      });

      return data?.requests?.items || [];
    } catch (error: any) {
      if (attempt === maxAttempts) {
        workerLogger.error({
          jobDefinitionId,
          error: serializeError(error)
        }, 'Failed to query requests for job definition');
        return [];
      }
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));
    }
  }

  return [];
}

/**
 * Get all children across all runs of a job definition
 * This queries Ponder for fresh data, not relying on hierarchy snapshots
 */
export interface JobLevelChildStatusResult {
  allChildren: Array<{ id: string; delivered: boolean; requestId: string }>;
  totalChildren: number;
  undeliveredChildren: number;
  queryDuration_ms: number;
}

export async function getAllChildrenForJobDefinition(
  jobDefinitionId: string
): Promise<JobLevelChildStatusResult> {
  const queryStart = Date.now();
  
  // Step 1: Get all requests for this job definition
  const allRequests = await queryRequestsByJobDefinition(jobDefinitionId);
  
  workerLogger.debug({
    jobDefinitionId,
    requestCount: allRequests.length
  }, 'Querying children for all requests of job definition');
  
  // Step 2: Get children for each request (parallel queries)
  const childrenByRequest = await Promise.all(
    allRequests.map(req => getChildJobStatus(req.id))
  );
  
  // Step 3: Flatten and deduplicate by child request ID
  const allChildrenMap = new Map<string, { id: string; delivered: boolean; requestId: string }>();
  
  for (let i = 0; i < allRequests.length; i++) {
    const parentRequestId = allRequests[i].id;
    const { childJobs } = childrenByRequest[i];
    
    for (const child of childJobs) {
      // Only store first occurrence of each child
      if (!allChildrenMap.has(child.id)) {
        allChildrenMap.set(child.id, {
          id: child.id,
          delivered: child.delivered,
          requestId: parentRequestId
        });
      }
    }
  }
  
  const allChildren = Array.from(allChildrenMap.values());
  const undeliveredChildren = allChildren.filter(c => !c.delivered).length;
  
  workerLogger.debug({
    jobDefinitionId,
    totalChildren: allChildren.length,
    undeliveredChildren,
    queryDuration_ms: Date.now() - queryStart
  }, 'Aggregated all children for job definition');
  
  return {
    allChildren,
    totalChildren: allChildren.length,
    undeliveredChildren,
    queryDuration_ms: Date.now() - queryStart
  };
}

