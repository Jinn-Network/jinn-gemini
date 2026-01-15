/**
 * Featured Services Configuration
 *
 * Hardcoded IDs for the MVP - will be replaced with
 * tag/status filtering once the service catalog grows.
 */

export interface FeaturedInstance {
  id: string;
  name: string;
  description: string;
}

// The blog growth service template ID
export const FEATURED_SERVICE_ID = 'blog-growth-template-2b053250';

// Known service instances (workstreams) to feature
export const FEATURED_INSTANCES: FeaturedInstance[] = [
  {
    id: '0x1a109927c66ca50fec22d22336082a99694294f537e87d9b8ada45c51d83129b',
    name: 'Blog Growth Template – YBT',
    description: 'Autonomous blog covering Jinn development and AI agents'
  },
];

// Explorer base URL for deep linking
export const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://explorer.jinn.network';

// Generate explorer link for different entity types
export function getExplorerUrl(type: 'workstream' | 'request' | 'jobDefinitions' | 'templates', id: string): string {
  const pathMap = {
    workstream: 'workstreams',
    request: 'requests',
    jobDefinitions: 'jobDefinitions',
    templates: 'templates'
  };
  return `${EXPLORER_URL}/${pathMap[type]}/${id}`;
}
