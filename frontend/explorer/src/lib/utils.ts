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
    job_definitions: 'Job Definitions', 
    job_schedules: 'Job Schedules',
    prompt_library: 'Prompt Library',
    threads: 'Threads',
    artifacts: 'Artifacts',
    memories: 'Memories',
    messages: 'Messages',
    system_state: 'System State',
    job_reports: 'Job Reports'
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
      { collection: 'job_reports', label: 'Reports' },
      { collection: 'job_schedules', label: 'Schedules' },
      { collection: 'job_definitions', label: 'Definitions' },
      { collection: 'prompt_library', label: 'Prompt Library' },
    ]
  },
  {
    title: 'Output',
    icon: '📤',
    items: [
      { collection: 'threads', label: 'Threads' },
      { collection: 'artifacts', label: 'Artifacts' },
      { collection: 'messages', label: 'Messages' },
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
