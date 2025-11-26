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

