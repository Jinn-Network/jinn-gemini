import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { CollectionName } from "./types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Function to convert collection names to human-readable labels
export function getCollectionLabel(collectionName: CollectionName): string {
  const labelMap: Record<CollectionName, string> = {
    jobDefinitions: 'Job Definitions',
    requests: 'Requests',
    deliveries: 'Deliveries',
    artifacts: 'Artifacts',
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
      { collection: 'jobDefinitions', label: 'Job Definitions' },
      { collection: 'requests', label: 'Requests' },
      { collection: 'deliveries', label: 'Deliveries' },
    ]
  },
  {
    title: 'Artifacts',
    icon: '📄',
    items: [
      { collection: 'artifacts', label: 'Artifacts' },
    ]
  }
];
