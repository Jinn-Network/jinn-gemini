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
    id: '0xa6de04ee01994d2fc5e591f829bf6b7abc749f17cc66bb46b60f6bb628bf8d15',
    name: 'The Lamp',
    description: 'Growing Jinn by educating people about autonomous software ventures and expanding the ecosystem.'
  },
  {
    id: '0x7b2e6b9630b621b9773a4afe110c184e6bf052dfbffbf1563fa6c6158ea3ece5',
    name: 'The Long Run',
    description: 'Processing cutting-edge longevity research into actionable health optimization protocols.'
  }
];

// Explorer base URL for deep linking
export const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://explorer.jinn.network';

// Generate explorer link for different entity types
export function getExplorerUrl(type: 'workstream' | 'request' | 'jobDefinitions' | 'templates' | 'venture', id: string): string {
  const pathMap = {
    venture: 'ventures',
    workstream: 'workstreams',
    request: 'requests',
    jobDefinitions: 'jobDefinitions',
    templates: 'templates'
  };
  return `${EXPLORER_URL}/${pathMap[type]}/${id}`;
}
