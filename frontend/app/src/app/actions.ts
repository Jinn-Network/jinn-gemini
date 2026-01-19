'use server'

import { getWorkstreamActivity } from '@/lib/service-queries';
import type { Request } from '@jinn/shared-ui';

/**
 * Server action to fetch workstream activity
 * Used for polling in client components
 */
export async function fetchWorkstreamActivityAction(workstreamId: string): Promise<Request[]> {
    try {
        return await getWorkstreamActivity(workstreamId);
    } catch (error) {
        console.error('Failed to fetch activity:', error);
        return [];
    }
}
