/**
 * Transaction delivery: wrap mech-client deliver logic, including Safe/Operate adjustments
 */

import { deliverViaSafe } from '@jinn-network/mech-client-ts/dist/post_deliver.js';
import { Web3 } from 'web3';
import { workerLogger } from '../../logging/index.js';
import { getOptionalMechChainConfig, getRequiredRpcUrl } from '../../gemini-agent/mcp/tools/shared/env.js';
import { getServiceSafeAddress, getServicePrivateKey } from '../../env/operate-profile.js';
import type { UnclaimedRequest, AgentExecutionResult, FinalStatus, IpfsMetadata, RecognitionPhaseResult, ReflectionResult } from '../types.js';
import { buildDeliveryPayload } from './payload.js';

/**
 * Delivery context for transaction
 */
export interface DeliveryTransactionContext {
  requestId: string;
  request: UnclaimedRequest;
  result: AgentExecutionResult;
  finalStatus: FinalStatus;
  metadata: IpfsMetadata;
  recognition?: RecognitionPhaseResult | null;
  reflection?: ReflectionResult | null;
  workerTelemetry?: any;
  artifactsForDelivery?: Array<{ cid: string; topic: string; name?: string; type?: string; contentPreview?: string }>;
}

/**
 * Check if request is undelivered on-chain
 */
export async function isUndeliveredOnChain(params: {
  mechAddress: string;
  requestIdHex: string;
  rpcHttpUrl?: string;
}): Promise<boolean> {
  const { mechAddress, requestIdHex, rpcHttpUrl } = params;
  try {
    if (!rpcHttpUrl) return true; // best-effort: if no RPC provided, don't block delivery
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const agentMechArtifact = await import('@jinn-network/mech-client-ts/dist/abis/AgentMech.json');
    const abi: any = (agentMechArtifact as any)?.abi || (agentMechArtifact as any);
    const web3 = new Web3(rpcHttpUrl);
    const contract = new (web3 as any).eth.Contract(abi, mechAddress);
    const ids: string[] = await contract.methods.getUndeliveredRequestIds(100, 0).call();
    const set = new Set((ids || []).map((x: string) => String(x).toLowerCase()));
    return set.has(String(requestIdHex).toLowerCase());
  } catch {
    return true; // don't fail hard on preflight errors
  }
}

/**
 * Deliver result via Safe transaction
 */
export async function deliverViaSafeTransaction(
  context: DeliveryTransactionContext
): Promise<{ tx_hash?: string; status?: string }> {
  const chainConfig = getOptionalMechChainConfig() || 'base';
  const safeAddress = getServiceSafeAddress();
  const targetMechAddress = context.request.mech;
  const privateKey = getServicePrivateKey();
  const rpcHttpUrl = getRequiredRpcUrl();

  if (!safeAddress || !privateKey) {
    workerLogger.warn({ safeAddress: !!safeAddress, privateKey: !!privateKey }, 'Missing Safe delivery configuration; skipping on-chain delivery');
    throw new Error('Missing Safe delivery configuration');
  }

  // Check Safe deployment
  if (safeAddress && rpcHttpUrl) {
    try {
      const web3 = new Web3(rpcHttpUrl);
      const code = await web3.eth.getCode(safeAddress);
      if (!code || code === '0x' || code.length <= 2) {
        workerLogger.warn({ safeAddress }, 'Safe address has no contract code; skipping Safe delivery (use direct EOA delivery or deploy Safe first)');
        throw new Error('Safe address has no contract code');
      }
    } catch (deploymentCheckError: any) {
      workerLogger.warn({ safeAddress, error: deploymentCheckError?.message }, 'Failed to check Safe deployment; skipping Safe delivery');
      throw deploymentCheckError;
    }
  }

  // Preflight check: ensure request is undelivered
  const requestIdHex = String(context.requestId).startsWith('0x')
    ? String(context.requestId)
    : '0x' + BigInt(String(context.requestId)).toString(16);
  
  const isUndelivered = await isUndeliveredOnChain({
    mechAddress: targetMechAddress,
    requestIdHex,
    rpcHttpUrl,
  });
  
  if (!isUndelivered) {
    workerLogger.info({ requestId: context.requestId, requestIdHex }, 'Preflight: request already delivered or not eligible; skipping Safe delivery');
    throw new Error('Request already delivered');
  }

  // Build delivery payload
  const resultContent = buildDeliveryPayload({
    requestId: context.requestId,
    result: context.result,
    metadata: context.metadata,
    recognition: context.recognition,
    reflection: context.reflection,
    workerTelemetry: context.workerTelemetry,
  });

  // Add artifacts if provided
  if (context.artifactsForDelivery && context.artifactsForDelivery.length > 0) {
    resultContent.artifacts = context.artifactsForDelivery;
  }

  const payload = {
    chainConfig,
    requestId: String(context.requestId),
    resultContent,
    targetMechAddress,
    safeAddress,
    privateKey,
    ...(rpcHttpUrl ? { rpcHttpUrl } : {}),
    wait: true,
  } as const;

  let delivery: any;
  const maxRetries = 2;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.pow(2, attempt) * 5000;
      workerLogger.info({ requestId: context.requestId, attempt, backoffMs }, 'Retrying Safe delivery');
      await new Promise(r => setTimeout(r, backoffMs));
      
      // Re-check delivery status
      try {
        const isUndelivered = await isUndeliveredOnChain({
            mechAddress: targetMechAddress,
            requestIdHex,
            rpcHttpUrl,
        });
        if (!isUndelivered) {
             workerLogger.info({ requestId: context.requestId }, 'Request already delivered on retry check');
             return { status: 'confirmed' };
        }
      } catch (e) { /* ignore check errors */ }
    }

    try {
      delivery = await (deliverViaSafe as any)(payload);
      break; // Success
    } catch (e: any) {
      lastError = e;
      // Only retry on likely transient errors or timeouts
      if (e.message?.includes('timeout') || e.message?.includes('not mined') || e.message?.includes('Transaction not found')) {
         workerLogger.warn({ requestId: context.requestId, error: e.message }, 'Safe delivery timeout or transient error');
         continue;
      }
      throw e; // Fail fast on other errors
    }
  }
  
  if (!delivery && lastError) throw lastError;

  workerLogger.info({ requestId: context.requestId, tx: delivery?.tx_hash, status: delivery?.status }, 'Delivered via Safe');
  
  return {
    tx_hash: delivery?.tx_hash,
    status: delivery?.status,
  };
}

