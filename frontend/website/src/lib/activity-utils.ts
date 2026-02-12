import { type Request, type Delivery } from '@jinn/shared-ui';
import { FEATURED_INSTANCES, getExplorerUrl, LAUNCHPAD_URL } from './featured-services';

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

// Cache for workstream -> venture slug mapping
let ventureSlugCache: Map<string, string> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 60000; // 1 minute

/**
 * Fetch all ventures and build a workstream -> slug mapping
 */
async function getVentureSlugMapping(): Promise<Map<string, string>> {
    const now = Date.now();
    
    // Return cached mapping if still valid
    if (ventureSlugCache && (now - cacheTimestamp < CACHE_TTL)) {
        return ventureSlugCache;
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return new Map();
    }

    try {
        const url = `${SUPABASE_URL}/rest/v1/ventures?select=root_workstream_id,slug,name`;
        const response = await fetch(url, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
        });

        if (response.ok) {
            const ventures = await response.json();
            const mapping = new Map<string, string>();
            
            for (const v of ventures) {
                if (v.root_workstream_id && v.slug) {
                    mapping.set(v.root_workstream_id, v.slug);
                }
            }
            
            ventureSlugCache = mapping;
            cacheTimestamp = now;
            return mapping;
        }
    } catch (error) {
        console.error('Failed to fetch venture mappings:', error);
    }

    return new Map();
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
 * Get the appropriate URL for a workstream - launchpad if venture exists, explorer otherwise
 */
async function getVentureUrl(workstreamId: string): Promise<string> {
    const slugMapping = await getVentureSlugMapping();
    const slug = slugMapping.get(workstreamId);
    
    if (slug) {
        // Link to launchpad venture page
        return `${LAUNCHPAD_URL}/ventures/${slug}`;
    }
    
    // Fallback to explorer
    return getExplorerUrl('venture', workstreamId);
}

/**
 * Transforms Requests and Deliveries into a unified list of ActivityItems.
 * Includes started/completed events so the feed isn't empty when status updates are missing.
 */
export async function transformToActivityItems(requests: Request[], deliveries: Delivery[]): Promise<ActivityItem[]> {
    const items: ActivityItem[] = [];

    // Pre-fetch the venture URL mapping once
    const slugMapping = await getVentureSlugMapping();

    // Helper to get URL for a workstream
    const getUrl = (workstreamId: string): string => {
        const slug = slugMapping.get(workstreamId);
        if (slug) {
            return `${LAUNCHPAD_URL}/ventures/${slug}`;
        }
        return getExplorerUrl('venture', workstreamId);
    };

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
            explorerUrl: getUrl(workstreamId)
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
                explorerUrl: getUrl(workstreamId)
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
            explorerUrl: getUrl(workstreamId)
        });
    });

    return items.sort((a, b) => b.timestamp - a.timestamp);
}
