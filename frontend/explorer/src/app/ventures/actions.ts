'use server'

import { getWorkstreamActivity } from '@/lib/ventures/service-queries';
import { getVentureActivity } from '@/lib/ventures/venture-queries';
import type { JobDefinition } from '@/lib/subgraph';

/**
 * Server action to fetch workstream activity (legacy, single-workstream)
 * Used for polling in client components
 */
export async function fetchWorkstreamActivityAction(workstreamId: string): Promise<{ jobDefinitions: JobDefinition[] }> {
    try {
        return await getWorkstreamActivity(workstreamId);
    } catch (error) {
        console.error('Failed to fetch activity:', error);
        return { jobDefinitions: [] };
    }
}

/**
 * Server action to fetch venture activity (all workstreams)
 * Used for polling in client components when ventureId is available
 */
export async function fetchVentureActivityAction(ventureId: string): Promise<{ jobDefinitions: JobDefinition[] }> {
    try {
        return await getVentureActivity(ventureId);
    } catch (error) {
        console.error('Failed to fetch venture activity:', error);
        return { jobDefinitions: [] };
    }
}
