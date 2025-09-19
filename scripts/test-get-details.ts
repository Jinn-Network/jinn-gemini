import fetch from 'cross-fetch';
import { getDetails } from '../gemini-agent/mcp/tools/get-details.js';

async function main() {
  const PONDER_GRAPHQL_URL = process.env.PONDER_GRAPHQL_URL || 'http://localhost:42069/graphql';
  const query = `query { requests(orderBy: "blockTimestamp", orderDirection: "desc", limit: 1) { items { id ipfsHash } } }`;
  const res = await fetch(PONDER_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const json = await res.json();
  const item = json?.data?.requests?.items?.[0];
  if (!item) {
    console.error('No requests found.');
    process.exit(1);
  }
  const id = item.id as string;
  const toolRes: any = await getDetails({ ids: [id], resolve_ipfs: true });
  console.log(toolRes?.content?.[0]?.text || toolRes);
}

main().catch((e) => { console.error(e); process.exit(1); });
