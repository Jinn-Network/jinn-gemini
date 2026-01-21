import { type Request, type Delivery } from '@jinn/shared-ui';
import { FEATURED_INSTANCES, getExplorerUrl } from './featured-services';

export type ActivityStatusType = 'started' | 'completed' | 'thinking' | 'action' | 'error';

export interface ActivityItem {
    id: string;
    type: ActivityStatusType;
    jobName: string;
    message: string;
    timestamp: number;
    workstreamId: string;
    ventureName: string;
    explorerUrl: string;
}

/**
 * Get the venture name for a workstream ID
 * Falls back to a truncated ID if not a known venture
 */
function getVentureName(workstreamId: string): string {
    const featured = FEATURED_INSTANCES.find(f => f.id === workstreamId);
    if (featured) {
        return featured.name;
    }
    // Fallback: truncate the ID
    return `Venture ${workstreamId.slice(0, 8)}...`;
}

/**
 * Transforms Requests and Deliveries into a unified list of ActivityItems
 * Only includes items with actual status update messages (not generic started/completed)
 */
export function transformToActivityItems(requests: Request[], deliveries: Delivery[]): ActivityItem[] {
    const items: ActivityItem[] = [];

    // Process Deliveries - only include those with actual status update messages
    deliveries.forEach(del => {
        // Only include deliveries that have a jobInstanceStatusUpdate with meaningful content
        if (!del.jobInstanceStatusUpdate) {
            return;
        }

        // Find corresponding request to get jobName and workstreamId
        const req = requests.find(r => r.id === del.requestId);
        const jobName = req?.jobName || `Job ${del.requestId.slice(0, 8)}`;
        const workstreamId = req?.workstreamId || del.requestId;

        items.push({
            id: `${del.id}-update`,
            type: 'action',
            jobName,
            message: del.jobInstanceStatusUpdate,
            timestamp: Number(del.blockTimestamp) * 1000,
            workstreamId,
            ventureName: getVentureName(workstreamId),
            explorerUrl: getExplorerUrl('venture', workstreamId)
        });
    });

    return items.sort((a, b) => b.timestamp - a.timestamp);
}
