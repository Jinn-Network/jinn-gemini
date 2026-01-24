/**
 * Worker Nodes Configuration
 *
 * Known worker node endpoints for health monitoring.
 * Each node has a healthcheck endpoint that reports status.
 */

export interface WorkerNode {
  id: string;
  name: string;
  description: string;
  healthcheckUrl: string;
  owner?: string;
  location?: string;
}

export interface NodeHealthStatus {
  status: 'ok' | 'error' | 'unknown';
  service?: string;
  workerId?: string;
  uptime?: {
    ms: number;
    human: string;
  };
  lastActivity?: {
    ms: number;
    human: string;
  };
  processedJobs?: number;
  timestamp: string;
}

// Known worker nodes
// Configure NEXT_PUBLIC_GCD_WORKER_HEALTH_URL in your environment to point to the actual worker health endpoint
export const WORKER_NODES: WorkerNode[] = [
  {
    id: 'gcd-railway',
    name: 'GCD Railway Worker',
    description: 'Primary production worker running on Railway',
    healthcheckUrl: process.env.NEXT_PUBLIC_GCD_WORKER_HEALTH_URL || 'https://jinn-control-api-production.up.railway.app/health',
    owner: 'gcd',
    location: 'Railway Cloud',
  },
];

/**
 * Fetch health status from a node
 */
export async function fetchNodeHealth(node: WorkerNode): Promise<NodeHealthStatus | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(node.healthcheckUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data as NodeHealthStatus;
  } catch {
    return null;
  }
}

/**
 * Fetch health status for all nodes
 */
export async function fetchAllNodesHealth(): Promise<Map<string, NodeHealthStatus | null>> {
  const results = new Map<string, NodeHealthStatus | null>();

  await Promise.all(
    WORKER_NODES.map(async (node) => {
      const health = await fetchNodeHealth(node);
      results.set(node.id, health);
    })
  );

  return results;
}
