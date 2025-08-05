// Generic type for any record from the database
export type DbRecord = {
  id: string | number;
  created_at?: string;
  [key: string]: any;
};

// List of all explorable table names
export const collectionNames = [
  'job_board',
  'job_definitions',
  'job_schedules',
  'prompt_library',
  'threads',
  'artifacts',
  'memories',
  'messages',
  'system_state',
  'job_reports',
] as const;

export type CollectionName = typeof collectionNames[number];

// Props for the main collection page (index view)
export interface CollectionPageProps {
  params: {
    collection: CollectionName;
  };
}

// Props for the record detail page (show view)
export interface RecordPageProps {
  params: {
    collection: CollectionName;
    id: string;
  };
}