/**
 * Helpers for waiting on Ponder indexing events
 * Used by integration tests to ensure data is indexed before assertions
 */

import fetch from 'cross-fetch';
import { setTimeout as sleep } from 'node:timers/promises';

export interface PonderWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT = 30000; // 30s
const DEFAULT_POLL_INTERVAL = 500; // 500ms

/**
 * Wait for a specific request to be indexed by Ponder
 *
 * @param gqlUrl - Ponder GraphQL endpoint URL
 * @param requestId - Request ID to wait for (0x-prefixed)
 * @param options - Timeout and polling configuration
 * @throws Error if timeout is reached before request is indexed
 *
 * @example
 * ```typescript
 * await waitForRequestIndexed(ctx.gqlUrl, '0xabc123');
 * ```
 */
export async function waitForRequestIndexed(
  gqlUrl: string,
  requestId: string,
  options?: PonderWaitOptions
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query { request(id: "${requestId}") { id } }`
        })
      });

      const data = await result.json();

      if (data?.data?.request?.id === requestId) {
        return; // Found!
      }

      if (data?.errors) {
        // GraphQL error, but not necessarily a failure - request might not be indexed yet
        // Only log in verbose mode
      }
    } catch (err) {
      // Network error, retry
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timeout waiting for Ponder to index request ${requestId} (${timeoutMs}ms)`
  );
}

/**
 * Wait for a job definition to be indexed by Ponder
 *
 * @param gqlUrl - Ponder GraphQL endpoint URL
 * @param jobDefinitionId - Job definition UUID to wait for
 * @param options - Timeout and polling configuration
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * await waitForJobDefinitionIndexed(ctx.gqlUrl, jobDefId);
 * ```
 */
export async function waitForJobDefinitionIndexed(
  gqlUrl: string,
  jobDefinitionId: string,
  options?: PonderWaitOptions
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            query {
              requests(where: { job_definition_id: "${jobDefinitionId}" }) {
                items { id }
              }
            }
          `
        })
      });

      const data = await result.json();

      if (data?.data?.requests?.items?.length > 0) {
        return; // Found at least one request with this job definition
      }
    } catch (err) {
      // Network error, retry
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timeout waiting for Ponder to index job definition ${jobDefinitionId} (${timeoutMs}ms)`
  );
}

/**
 * Wait for a delivery event to be indexed by Ponder
 *
 * @param gqlUrl - Ponder GraphQL endpoint URL
 * @param requestId - Request ID that was delivered
 * @param options - Timeout and polling configuration
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * await waitForDeliveryIndexed(ctx.gqlUrl, '0xabc123');
 * ```
 */
export async function waitForDeliveryIndexed(
  gqlUrl: string,
  requestId: string,
  options?: PonderWaitOptions
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            query {
              request(id: "${requestId}") {
                id
                delivered
              }
            }
          `
        })
      });

      const data = await result.json();

      if (data?.data?.request?.delivered === true) {
        return; // Delivery indexed!
      }
    } catch (err) {
      // Network error, retry
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timeout waiting for Ponder to index delivery for ${requestId} (${timeoutMs}ms)`
  );
}

/**
 * Wait for Ponder GraphQL endpoint to become available
 *
 * @param gqlUrl - Ponder GraphQL endpoint URL
 * @param options - Timeout and polling configuration
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * await waitForPonderReady(ctx.gqlUrl);
 * ```
 */
export async function waitForPonderReady(
  gqlUrl: string,
  options?: PonderWaitOptions
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  const start = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{ requests(limit: 1) { items { id } } }'
        })
      });

      if (result.ok) {
        const data = await result.json();
        if (!data.errors) {
          return; // Ponder is ready!
        }
        lastError = new Error(`GraphQL error: ${JSON.stringify(data.errors)}`);
      } else {
        lastError = new Error(`HTTP ${result.status}`);
      }
    } catch (err) {
      lastError = err as Error;
    }

    await sleep(pollIntervalMs);
  }

  throw lastError ?? new Error(`Timeout waiting for Ponder to become ready (${timeoutMs}ms)`);
}

/**
 * Wait for Ponder to reach realtime sync status (historical sync complete)
 *
 * This ensures Ponder has finished its historical block sync and is ready
 * to index new events in real-time. Prevents race conditions where requests
 * are dispatched before Ponder has caught up to the current block.
 *
 * @param gqlUrl - Ponder GraphQL endpoint URL
 * @param options - Timeout and polling configuration
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * await waitForPonderRealtime(ctx.gqlUrl);
 * // Now safe to dispatch requests - they will be indexed immediately
 * ```
 */
function isRealtimeStatus(value: any): boolean {
  if (!value) return false;

  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered === 'realtime') {
      return true;
    }
    // Sometimes JSON fields come back serialized as strings ─ try to parse
    if (value.includes('{') || value.includes('[')) {
      try {
        const parsed = JSON.parse(value);
        return isRealtimeStatus(parsed);
      } catch {
        // fall through
      }
    }
    // Fallback: treat any string containing "realtime" as success
    return lowered.includes('realtime');
  }

  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => isRealtimeStatus(item));
  }

  if (typeof value === 'object') {
    // Many status payloads use `status` or `stage`
    if (typeof value.status === 'string' && value.status.toLowerCase() === 'realtime') {
      return true;
    }
    if (typeof value.stage === 'string' && value.stage.toLowerCase() === 'realtime') {
      return true;
    }

    // Ponder's actual structure: { "base": { "ready": true, "block": {...} } }
    // Check if this is a network object with a `ready` field
    if (typeof value.ready === 'boolean') {
      return value.ready === true;
    }

    // Ponder exposes `networks: { [name]: { status: 'historical' | 'realtime' } }`
    if (value.networks && typeof value.networks === 'object') {
      const entries = Object.values(value.networks);
      return entries.length > 0 && entries.every((item) => isRealtimeStatus(item));
    }

    // Handle structure like { "base": { "ready": true, ... } } - check all network values
    const objectValues = Object.values(value);
    if (objectValues.length > 0) {
      // If all values are objects with `ready` fields, check them
      const allHaveReady = objectValues.every(
        (item) => typeof item === 'object' && item !== null && typeof item.ready === 'boolean'
      );
      if (allHaveReady) {
        return objectValues.every((item: any) => item.ready === true);
      }
      // Otherwise recurse
      return objectValues.every((item) => isRealtimeStatus(item));
    }
  }

  return false;
}

export async function waitForPonderRealtime(
  gqlUrl: string,
  options?: PonderWaitOptions
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 60000; // Default 60s for sync completion
  const pollIntervalMs = options?.pollIntervalMs ?? 1000; // Check every 1s
  const start = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{ _meta { status } }'
        })
      });

      if (result.ok) {
        const data = await result.json();
        if (data.errors) {
          lastError = new Error(`GraphQL error: ${JSON.stringify(data.errors)}`);
          await sleep(pollIntervalMs);
          continue;
        }

        const status = data?.data?._meta?.status;
        
        if (isRealtimeStatus(status)) {
          return; // Reached realtime sync
        }

        // Still syncing – fall through to wait and retry
      } else {
        lastError = new Error(`HTTP ${result.status}`);
      }
    } catch (err) {
      lastError = err as Error;
    }

    await sleep(pollIntervalMs);
  }

  throw lastError ?? new Error(`Timeout waiting for Ponder to reach realtime status (${timeoutMs}ms)`);
}

/**
 * Wait for a message to be indexed by Ponder
 *
 * @param gqlUrl - Ponder GraphQL endpoint URL
 * @param jobDefinitionId - Target job definition ID
 * @param expectedContent - Expected message content
 * @param options - Timeout and polling configuration
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * await waitForMessage(ctx.gqlUrl, jobDefId, 'Child job COMPLETED');
 * ```
 */
export async function waitForMessage(
  gqlUrl: string,
  jobDefinitionId: string,
  expectedContent: string,
  options?: PonderWaitOptions
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            query {
              messages(where: { to: "${jobDefinitionId}" }) {
                items {
                  id
                  content
                  to
                  sourceJobDefinitionId
                  requestId
                  blockTimestamp
                }
              }
            }
          `
        })
      });

      const data = await result.json();
      const messages = data?.data?.messages?.items || [];

      // Check if any message has the expected content
      if (messages.some((m: any) => m.content === expectedContent)) {
        return; // Found the message!
      }
    } catch (err) {
      // Network error, retry
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timeout waiting for message "${expectedContent}" to job ${jobDefinitionId} (${timeoutMs}ms)`
  );
}

/**
 * Wait for a child request created by parent via dispatch_new_job
 *
 * @param gqlUrl - Ponder GraphQL endpoint URL
 * @param parentRequestId - Parent request ID that dispatched the child
 * @param options - Timeout and polling configuration
 * @returns Child request details
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * const grandchild = await waitForChildRequest(ctx.gqlUrl, childRequestId);
 * ```
 */
export async function waitForChildRequest(
  gqlUrl: string,
  parentRequestId: string,
  options?: PonderWaitOptions
): Promise<{ id: string; jobDefinitionId: string; sourceRequestId: string }> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{
            requests(where: { sourceRequestId: "${parentRequestId}" }, limit: 1) {
              items { id jobDefinitionId sourceRequestId }
            }
          }`
        })
      });

      const data = await result.json();
      const items = data?.data?.requests?.items;

      if (items?.length > 0) {
        return items[0];
      }
    } catch (err) {
      // Network error, retry
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timeout waiting for child request of ${parentRequestId} (${timeoutMs}ms)`
  );
}

/**
 * Wait for artifact of specific type to be indexed by Ponder
 *
 * @param gqlUrl - Ponder GraphQL endpoint URL
 * @param requestId - Request ID that created the artifact
 * @param type - Artifact type (e.g., 'SITUATION', 'MEMORY')
 * @param options - Timeout and polling configuration
 * @returns Artifact details
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * const situation = await waitForArtifactByType(ctx.gqlUrl, requestId, 'SITUATION');
 * ```
 */
export async function waitForArtifactByType(
  gqlUrl: string,
  requestId: string,
  type: string,
  options?: PonderWaitOptions
): Promise<{ id: string; cid: string; type: string }> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fetch(gqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{
            artifacts(where: { requestId: "${requestId}", type: "${type}" }, limit: 1) {
              items { id cid type }
            }
          }`
        })
      });

      const data = await result.json();
      const items = data?.data?.artifacts?.items;

      if (items?.length > 0) {
        return items[0];
      }
    } catch (err) {
      // Network error, retry
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timeout waiting for ${type} artifact for ${requestId} (${timeoutMs}ms)`
  );
}
