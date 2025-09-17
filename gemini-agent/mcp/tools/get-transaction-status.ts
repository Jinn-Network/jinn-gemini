import { z } from 'zod';
import fetch from 'cross-fetch';
import { isControlApiEnabled } from './shared/control_api.js';

// Control API URL
const CONTROL_API_URL = process.env.CONTROL_API_URL || 'http://localhost:4001/graphql';

export const getTransactionStatusParams = z.object({
  request_id: z.string().uuid('A valid UUID for the transaction request is required.'),
});

export const schema = {
  description: 'Gets the status and details of a queued transaction request, including explorer URLs for any resulting hashes.',
  inputSchema: getTransactionStatusParams.shape
};

// Private helper function to get explorer URLs
function getExplorerUrl(chainId: number, txHash: string): string {
  const explorers: Record<number, string> = {
    1: 'https://etherscan.io',
    8453: 'https://basescan.org',
    10: 'https://optimistic.etherscan.io',
    42161: 'https://arbiscan.io',
    137: 'https://polygonscan.com',
    11155111: 'https://sepolia.etherscan.io'
  };
  
  const baseUrl = explorers[chainId] || 'https://etherscan.io';
  return `${baseUrl}/tx/${txHash}`;
}

/**
 * Get the status of a transaction request and construct explorer URLs for any resulting hashes.
 * @param {object} params - The parameters for the tool.
 * @param {string} params.request_id - The UUID of the transaction request to query.
 * @returns {object} The result of the operation, including transaction status and explorer URLs.
 */
export async function getTransactionStatus(params: z.infer<typeof getTransactionStatusParams>) {
  try {
    if (!isControlApiEnabled()) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'CONTROL_API_DISABLED', message: 'Enable USE_CONTROL_API to query transaction status.' }, null, 2) }] };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Worker-Address': process.env.MECH_WORKER_ADDRESS || ''
    };
    const query = `query GetTx($id: String!) { getTransactionStatus(id: $id) { id chain_id safe_tx_hash tx_hash status } }`;
    const body = { query, variables: { id: params.request_id } };
    const res = await fetch(CONTROL_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    const json = await res.json();
    if (json.errors) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'CONTROL_API_ERROR', message: json.errors[0]?.message || 'Unknown error' }, null, 2) }] };
    }
    const data = json.data.getTransactionStatus;

    const response = {
      ...data,
      safeTxExplorerUrl: data.safe_tx_hash ? getExplorerUrl(data.chain_id, data.safe_tx_hash) : null,
      txExplorerUrl: data.tx_hash ? getExplorerUrl(data.chain_id, data.tx_hash) : null,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `An unexpected error occurred: ${error.message}`
      }]
    };
  }
}
