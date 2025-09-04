import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
    const { data, error } = await supabase
      .from('transaction_requests')
      .select('*')
      .eq('id', params.request_id)
      .single();

    if (error) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Error fetching transaction status: ${error.message}`
        }]
      };
    }

    if (!data) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: `Transaction request with ID ${params.request_id} not found.`
        }]
      };
    }

    // Construct explorer URLs
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
