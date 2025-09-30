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
    requests: 'Job Executions',
    deliveries: 'Job Executions',
    artifacts: 'Artifacts',
  };

  return labelMap[collectionName] || collectionName;
}

// Navigation items for tabs
export interface NavigationItem {
  collection: CollectionName;
  label: string;
}

export const navigationItems: NavigationItem[] = [
  { label: 'Job Definitions', collection: 'jobDefinitions' },
  { label: 'Job Executions', collection: 'requests' },
  { label: 'Artifacts', collection: 'artifacts' },
];
