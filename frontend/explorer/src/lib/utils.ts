import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { CollectionName } from "./types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Function to convert collection names to human-readable labels
export function getCollectionLabel(collectionName: CollectionName): string {
  const labelMap: Record<CollectionName, string> = {
    job_board: 'Job Board',
    jobs: 'Jobs',
    job_reports: 'Job Reports',
    events: 'Events',
    artifacts: 'Artifacts',
    memories: 'Memories',
    messages: 'Messages',
    system_state: 'System State',
  };
  
  return labelMap[collectionName] || collectionName;
}

// Navigation category structure
export interface NavigationItem {
  collection: CollectionName;
  label: string;
}

export interface NavigationCategory {
  title: string;
  icon?: string;
  items: NavigationItem[];
}

export const navigationCategories: NavigationCategory[] = [
  {
    title: 'Jobs',
    icon: '💼',
    items: [
      { collection: 'job_board', label: 'Board' },
      { collection: 'jobs', label: 'Jobs' },
      { collection: 'job_reports', label: 'Reports' },
    ]
  },
  {
    title: 'Events',
    icon: '🪩',
    items: [
      { collection: 'events', label: 'Events' },
    ]
  },
  {
    title: 'System',
    icon: '⚙️',
    items: [
      { collection: 'memories', label: 'Memories' },
      { collection: 'system_state', label: 'System State' },
    ]
  }
];
