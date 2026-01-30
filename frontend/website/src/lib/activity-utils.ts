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
 * Transforms Requests and Deliveries into a unified list of ActivityItems.
 * Includes started/completed events so the feed isn't empty when status updates are missing.
 */
export function transformToActivityItems(requests: Request[], deliveries: Delivery[]): ActivityItem[] {
    const items: ActivityItem[] = [];

    // Started events from requests
    requests.forEach(req => {
        const jobName = req.jobName || `Job ${req.id.slice(0, 8)}`;
        const workstreamId = req.workstreamId || req.id;

        items.push({
            id: `${req.id}-started`,
            type: 'started',
            jobName,
            message: `Started ${jobName}`,
            timestamp: Number(req.blockTimestamp) * 1000,
            workstreamId,
            ventureName: getVentureName(workstreamId),
            explorerUrl: getExplorerUrl('venture', workstreamId)
        });
    });

    // Delivery events (status update + completion)
    deliveries.forEach(del => {
        const req = requests.find(r => r.id === del.requestId);
        const jobName = req?.jobName || `Job ${del.requestId.slice(0, 8)}`;
        const workstreamId = req?.workstreamId || del.requestId;

        if (del.jobInstanceStatusUpdate) {
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
        }

        items.push({
            id: `${del.id}-completed`,
            type: 'completed',
            jobName,
            message: `Completed ${jobName}`,
            timestamp: Number(del.blockTimestamp) * 1000 + 100,
            workstreamId,
            ventureName: getVentureName(workstreamId),
            explorerUrl: getExplorerUrl('venture', workstreamId)
        });
    });

    return items.sort((a, b) => b.timestamp - a.timestamp);
}
