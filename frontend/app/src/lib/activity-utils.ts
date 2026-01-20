import { type Request, type Delivery } from '@jinn/shared-ui';

export type ActivityStatusType = 'started' | 'completed' | 'thinking' | 'action' | 'error';

export interface ActivityItem {
    id: string;
    type: ActivityStatusType;
    jobName: string;
    message: string;
    timestamp: number;
    workstreamId: string;
    serviceName?: string;
}

/**
 * Transforms Requests and Deliveries into a unified list of ActivityItems
 */
export function transformToActivityItems(requests: Request[], deliveries: Delivery[]): ActivityItem[] {
    const items: ActivityItem[] = [];

    // Process Requests (Started events)
    requests.forEach(req => {
        const jobName = req.jobName || `Job ${req.id.slice(0, 8)}`;

        items.push({
            id: `${req.id}-started`,
            type: 'started',
            jobName,
            message: `I've started working on ${jobName}`,
            timestamp: Number(req.blockTimestamp) * 1000,
            workstreamId: req.workstreamId || req.id,
            serviceName: 'Jinn Service' // TODO: Map from mech/sender if possible
        });
    });

    // Process Deliveries (Completed or Status Update events)
    deliveries.forEach(del => {
        // Find corresponding request to get jobName
        const req = requests.find(r => r.id === del.requestId);
        const jobName = req?.jobName || `Job ${del.requestId.slice(0, 8)}`;
        const workstreamId = req?.workstreamId || del.requestId; // fallback

        if (del.jobInstanceStatusUpdate) {
            // If it has a status update, treat it as a status update event
            // Does this replace completion? Or is it an intermediate event?
            // Assuming for now it's an update. 
            // If the delivery is THE completion, we might also want a completed event?
            // Usually a delivery IS the completion. 
            // But if it has a status update text, maybe we show THAT as the message?
            // The user wants "show the full message. Make it look like a quote".

            items.push({
                id: `${del.id}-update`,
                type: 'action', // or 'thinking'
                jobName,
                message: del.jobInstanceStatusUpdate,
                timestamp: Number(del.blockTimestamp) * 1000,
                workstreamId,
                serviceName: 'Jinn Service'
            });

            // Should we ALSO show "Completed"? 
            // If the status update is "I'm done", maybe not.
            // But if it's "I checked X", we still want to know it finished.
            // Let's add a separate "Completed" event slightly after if it's not effectively the same.
            // But for now, let's treat the delivery AS the event.
            // If we want a generic "Completed" message, we can add it.
            // "Update job started and completed ones to read like..."
            // So we definitely want a "Completed" event.

            items.push({
                id: `${del.id}-completed`,
                type: 'completed',
                jobName,
                message: `I've completed ${jobName}`,
                timestamp: (Number(del.blockTimestamp) * 1000) + 100, // slightly after
                workstreamId,
                serviceName: 'Jinn Service'
            });

        } else {
            // Standard completion without specific text
            items.push({
                id: `${del.id}-completed`,
                type: 'completed',
                jobName,
                message: `I've completed ${jobName}`,
                timestamp: Number(del.blockTimestamp) * 1000,
                workstreamId,
                serviceName: 'Jinn Service'
            });
        }
    });

    return items.sort((a, b) => b.timestamp - a.timestamp);
}
