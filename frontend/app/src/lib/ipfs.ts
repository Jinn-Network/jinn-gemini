
// Helper to build CID candidates from hex digest
function buildCidV1HexCandidates(hexBytes: string): string[] {
    const hexClean = hexBytes.startsWith('0x') ? hexBytes.slice(2) : hexBytes
    // Try dag-pb (0x70) first, then raw (0x55) - dag-pb is used for directories
    return [
        `f01701220${hexClean}`,
        `f01551220${hexClean}`,
    ]
}

function isFullCidString(value: string): boolean {
    // Accept base32/base58 CIDs (baf*, Qm*) and hex-base16 CIDs (f01...)
    return /^baf|^Qm|^f01/i.test(value)
}

function extractDigestHexFromHexCid(hexCid: string): string | null {
    const s = hexCid.toLowerCase()
    if (s.startsWith('f01701220')) return s.slice(10)
    if (s.startsWith('f01551220')) return s.slice(10)
    return null
}

// Convert hex CID to base32 CID for directory access
function hexCidToBase32DagPb(hexCid: string): string | null {
    try {
        // Extract digest from raw codec CID
        const digestHex = hexCid.toLowerCase().replace(/^f01551220/i, '')
        if (digestHex === hexCid.toLowerCase()) return null // Not a raw codec CID

        // Convert hex digest to bytes
        const digestBytes: number[] = []
        for (let i = 0; i < digestHex.length; i += 2) {
            digestBytes.push(parseInt(digestHex.slice(i, i + 2), 16))
        }

        // Build CIDv1 dag-pb bytes: [0x01] + [0x70] (dag-pb) + multihash: [0x12, 0x20] + digest
        const cidBytes = [0x01, 0x70, 0x12, 0x20, ...digestBytes]

        // Base32 encode (lowercase, no padding)
        const base32Alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
        let bitBuffer = 0
        let bitCount = 0
        let out = ''
        for (const b of cidBytes) {
            bitBuffer = (bitBuffer << 8) | (b & 0xff)
            bitCount += 8
            while (bitCount >= 5) {
                const idx = (bitBuffer >> (bitCount - 5)) & 0x1f
                bitCount -= 5
                out += base32Alphabet[idx]
            }
        }
        if (bitCount > 0) {
            const idx = (bitBuffer << (5 - bitCount)) & 0x1f
            out += base32Alphabet[idx]
        }

        return 'b' + out
    } catch (error) {
        console.error('[IPFS] Error converting hex CID to base32:', error)
        return null
    }
}

// Helper to fetch IPFS content with requestId for deliveries
export async function fetchIpfsContent(
    ipfsHash: string,
    requestId?: string,
    timeout: number = 10000
): Promise<{ content: string; contentType: string } | null> {
    const gatewayUrl = 'https://gateway.autonolas.tech/ipfs/'
    const fallbackGatewayUrl = 'https://ipfs.io/ipfs/'

    console.log(`[IPFS] Input hash: ${ipfsHash}, requestId: ${requestId || 'none'}`)

    const isFullCid = isFullCidString(ipfsHash)
    let candidates: string[]

    // For deliveries with requestId, convert to base32 for directory access
    if (requestId && isFullCid && /^f01551220/i.test(ipfsHash)) {
        // Delivery hash: convert from hex raw codec to base32 dag-pb codec
        const base32Cid = hexCidToBase32DagPb(ipfsHash)
        if (base32Cid) {
            console.log(`[IPFS] Converted hex CID to base32 for directory access: ${base32Cid}`)
            candidates = [base32Cid]
        } else {
            // Fallback to trying hex variants
            const digest = extractDigestHexFromHexCid(ipfsHash)
            if (digest) {
                candidates = [`f01701220${digest}`, `f01551220${digest}`]
            } else {
                candidates = [ipfsHash]
            }
        }
    } else if (isFullCid && /^f01/i.test(ipfsHash)) {
        // Request metadata: use hex CID as-is, try alternates
        if (ipfsHash.toLowerCase().startsWith('f01551220')) {
            const digest = extractDigestHexFromHexCid(ipfsHash)
            const dagPb = digest ? `f01701220${digest}` : null
            candidates = dagPb ? [ipfsHash, dagPb] : [ipfsHash]
        } else {
            const digest = extractDigestHexFromHexCid(ipfsHash)
            const raw = digest ? `f01551220${digest}` : null
            candidates = raw ? [ipfsHash, raw] : [ipfsHash]
        }
    } else if (isFullCid) {
        // Base32 or base58 CID - use as-is
        candidates = [ipfsHash]
    } else {
        // Hex digest without CID wrapper - build candidates
        candidates = buildCidV1HexCandidates(ipfsHash)
    }

    console.log(`[IPFS] CID candidates:`, candidates)

    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)

        for (const cid of candidates) {
            // For delivery hashes, append /${requestId}
            const path = requestId ? `${cid}/${requestId}` : cid
            const url = `${gatewayUrl}${path}`

            console.log(`[IPFS] Attempting to fetch: ${url}`)

            let response: Response | undefined
            try {
                response = await fetch(url, {
                    signal: controller.signal,
                    mode: 'cors',
                    cache: 'no-cache'
                })
                console.log(`[IPFS] Primary gateway response status: ${response.status}`)
            } catch (fetchError) {
                console.error(`[IPFS] Primary gateway failed:`, fetchError)
                // Try fallback gateway
                const fbUrl = `${fallbackGatewayUrl}${path}`
                console.log(`[IPFS] Trying fallback: ${fbUrl}`)
                try {
                    response = await fetch(fbUrl, {
                        signal: controller.signal,
                        mode: 'cors',
                        cache: 'no-cache'
                    })
                    console.log(`[IPFS] Fallback gateway response status: ${response.status}`)
                } catch (fallbackError) {
                    console.error(`[IPFS] Fallback gateway failed:`, fallbackError)
                    continue
                }
            }

            if (!response || !response.ok) {
                console.log(`[IPFS] Response not OK: ${response?.status} ${response?.statusText}`)
                continue
            }

            clearTimeout(timer)
            const contentType = response.headers.get('content-type') || 'text/plain'
            console.log(`[IPFS] Success! Content-Type: ${contentType}`)

            // Read as text first, then try to parse as JSON
            const text = await response.text()

            // Try to parse as JSON
            try {
                const json = JSON.parse(text)
                return {
                    content: JSON.stringify(json, null, 2),
                    contentType: 'application/json'
                }
            } catch {
                // Return as plain text if not JSON
                return {
                    content: text,
                    contentType
                }
            }
        }
    } catch (error) {
        console.error(`[IPFS] Error fetching content:`, error)
    }

    return null
}
