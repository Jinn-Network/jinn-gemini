import fetch from 'cross-fetch';

const DEFAULT_IPFS_GATEWAY = 'https://gateway.autonolas.tech/ipfs/';
const FALLBACK_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second
const MAX_RETRY_DELAY_MS = 10000; // 10 seconds

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(attemptNumber: number): number {
  const exponentialDelay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attemptNumber);
  const cappedDelay = Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
  // Add jitter (±25%)
  const jitter = cappedDelay * 0.25 * (Math.random() - 0.5);
  return Math.floor(cappedDelay + jitter);
}

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  shouldRetry: (result: T) => boolean,
  context: string
): Promise<T> {
  let lastResult: T;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastResult = await fn();
    
    // If result is successful (shouldn't retry), return immediately
    if (!shouldRetry(lastResult)) {
      return lastResult;
    }
    
    // If this was the last attempt, return the result
    if (attempt === MAX_RETRIES) {
      console.warn(`[IPFS] All ${MAX_RETRIES + 1} attempts failed for ${context}`);
      return lastResult;
    }
    
    // Calculate delay and wait before next attempt
    const delay = calculateBackoffDelay(attempt);
    console.log(`[IPFS] Attempt ${attempt + 1} failed for ${context}, retrying in ${delay}ms...`);
    await sleep(delay);
  }
  
  return lastResult!;
}

function buildCidV1HexCandidates(hexBytes: string): string[] {
  const hexClean = hexBytes.startsWith('0x') ? hexBytes.slice(2) : hexBytes;
  // Try dag-pb (0x70) and raw (0x55)
  return [
    `f01701220${hexClean}`,
    `f01551220${hexClean}`,
  ];
}

function isFullCidString(value: string): boolean {
  // Accept base32/base58 CIDs and hex-base16 CIDs (f01...)
  return /^bafy|^Qm|^f01/i.test(value);
}

function extractDigestHexFromHexCid(hexCid: string): string | null {
  const s = hexCid.toLowerCase();
  if (s.startsWith('f01701220')) return s.slice(10);
  if (s.startsWith('f01551220')) return s.slice(10);
  return null;
}

function toDecimalRequestIdStrict(id: string): string {
  const s = String(id).trim();
  return s.startsWith('0x') ? BigInt(s).toString(10) : s;
}

async function resolveIpfsContentInternal(ipfsHash: string, requestId: string, timeout: number = 10000): Promise<any> {
  const gatewayUrl = process.env.IPFS_GATEWAY_URL || DEFAULT_IPFS_GATEWAY;
  const requestIdDec = toDecimalRequestIdStrict(requestId);
  const isFullCid = isFullCidString(ipfsHash);
  let candidates = isFullCid ? [ipfsHash] : buildCidV1HexCandidates(ipfsHash);

  if (isFullCid && /^f01/i.test(ipfsHash)) {
    const digest = extractDigestHexFromHexCid(ipfsHash);
    if (digest) {
      const flipped = ipfsHash.toLowerCase().startsWith('f01701220')
        ? `f01551220${digest}`
        : `f01701220${digest}`;
      candidates = [ipfsHash, flipped];
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    for (const cid of candidates) {
      const url = `${gatewayUrl}${cid}/${requestIdDec}`;
      let response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const fbUrl = `${FALLBACK_IPFS_GATEWAY}${cid}/${requestIdDec}`;
        try {
          response = await fetch(fbUrl, { signal: controller.signal });
        } catch {}
        if (!response.ok) continue;
      }
      clearTimeout(timer);
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      }
      const text = await response.text();
      return { contentType, text };
    }
    clearTimeout(timer);
    return { error: 'IPFS content not found.', status: 404 };
  } catch (error: any) {
    return { error: `Failed to fetch IPFS content: ${error.message}`, status: 500 };
  }
}

export async function resolveIpfsContent(ipfsHash: string, requestId: string, timeout: number = 10000): Promise<any> {
  return retryWithBackoff(
    () => resolveIpfsContentInternal(ipfsHash, requestId, timeout),
    (result) => result.error !== undefined, // Retry if there's an error
    `resolveIpfsContent(${ipfsHash.substring(0, 16)}..., ${requestId.substring(0, 16)}...)`
  );
}

async function resolveRequestIpfsContentInternal(ipfsHash: string, timeout: number = 10000): Promise<any> {
  const gatewayUrl = process.env.IPFS_GATEWAY_URL || DEFAULT_IPFS_GATEWAY;
  const isFullCid = isFullCidString(ipfsHash);
  let candidates = isFullCid ? [ipfsHash] : buildCidV1HexCandidates(ipfsHash);

  if (isFullCid && /^f01/i.test(ipfsHash)) {
    const digest = extractDigestHexFromHexCid(ipfsHash);
    if (digest) {
      const flipped = ipfsHash.toLowerCase().startsWith('f01701220')
        ? `f01551220${digest}`
        : `f01701220${digest}`;
      candidates = [ipfsHash, flipped];
    }
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    for (const cid of candidates) {
      const url = `${gatewayUrl}${cid}`;
      let response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const fbUrl = `${FALLBACK_IPFS_GATEWAY}${cid}`;
        try {
          response = await fetch(fbUrl, { signal: controller.signal });
        } catch {}
        if (!response.ok) continue;
      }
      clearTimeout(timer);
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) return await response.json();
      const text = await response.text();
      return { contentType, text };
    }
    clearTimeout(timer);
    return { error: 'IPFS content not found.', status: 404 };
  } catch (error: any) {
    return { error: `Failed to fetch IPFS content: ${error.message}`, status: 500 };
  }
}

export async function resolveRequestIpfsContent(ipfsHash: string, timeout: number = 10000): Promise<any> {
  return retryWithBackoff(
    () => resolveRequestIpfsContentInternal(ipfsHash, timeout),
    (result) => result.error !== undefined, // Retry if there's an error
    `resolveRequestIpfsContent(${ipfsHash.substring(0, 16)}...)`
  );
}
