/**
 * Featured Ventures Configuration
 *
 * Hardcoded IDs for the MVP - will be replaced with
 * tag/status filtering once the venture catalog grows.
 */

export interface FeaturedVenture {
  id: string;
  name: string;
  description: string;
  liveOutputUrl?: string;
}

// The blog growth service template ID
export const FEATURED_SERVICE_ID = 'blog-growth-template-2b053250';

// Known service instances (workstreams) to feature
export const FEATURED_VENTURES: FeaturedVenture[] = [
  {
    id: '0xa6de04ee01994d2fc5e591f829bf6b7abc749f17cc66bb46b60f6bb628bf8d15',
    name: 'The Lamp',
    description: 'Educating people about autonomous software ventures and driving exposure for the Jinn ecosystem',
    liveOutputUrl: 'https://blog.jinn.network/'
  },
  {
    id: '0x6c3a5c27b0363175f460539070d2152d570ea894735e891d90d45d44a410244d',
    name: 'The Long Run',
    description: 'Processing cutting-edge longevity research into actionable health optimization protocols'
  }
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
