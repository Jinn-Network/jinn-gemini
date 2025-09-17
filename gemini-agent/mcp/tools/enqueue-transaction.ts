import { z } from 'zod';
import { createHash } from 'crypto';
import { isControlApiEnabled } from './shared/control_api.js';
import { getAllowlist } from './shared/allowlist.js';
import { getCurrentJobContext } from './shared/context.js';
import { workerLogger } from '../../../worker/logger.js';
import fetch from 'cross-fetch';

// Input schema for enqueuing transactions
export const enqueueTransactionParams = z.object({
  payload: z.object({
    to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid Ethereum address'),
    data: z.string().regex(/^0x[a-fA-F0-9]*$/i, 'Must be valid hex data'),
    value: z.string().regex(/^0x[a-fA-F0-9]+$|^0$/i, 'Must be hex value or "0"').default('0')
  }).describe('Transaction payload containing to, data, and value'),
  chain_id: z.number().int().positive().describe('Chain ID for the transaction'),
  execution_strategy: z.enum(['EOA', 'SAFE']).describe('Execution strategy: EOA for direct signing or SAFE for Gnosis Safe execution'),
  idempotency_key: z.string().uuid().optional().describe('Optional UUID for preventing duplicate transaction submissions')
});

export type EnqueueTransactionParams = z.infer<typeof enqueueTransactionParams>;

export const enqueueTransactionSchema = {
  description: 'Enqueues a transaction for execution by the worker. Supports both EOA and Gnosis Safe execution strategies. Calculates payload hash for idempotency.',
  inputSchema: enqueueTransactionParams.shape,
};

/**
 * Calculate SHA256 hash of canonicalized payload for idempotency
 */
function calculatePayloadHash(payload: { to: string; data: string; value: string }): string {
  // Canonicalize the payload by sorting keys and normalizing values
  const canonicalized = {
    to: payload.to.toLowerCase(),
    data: payload.data.toLowerCase(),
    // Normalize zero value representations to a consistent '0'
    value: (payload.value === '0' || payload.value.toLowerCase() === '0x0' || /^0x0+$/.test(payload.value.toLowerCase())) ? '0' : payload.value.toLowerCase()
  };
  
  const canonicalString = JSON.stringify(canonicalized, Object.keys(canonicalized).sort());
  return createHash('sha256').update(canonicalString).digest('hex');
}

export async function enqueueTransaction(params: EnqueueTransactionParams) {
  try {
    // Validate parameters
    const parseResult = enqueueTransactionParams.safeParse(params);
    if (!parseResult.success) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ 
            ok: false, 
            code: 'VALIDATION_ERROR', 
            message: `Invalid parameters: ${parseResult.error.message}`,
            details: parseResult.error.flatten()
          }, null, 2)
        }]
      };
    }

    const { payload, chain_id, execution_strategy, idempotency_key } = parseResult.data;
    const { requestId } = getCurrentJobContext();

    /*
    if (!jobId) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ok: false,
            code: 'CONTEXT_ERROR',
            message: 'Could not find source_job_id in the current job context.'
          }, null, 2)
        }]
      };
    }
    */
    
    // Ensure payload has all required fields after validation
    const validPayload = {
      to: payload.to,
      data: payload.data,
      value: payload.value || '0'
    };
    
    // --- BEGIN NEW VALIDATION LOGIC ---
    const allowlist = await getAllowlist();
    const chainConfig = allowlist[chain_id.toString()];

    if (!chainConfig) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'CHAIN_MISMATCH', message: `Chain ID ${chain_id} is not supported.`}) }] };
    }

    const contractConfig = chainConfig.contracts[validPayload.to.toLowerCase()];
    if (!contractConfig) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'ALLOWLIST_VIOLATION', message: `Contract address ${validPayload.to} is not in the allowlist for chain ${chain_id}.`}) }] };
    }
    
    if (validPayload.data.length < 10) {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'INVALID_PAYLOAD', message: 'Payload data is too short to contain a function selector.'}) }] };
    }

    const selector = validPayload.data.slice(0, 10).toLowerCase();
    if (!contractConfig.allowedSelectors.map(s => s.toLowerCase()).includes(selector)) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'ALLOWLIST_VIOLATION', message: `Function selector ${selector} is not allowed for contract ${validPayload.to}.`}) }] };
    }
    // --- END NEW VALIDATION LOGIC ---

    // Calculate payload hash for idempotency
    const payload_hash = calculatePayloadHash(validPayload);

    // Route via Control API when enabled
    if (isControlApiEnabled()) {
      const CONTROL_API_URL = process.env.CONTROL_API_URL || 'http://localhost:4001/graphql';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Worker-Address': process.env.MECH_WORKER_ADDRESS || ''
      };
      const query = `mutation Enqueue($requestId: String, $chain_id: Int!, $execution_strategy: String!, $payload: String!, $idempotency_key: String) {
        enqueueTransaction(requestId: $requestId, chain_id: $chain_id, execution_strategy: $execution_strategy, payload: $payload, idempotency_key: $idempotency_key) {
          id
          payload_hash
          status
          created_at
          chain_id
          execution_strategy
          idempotency_key
        }
      }`;

      const body = {
        query,
        variables: {
          requestId: requestId ?? null,
          chain_id,
          execution_strategy,
          payload: JSON.stringify(validPayload),
          idempotency_key: idempotency_key ?? null
        }
      };

      const res = await fetch(CONTROL_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.errors) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, code: 'CONTROL_API_ERROR', message: json.errors[0]?.message || 'Unknown error' }, null, 2) }] };
      }
      const tr = json.data.enqueueTransaction;
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, transaction_request: tr }, null, 2) }] };
    }

    // Fallback: legacy path removed for onchain migration
    workerLogger.warn('Control API disabled; enqueue_transaction requires Control API.');
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, code: 'CONTROL_API_DISABLED', message: 'Enable USE_CONTROL_API to enqueue transactions.' }, null, 2) }] };

  } catch (error: any) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ok: false,
          code: 'UNEXPECTED_ERROR',
          message: 'An unexpected error occurred',
          error: error.message
        }, null, 2)
      }]
    };
  }
}
