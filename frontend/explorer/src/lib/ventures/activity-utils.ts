import type { JobDefinition } from '@/lib/subgraph';

export type ActivityStatusType = 'completed' | 'running' | 'status_update';

export interface ActivityItem {
    id: string;
    type: ActivityStatusType;
    jobName: string;
    message: string;
    timestamp: number;
    workstreamId: string;
    status?: string;
}

/**
 * Transforms JobDefinitions into a unified list of ActivityItems
 * Only includes jobs that have actual status update messages
 */
export function transformToActivityItems(jobDefinitions: JobDefinition[]): ActivityItem[] {
    const items: ActivityItem[] = [];

    jobDefinitions.forEach(jobDef => {
        // Only include jobs that have a real status update message
        if (!jobDef.latestStatusUpdate) {
            return;
        }

        const jobName = jobDef.name || `Job ${jobDef.id.slice(0, 8)}`;
        const workstreamId = jobDef.workstreamId || jobDef.id;

        // Parse timestamp - lastInteraction is a Unix timestamp (seconds since epoch)
        const timestamp = jobDef.lastInteraction
            ? Number(jobDef.lastInteraction) * 1000
            : Date.now();

        // Determine activity type based on status
        const status = jobDef.lastStatus?.toLowerCase() || '';
        let type: ActivityStatusType = 'status_update';

        if (status === 'completed' || status === 'done' || status === 'finished') {
            type = 'completed';
        } else if (status === 'running' || status === 'in_progress' || status === 'active') {
            type = 'running';
        }

        items.push({
            id: jobDef.id,
            type,
            jobName,
            message: jobDef.latestStatusUpdate,
            timestamp,
            workstreamId,
            status: jobDef.lastStatus
        });
    });

    // Sort by timestamp descending (most recent first)
    return items.sort((a, b) => b.timestamp - a.timestamp);
}
