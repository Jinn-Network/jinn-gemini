/**
 * IPFS metadata fetching and enrichment
 */

import { workerLogger } from '../../logging/index.js';
import {
  getOptionalIpfsGatewayUrl,
  getIpfsFetchTimeoutMs,
} from '../../gemini-agent/mcp/tools/shared/env.js';
import type { IpfsMetadata } from '../types.js';

/**
 * Fetch IPFS metadata from gateway
 */
export async function fetchIpfsMetadata(ipfsHash?: string): Promise<IpfsMetadata | null> {
  if (!ipfsHash) return null;
  try {
    const hash = String(ipfsHash).replace(/^0x/, '');
    // Use configured IPFS gateway or fallback to Autonolas
    const gatewayBase = getOptionalIpfsGatewayUrl() || 'https://gateway.autonolas.tech/ipfs/';
    const url = gatewayBase.endsWith('/') ? `${gatewayBase}${hash}` : `${gatewayBase}/${hash}`;
    
    const timeoutMs = getIpfsFetchTimeoutMs() ?? 7000;
    workerLogger.info({ url, hash, timeout: timeoutMs }, 'Fetching IPFS metadata');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);

    workerLogger.info({ status: res.status, statusText: res.statusText }, 'IPFS fetch response');

    if (!res.ok) {
      workerLogger.warn({ status: res.status, statusText: res.statusText, url }, 'IPFS fetch returned non-OK status');
      return null;
    }

    const json = await res.json();
    const prompt = json?.prompt || json?.input || undefined;
    const enabledTools = Array.isArray(json?.enabledTools) ? json.enabledTools : undefined;
    const sourceRequestId = json?.sourceRequestId ? String(json.sourceRequestId) : undefined;
    const sourceJobDefinitionId = json?.sourceJobDefinitionId ? String(json.sourceJobDefinitionId) : undefined;
    const additionalContext = json?.additionalContext || undefined;
    const jobName = json?.jobName ? String(json.jobName) : undefined;
    const jobDefinitionId = json?.jobDefinitionId ? String(json.jobDefinitionId) : undefined;
    const codeMetadata = json?.codeMetadata && typeof json.codeMetadata === 'object'
      ? (json.codeMetadata as any)
      : undefined;
    const model = json?.model ? String(json.model) : undefined;
    
    return {
      prompt,
      enabledTools,
      sourceRequestId,
      sourceJobDefinitionId,
      additionalContext,
      jobName,
      jobDefinitionId,
      codeMetadata,
      model,
    };
  } catch (e: any) {
    workerLogger.warn({ error: e?.message || String(e) }, 'Failed to fetch IPFS metadata; proceeding without it');
    return null;
  }
}

