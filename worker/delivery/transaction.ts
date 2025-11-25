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
 * Track pending delivery transactions to prevent duplicates
 * Maps requestId -> { txHash, timestamp }
 */
const pendingDeliveries = new Map<string, { txHash: string; timestamp: number }>();

/**
 * Clear stale pending deliveries (older than 3 minutes)
 */
function clearStalePendingDeliveries(): void {
  const now = Date.now();
  const staleThreshold = 180000; // 3 minutes
  
  for (const [requestId, delivery] of pendingDeliveries.entries()) {
    if (now - delivery.timestamp > staleThreshold) {
      workerLogger.debug({ requestId, staleTxHash: delivery.txHash, ageMs: now - delivery.timestamp }, 'Clearing stale pending delivery');
      pendingDeliveries.delete(requestId);
    }
  }
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
    const ids: string[] = await contract.methods.getUndeliveredRequestIds(5000, 0).call();
    const set = new Set((ids || []).map((x: string) => String(x).toLowerCase()));
    const isUndelivered = set.has(String(requestIdHex).toLowerCase());
    
    if (!isUndelivered) {
      workerLogger.warn({ 
        requestIdHex, 
        totalUndelivered: ids.length,
        fetchLimit: 5000 
      }, 'Request not found in on-chain undelivered set (may be outside fetch window)');
    }
    
    return isUndelivered;
  } catch (error: any) {
    workerLogger.warn({ error: error?.message }, 'Failed to check on-chain delivery status; assuming undelivered');
    return true; // don't fail hard on preflight errors
  }
}

/**
 * Check if a transaction emitted a RevokeRequest event
 */
export async function wasRequestRevoked(params: {
  txHash: string;
  requestIdHex: string;
  mechAddress: string;
  rpcHttpUrl?: string;
}): Promise<boolean> {
  const { txHash, requestIdHex, mechAddress, rpcHttpUrl } = params;
  try {
    if (!rpcHttpUrl) return false;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const agentMechArtifact = await import('@jinn-network/mech-client-ts/dist/abis/AgentMech.json');
    const abi: any = (agentMechArtifact as any)?.abi || (agentMechArtifact as any);
    const web3 = new Web3(rpcHttpUrl);
    
    // Get transaction receipt
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    if (!receipt || !receipt.logs) {
      workerLogger.debug({ txHash, hasReceipt: !!receipt, hasLogs: !!receipt?.logs }, 'No logs in receipt');
      return false;
    }
    
    // Parse logs for RevokeRequest event
    // Event signature: RevokeRequest(bytes32 requestId) - requestId is not indexed, so it's in data
    const contract = new (web3 as any).eth.Contract(abi, mechAddress);
    const revokeEventSignature = web3.utils.keccak256('RevokeRequest(bytes32)');
    
    workerLogger.debug({ 
      txHash, 
      totalLogs: receipt.logs.length, 
      revokeEventSignature,
      mechAddress 
    }, 'Checking logs for RevokeRequest');
    
    for (const log of receipt.logs) {
      workerLogger.debug({ 
        logAddress: log.address, 
        logTopics: log.topics,
        logData: log.data,
        matchesAddress: log.address.toLowerCase() === mechAddress.toLowerCase(),
        matchesSignature: log.topics[0] === revokeEventSignature
      }, 'Inspecting log');
      
      if (log.topics[0] === revokeEventSignature && 
          log.address.toLowerCase() === mechAddress.toLowerCase()) {
        // Decode the requestId from the data field (not topics, since it's not indexed)
        // data field is the raw bytes32 requestId
        const decodedRequestId = log.data;
        workerLogger.debug({ decodedRequestId, expectedRequestId: requestIdHex }, 'Found RevokeRequest event, checking requestId');
        if (decodedRequestId.toLowerCase() === requestIdHex.toLowerCase()) {
          workerLogger.warn({ txHash, requestId: requestIdHex }, 'RevokeRequest event detected for this request');
          return true;
        }
      }
    }
    workerLogger.debug({ txHash }, 'No RevokeRequest event found for this request');
    return false;
  } catch (e: any) {
    workerLogger.warn({ txHash, error: e?.message }, 'Failed to check for RevokeRequest event');
    return false;
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
  
  // Clear stale pending deliveries before checking
  clearStalePendingDeliveries();
  
  // Check if there's already a pending delivery for this request
  const pendingDelivery = pendingDeliveries.get(context.requestId);
  if (pendingDelivery) {
    const age = Date.now() - pendingDelivery.timestamp;
    workerLogger.warn({ 
      requestId: context.requestId, 
      pendingTxHash: pendingDelivery.txHash,
      ageSeconds: Math.floor(age / 1000)
    }, 'Delivery already in progress for this request; will verify on-chain state');
    
    // Try to get the transaction receipt to see if it actually succeeded
    try {
      const web3 = new Web3(rpcHttpUrl);
      const receipt = await web3.eth.getTransactionReceipt(pendingDelivery.txHash);
      if (receipt) {
        // Transaction completed, clear from pending and check if successful
        pendingDeliveries.delete(context.requestId);
        workerLogger.info({ 
          requestId: context.requestId, 
          txHash: pendingDelivery.txHash,
          status: receipt.status 
        }, 'Previous pending transaction completed');
        
        if (receipt.status) {
          return { tx_hash: pendingDelivery.txHash, status: 'confirmed' };
        }
      } else {
        // Transaction still pending, reject duplicate
        workerLogger.warn({ requestId: context.requestId, pendingTxHash: pendingDelivery.txHash }, 'Previous transaction still pending');
        throw new Error('Delivery transaction already pending');
      }
    } catch (receiptError: any) {
      // Couldn't check receipt, be conservative and reject
      workerLogger.warn({ requestId: context.requestId, error: receiptError?.message }, 'Failed to check pending transaction status');
      throw new Error('Delivery transaction already pending (status unknown)');
    }
  }
  
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
    finalStatus: context.finalStatus,
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

  try {
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
        
        // Track the transaction hash immediately after submission
        if (delivery?.tx_hash) {
          pendingDeliveries.set(context.requestId, {
            txHash: delivery.tx_hash,
            timestamp: Date.now()
          });
          workerLogger.debug({ requestId: context.requestId, txHash: delivery.tx_hash }, 'Tracking delivery transaction');
        }
        
        break; // Success
      } catch (e: any) {
        lastError = e;
        // Only retry on likely transient errors or timeouts - but NOT "Transaction not found" anymore
        // since we now wait 60s for the receipt
        if (e.message?.includes('timeout') || e.message?.includes('not mined') || e.message?.includes('nonce too low')) {
           workerLogger.warn({ requestId: context.requestId, error: e.message }, 'Safe delivery timeout, transient error, or nonce issue');
           continue;
        }
        throw e; // Fail fast on other errors
      }
    }
    
    if (!delivery && lastError) throw lastError;

    workerLogger.info({ requestId: context.requestId, tx: delivery?.tx_hash, status: delivery?.status }, 'Delivered via Safe');
    
    // Check if the transaction actually revoked the request instead of delivering
    if (delivery?.tx_hash) {
      const wasRevoked = await wasRequestRevoked({
        txHash: delivery.tx_hash,
        requestIdHex,
        mechAddress: targetMechAddress,
        rpcHttpUrl,
      });
      
      if (wasRevoked) {
        workerLogger.error({ requestId: context.requestId, tx: delivery.tx_hash }, 'Request was REVOKED instead of delivered - likely contract state issue');
        throw new Error('Request was revoked by the Mech contract during delivery');
      }
    }
    
    return {
      tx_hash: delivery?.tx_hash,
      status: delivery?.status,
    };
  } finally {
    // Clean up pending delivery tracking on completion (success or failure)
    if (context.requestId && pendingDeliveries.has(context.requestId)) {
      pendingDeliveries.delete(context.requestId);
      workerLogger.debug({ requestId: context.requestId }, 'Cleared pending delivery tracking');
    }
  }
}

