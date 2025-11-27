import { createClient } from "@ponder/client";

const PONDER_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL?.replace('/graphql', '/sql') 
  || 'http://localhost:42069/sql';

// Create client without schema - Ponder client will infer types from database
export const ponderClient = createClient(PONDER_URL);

// Define table references for use in queries
export const tables = {
  request: 'request',
  artifact: 'artifact', 
  delivery: 'delivery',
  jobDefinition: 'jobDefinition',
  message: 'message'
} as const;

