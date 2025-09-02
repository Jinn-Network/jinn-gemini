import { z } from 'zod';
import { createHash } from 'crypto';
import { supabase } from './shared/supabase.js';
// import { getJobContext } from './shared/context.js'; // No longer needed
import { getAllowlist } from './shared/allowlist.js';

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
    // const { jobId } = getJobContext(); // Removed job context dependency

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

    // Insert transaction request
    const insertData: any = {
      payload: validPayload,
      chain_id,
      payload_hash,
      execution_strategy,
      // source_job_id: jobId // Removed job ID from insert
    };

    if (idempotency_key) {
      insertData.idempotency_key = idempotency_key;
    }

    const { data, error } = await supabase
      .from('transaction_requests')
      .insert(insertData)
      .select('id, payload_hash, created_at, execution_strategy, idempotency_key')
      .single();

    if (error) {
      // Check for unique constraint violation (duplicate hash)
      if (error.code === '23505' && error.message.includes('uq_payload_hash')) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              code: 'DUPLICATE_TRANSACTION',
              message: 'Transaction with identical payload already exists',
              payload_hash
            }, null, 2)
          }]
        };
      }
      // Check for unique constraint violation (duplicate idempotency key)
      else if (error.code === '23505' && error.message.includes('transaction_requests_idempotency_key_key')) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              code: 'DUPLICATE_TRANSACTION',
              message: 'Transaction with identical idempotency key already exists',
              idempotency_key
            }, null, 2)
          }]
        };
      }

      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ok: false,
            code: 'DATABASE_ERROR',
            message: 'Failed to enqueue transaction',
            error: error.message
          }, null, 2)
        }]
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ok: true,
          transaction_request: {
            id: data.id,
            payload_hash: data.payload_hash,
            status: 'PENDING',
            created_at: data.created_at,
            chain_id,
            execution_strategy: data.execution_strategy,
            idempotency_key: data.idempotency_key,
            payload: validPayload
          }
        }, null, 2)
      }]
    };

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
