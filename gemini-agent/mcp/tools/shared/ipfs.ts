import fetch from 'cross-fetch';

const DEFAULT_IPFS_GATEWAY = 'https://gateway.autonolas.tech/ipfs/';
const FALLBACK_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

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

export async function resolveIpfsContent(ipfsHash: string, requestId: string, timeout: number = 10000): Promise<any> {
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

export async function resolveRequestIpfsContent(ipfsHash: string, timeout: number = 10000): Promise<any> {
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
