/**
 * Venture-scoped Ponder Queries
 *
 * These queries use `ventureId` to fetch data across ALL workstreams
 * belonging to a venture, rather than a single workstream.
 */

import {
  queryRequests,
  queryArtifacts,
  getJobDefinition,
  type Request,
  type Artifact,
  type JobDefinition,
} from '@/lib/subgraph';

/**
 * Get all requests belonging to a venture.
 */
export async function getVentureRequests(ventureId: string, limit = 100): Promise<Request[]> {
  const response = await queryRequests({
    where: { ventureId },
    orderBy: 'blockTimestamp',
    orderDirection: 'desc',
    limit,
  });
  return response.items;
}

/**
 * Get job definitions (activity) for a venture across all workstreams.
 * Two-step: requests by ventureId -> unique jobDefinitionIds -> jobDefinitions.
 */
export async function getVentureActivity(ventureId: string, limit = 50): Promise<{ jobDefinitions: JobDefinition[] }> {
  const requests = await getVentureRequests(ventureId, limit);

  const jobDefIds = [...new Set(
    requests
      .map(r => r.jobDefinitionId)
      .filter((id): id is string => !!id)
  )];

  if (jobDefIds.length === 0) {
    return { jobDefinitions: [] };
  }

  const jobDefinitions: JobDefinition[] = [];
  for (const id of jobDefIds) {
    const jobDef = await getJobDefinition(id);
    if (jobDef) {
      jobDefinitions.push(jobDef);
    }
  }

  jobDefinitions.sort((a, b) => {
    const aTime = a.lastInteraction ? Number(a.lastInteraction) : 0;
    const bTime = b.lastInteraction ? Number(b.lastInteraction) : 0;
    return bTime - aTime;
  });

  return { jobDefinitions };
}

/**
 * Get measurement artifacts for a venture.
 * Two-step: requests by ventureId -> artifact by sourceRequestId_in + MEASUREMENT topic.
 */
export async function getVentureMeasurements(ventureId: string): Promise<Artifact[]> {
  const requests = await getVentureRequests(ventureId, 200);
  const requestIds = requests.map(r => r.id);

  if (requestIds.length === 0) return [];

  // Artifacts use sourceRequestId (root workstream ID), so we need unique workstream IDs
  const workstreamIds = [...new Set(
    requests
      .map(r => r.workstreamId)
      .filter((id): id is string => !!id)
  )];

  if (workstreamIds.length === 0) return [];

  // Query measurement artifacts by sourceRequestId (which is set to the workstream root)
  const allArtifacts: Artifact[] = [];
  for (const wsId of workstreamIds) {
    const response = await queryArtifacts({
      where: {
        sourceRequestId: wsId,
        topic: 'MEASUREMENT',
      },
      orderBy: 'blockTimestamp',
      orderDirection: 'desc',
      limit: 100,
    });
    allArtifacts.push(...response.items);
  }

  // Sort all by timestamp desc
  allArtifacts.sort((a, b) => {
    const aTime = Number(a.blockTimestamp || 0);
    const bTime = Number(b.blockTimestamp || 0);
    return bTime - aTime;
  });

  return allArtifacts;
}

/**
 * Get SERVICE_OUTPUT artifacts for a venture.
 */
export async function getVentureServiceOutputs(ventureId: string): Promise<Artifact[]> {
  const requests = await getVentureRequests(ventureId, 200);
  const workstreamIds = [...new Set(
    requests
      .map(r => r.workstreamId)
      .filter((id): id is string => !!id)
  )];

  if (workstreamIds.length === 0) return [];

  const allArtifacts: Artifact[] = [];
  for (const wsId of workstreamIds) {
    const response = await queryArtifacts({
      where: {
        sourceRequestId: wsId,
        topic: 'SERVICE_OUTPUT',
      },
      orderBy: 'blockTimestamp',
      orderDirection: 'desc',
      limit: 10,
    });
    allArtifacts.push(...response.items);
  }

  return allArtifacts;
}

/**
 * Get dispatched requests for a specific template within a venture over a time period.
 */
export async function getScheduleDispatches(
  ventureId: string,
  templateId: string,
  sinceDaysAgo = 30,
): Promise<{ count: number; latestRequest: Request | null; requests: Request[] }> {
  const sinceTimestamp = Math.floor((Date.now() - sinceDaysAgo * 86400000) / 1000);

  const response = await queryRequests({
    where: {
      ventureId,
      templateId,
      blockTimestamp_gte: String(sinceTimestamp),
    },
    orderBy: 'blockTimestamp',
    orderDirection: 'desc',
    limit: 100,
  });

  return {
    count: response.items.length,
    latestRequest: response.items[0] || null,
    requests: response.items,
  };
}
