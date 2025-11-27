import { createClient } from "@ponder/client";

const PONDER_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL?.replace('/graphql', '')
  || 'http://localhost:42069';

export const ponderClient = createClient({ url: PONDER_URL });

