import { ponder } from "@/generated";
import fetch from "cross-fetch";
import axios from "axios";
import { logger, serializeError } from "../../logging/index.js";
import { Pool } from "pg";

// Minimal local types to avoid implicit any in handler params
type Repository = {
  upsert: (args: unknown) => Promise<unknown>;
};

interface PonderContextShape {
  db?: Record<string, Repository>;
  entities?: Record<string, Repository>;
}

interface PonderEventShape {
  args: Record<string, unknown>;
  transaction: { hash: string };
  block: { number: number | bigint | string; timestamp: number | bigint | string };
}

// Helpers for safe coercion from unknown shapes
const toStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.map((x) => String(x)) : [];
};

const toBigIntCoercible = (value: unknown): string | number | bigint => {
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  return 0;
};

function safeJsonClone<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val)),
  );
}

const NODE_EMBEDDINGS_DB_URL =
  process.env.NODE_EMBEDDINGS_DB_URL ||
  process.env.SITUATION_DB_URL ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.SUPABASE_POSTGRES_URL ||
  null;

let vectorDbPool: Pool | null = null;
const IPFS_GATEWAY_BASE = (process.env.IPFS_GATEWAY_URL || "https://gateway.autonolas.tech/ipfs/").replace(/\/+$/, "/");
const IPFS_GATEWAY_FALLBACKS = [
  "https://cloudflare-ipfs.com/ipfs/"
  // Reduced fallbacks during historical sync to fail faster on unpinned/corrupt content
  // Full list: ipfs.io, dweb.link (can re-enable if needed)
];

function getVectorDbPool(): Pool | null {
  if (!NODE_EMBEDDINGS_DB_URL) return null;
  if (!vectorDbPool) {
    vectorDbPool = new Pool({ connectionString: NODE_EMBEDDINGS_DB_URL });
  }
  return vectorDbPool;
}

function truncate(text: unknown, max = 800): string | null {
  if (text === undefined || text === null) return null;
  const str = String(text).trim();
  if (!str) return null;
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function formatVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

function hexToBytes(hex: string): number[] {
  const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (cleaned.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${hex}`);
  }
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    const byte = parseInt(cleaned.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex byte "${cleaned.slice(i, i + 2)}" in ${hex}`);
    }
    bytes.push(byte);
  }
  return bytes;
}

function encodeBase32LowerNoPadding(bytes: number[]): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | (byte & 0xff);
    bits += 8;
    while (bits >= 5) {
      const index = (buffer >> (bits - 5)) & 0x1f;
      bits -= 5;
      output += alphabet[index];
    }
  }
  if (bits > 0) {
    const index = (buffer << (5 - bits)) & 0x1f;
    output += alphabet[index];
  }
  return output;
}

function buildRawCidFromDigest(digestHex: string): { cidHex: string; cidBase32: string } {
  const normalized = digestHex.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`Digest must be 32 bytes (64 hex chars). Received "${digestHex}"`);
  }
  const digestBytes = hexToBytes(normalized);
  const cidBytes = [0x01, 0x55, 0x12, 0x20, ...digestBytes];
  const cidHex = `f01551220${normalized}`;
  const cidBase32 = `b${encodeBase32LowerNoPadding(cidBytes)}`;
  return { cidHex, cidBase32 };
}

async function fetchRequestMetadata(cidBase32: string, timeoutMs = 5_000): Promise<any> {
  const gateways = [IPFS_GATEWAY_BASE, ...IPFS_GATEWAY_FALLBACKS];
  let lastError: Error | null = null;

  for (const gateway of gateways) {
    const url = `${gateway}${cidBase32}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(url, { signal: controller.signal });
      
      if (!response.ok) {
        const msg = `HTTP ${response.status} from ${gateway}`;
        logger.debug({ cidBase32, gateway, status: response.status }, "IPFS gateway failed, trying next");
        lastError = new Error(msg);
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      // Accept both application/json and application/octet-stream for raw IPFS CIDs
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (parseError: any) {
        const msg = `JSON parse error from ${gateway}: ${parseError.message}`;
        logger.warn({ cidBase32, gateway, error: parseError.message }, "IPFS JSON parse failed, trying next");
        lastError = new Error(msg);
        continue;
      }
    } catch (error: any) {
      lastError = error;
      logger.debug({ cidBase32, gateway, error: error.message }, "IPFS fetch network error, trying next");
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Failed to fetch request metadata from any gateway. Last error: ${lastError?.message}`);
}

/**
 * Traverses up the request chain to find the ultimate root request ID (workstream root).
 * @param startRequestId The ID of the request to start traversal from (the immediate parent).
 * @param requestRepo The Ponder repository for requests.
 * @returns The ID of the root request (workstream ID).
 */
async function findWorkstreamRoot(
  startRequestId: string,
  requestRepo: any,
): Promise<string> {
  let currentId = startRequestId;
  const visited = new Set<string>();

  // Limit traversal to prevent infinite loops in case of data cycles
  for (let i = 0; i < 100; i++) {
    // Prevent cycles
    if (visited.has(currentId)) {
      logger.warn({ requestId: currentId }, 'Detected cycle in request chain during workstream root search');
      return currentId;
    }
    visited.add(currentId);

    try {
      const request = await requestRepo.findUnique({ id: currentId });
      if (!request || !request.sourceRequestId) {
        // We've found the root (no parent) or the trail goes cold.
        return currentId;
      }
      // Move up the chain
      currentId = request.sourceRequestId;
    } catch (e) {
      // If we can't find the parent, treat current as root
      logger.warn({ requestId: currentId, error: serializeError(e) }, 'Failed to fetch parent request during workstream root search');
      return currentId;
    }
  }

  logger.warn({ startRequestId, currentId }, 'Workstream root search exceeded 100 iterations');
  return currentId; // Fallback to last known ID
}

ponder.on(
  "MechMarketplace:MarketplaceRequest",
  async ({ event, context }: { event: PonderEventShape; context: PonderContextShape }) => {
  try {
    const mech: string = String(event.args.priorityMech);
    const sender: string = String(event.args.requester);
    const requestIds: string[] = toStringArray((event.args as any).requestIds);
    const requestDatas: string[] = toStringArray((event.args as any).requestDatas);
    const txHash: string = String(event.transaction.hash);
    const blockNumber: bigint = BigInt(toBigIntCoercible(event.block.number));
    const blockTimestamp: bigint = BigInt(toBigIntCoercible(event.block.timestamp));

    const repo = (context as any).db?.request || (context as any).entities?.request;
    const jobDefRepo = (context as any).db?.jobDefinition || (context as any).entities?.jobDefinition;
    const messageRepo = (context as any).db?.message || (context as any).entities?.message;
    if (!repo) {
      logger.error("No repository for 'request' (neither context.db nor context.entities). Skipping upsert.");
      return;
    }

    for (let i = 0; i < requestIds.length; i++) {
      const id = requestIds[i];
      const dataHex = requestDatas?.[i];
      if (!dataHex) {
        throw new Error(`MarketplaceRequest missing requestDatas entry for request ${id}`);
      }
      const digestHex = String(dataHex).replace(/^0x/, '').toLowerCase();
      const { cidHex: ipfsHash, cidBase32 } = buildRawCidFromDigest(digestHex);
      
      logger.info({ requestId: id, ipfsHash, cidBase32, txHash }, "Processing MarketplaceRequest - pre-seeding request row");
      
      // Pre-seed request row immediately with minimal fields available from chain event
      // This ensures the request exists in DB before expensive IPFS fetch completes,
      // preventing Deliver events from hitting null constraint errors
      try {
        await repo.upsert({
          id,
          create: {
            mech,
            sender,
            workstreamId: id, // Temporary: will be recomputed after metadata fetch if sourceRequestId exists
            transactionHash: txHash,
            blockNumber,
            blockTimestamp,
            ipfsHash,
            delivered: false,
          },
          update: {
            // Don't overwrite existing fields during pre-seed
          },
        });
        logger.info({ requestId: id }, "Pre-seed upsert completed successfully");
      } catch (upsertError: any) {
        logger.error({ requestId: id, error: serializeError(upsertError) }, "Pre-seed upsert failed");
        throw upsertError;
      }
      
      // Now fetch IPFS metadata (expensive operation)
      // Wrap in try-catch to ensure we always complete the enriched update,
      // even if IPFS fetch fails (though it should not fail in normal operation)
      let content: any = null;
      try {
        logger.info({ requestId: id, cidBase32 }, "Fetching IPFS metadata");
        content = await fetchRequestMetadata(cidBase32);
        if (!content || typeof content !== "object") {
          throw new Error(`IPFS payload for request ${id} is empty or malformed`);
        }
        logger.info({ requestId: id, hasJobName: !!content.jobName, hasJobDefinitionId: !!content.jobDefinitionId }, "IPFS metadata fetched successfully");
      } catch (ipfsError: any) {
        // If IPFS fetch fails, log error but don't fail the entire handler
        // The pre-seeded row exists, so Deliver events won't hit null constraints
        // But we can't populate enriched fields without the content
        logger.error(
          { requestId: id, ipfsHash, cidBase32, error: serializeError(ipfsError) },
          "Failed to fetch IPFS metadata for request (pre-seeded row exists, but enriched fields will be missing)"
        );
        // Don't re-throw - let handler continue with pre-seeded row
        // Skip enrichment and continue to next request in batch
        continue;
      }

      // TASK 2: Filter by networkId to only index Jinn jobs
      const networkId = typeof content.networkId === 'string' ? content.networkId : undefined;
      
      // Decision logic:
      // - networkId === 'jinn' → INDEX (explicit Jinn marker)
      // - networkId === undefined → INDEX (legacy Jinn, backward compatibility)
      // - networkId === something else → SKIP (non-Jinn tenant)
      if (networkId !== undefined && networkId !== 'jinn') {
        logger.info(
          { requestId: id, networkId },
          "Skipping non-Jinn request (networkId mismatch)"
        );
        // Delete the pre-seeded row since this is not a Jinn request
        try {
          await repo.delete({ id });
          logger.debug({ requestId: id }, "Deleted pre-seeded row for non-Jinn request");
        } catch (deleteError: any) {
          logger.warn({ requestId: id, error: serializeError(deleteError) }, "Failed to delete pre-seeded non-Jinn row");
        }
        continue; // Skip to next request
      }
      
      logger.debug({ requestId: id, networkId: networkId || 'legacy' }, "Request identified as Jinn job, proceeding with indexing");

      let jobName: string | undefined;
      let enabledTools: string[] | undefined;
      let jobDefinitionId: string | undefined;
      let blueprint: string | undefined;
      let sourceRequestId: string | undefined;
      let sourceJobDefinitionIdFromContent: string | undefined;
      let additionalContext: any = undefined;
      let messageContent: any = undefined;
      let codeMetadata: any = undefined;
      let dependencies: string[] | undefined;
      jobName = typeof content.jobName === "string" ? content.jobName : undefined;
      enabledTools = Array.isArray(content.tools)
        ? content.tools.map((tool: any) => String(tool))
        : Array.isArray(content.enabledTools)
          ? content.enabledTools.map((tool: any) => String(tool))
          : undefined;
      jobDefinitionId = typeof content.jobDefinitionId === "string" ? content.jobDefinitionId : undefined;
      // Support both blueprint (new) and prompt (legacy)
      blueprint = typeof content.blueprint === "string" 
        ? content.blueprint 
        : (typeof content.prompt === "string" ? content.prompt : undefined);
      sourceRequestId = typeof content.sourceRequestId === "string" ? content.sourceRequestId : undefined;
      sourceJobDefinitionIdFromContent =
        typeof (content as any).sourceJobDefinitionId === "string"
          ? (content as any).sourceJobDefinitionId
          : undefined;
      additionalContext = (content as any).additionalContext || undefined;
      if (additionalContext?.message) {
        messageContent = additionalContext.message;
      }
      if (content.codeMetadata && typeof content.codeMetadata === "object") {
        try {
          codeMetadata = safeJsonClone(content.codeMetadata);
        } catch {
          codeMetadata = content.codeMetadata;
        }
      }
      // Extract dependencies array if present
      dependencies = Array.isArray(content.dependencies)
        ? content.dependencies.map((dep: any) => String(dep))
        : undefined;

      // Upsert jobDefinition if present
      // NOTE: This happens BEFORE workstreamId is computed, so we can't include it here yet.
      // We'll need to update it after workstreamId is computed.
      if (jobDefRepo && jobDefinitionId) {
        // Prefer explicit lineage from payload if provided
        const parentJobDefinitionId: string | undefined = sourceJobDefinitionIdFromContent;

        await jobDefRepo.upsert({
          id: jobDefinitionId,
          create: {
            id: jobDefinitionId,
            name: jobName || 'Unnamed Job',
            enabledTools,
            blueprint,
            sourceJobDefinitionId: parentJobDefinitionId,
            sourceRequestId: sourceRequestId,
            codeMetadata,
            createdAt: blockTimestamp,
            lastInteraction: blockTimestamp,
            lastStatus: 'PENDING',
          },
          update: {
            name: jobName || 'Unnamed Job',
            enabledTools,
            blueprint,
            codeMetadata: codeMetadata || undefined,
            lastInteraction: blockTimestamp,
            lastStatus: 'PENDING',
            // Do NOT re-attribute lineage on updates; preserve original creator
          },
        });
      }

      // jobDefinitionId = target job being dispatched (what this request is FOR)
      // sourceJobDefinitionIdFromContent = parent job that created this request (lineage tracking)

      // Ensure additionalContext is properly structured with message preserved
      // The message should remain in additionalContext even after being extracted
      // for the messages table, so that request.additionalContext is complete
      //
      // IMPORTANT: Ponder's p.json() type expects serializable objects.
      // Deep clone through JSON to ensure no circular references.
      let contextToStore: any = undefined;
      if (additionalContext && typeof additionalContext === 'object') {
        try {
          // Deep clone to ensure serializability - this preserves ALL fields including
          // hierarchy, summary, and message
          contextToStore = safeJsonClone(additionalContext);
        } catch (e) {
          contextToStore = undefined;
        }
      }

      // --- COMPUTE WORKSTREAM ID ---
      // The workstream ID is the root request ID of the entire job chain.
      // Priority: 1) Explicit workstreamId in IPFS metadata (for parent re-dispatches)
      //           2) Traverse sourceRequestId chain to find root (for child jobs)
      //           3) Use own request ID (for root jobs)
      let workstreamId: string;
      const explicitWorkstreamId = typeof content.workstreamId === 'string' ? content.workstreamId : undefined;
      if (explicitWorkstreamId) {
        // Parent re-dispatch preserving workstream
        workstreamId = explicitWorkstreamId;
        logger.debug({ requestId: id, workstreamId }, 'Using explicit workstream ID from metadata');
      } else if (sourceRequestId) {
        // This is a child job, find its ultimate root
        workstreamId = await findWorkstreamRoot(sourceRequestId, repo);
      } else {
        // This is a root job, its workstream ID is its own ID
        workstreamId = id;
      }

      // Update the pre-seeded request row with enriched metadata
      // The create path should never execute here since we pre-seeded above,
      // but include it as a safety fallback
      try {
        logger.info({ requestId: id, jobName, jobDefinitionId, workstreamId }, "Updating request row with enriched metadata");
        await repo.upsert({
          id,
          create: {
            mech,
            sender,
            workstreamId,
            jobDefinitionId: jobDefinitionId,
            sourceRequestId: sourceRequestId,
            sourceJobDefinitionId: sourceJobDefinitionIdFromContent,
            requestData: dataHex || undefined,
            ipfsHash,
            transactionHash: txHash,
            blockNumber,
            blockTimestamp,
            delivered: false,
            jobName,
            enabledTools,
            additionalContext: contextToStore,
            dependencies,
          },
          update: {
            // Only update enriched fields; preserve pre-seeded base fields (mech, sender, block*, delivered)
            workstreamId,
            jobDefinitionId: jobDefinitionId,
            sourceRequestId: sourceRequestId,
            sourceJobDefinitionId: sourceJobDefinitionIdFromContent,
            requestData: dataHex || undefined,
            jobName,
            enabledTools,
            additionalContext: contextToStore,
            dependencies,
            // intentionally do not overwrite delivered, mech, sender, blockNumber, blockTimestamp, transactionHash here
          },
        });
        logger.info({ requestId: id }, "Enriched update completed successfully");
      } catch (enrichError: any) {
        logger.error({ requestId: id, error: serializeError(enrichError) }, "Enriched update failed");
        throw enrichError;
      }

      // Update jobDefinition with workstreamId now that it's computed
      if (jobDefRepo && jobDefinitionId) {
        try {
          // Use upsert instead of update to ensure workstreamId is set even on create
          await jobDefRepo.upsert({
            id: jobDefinitionId,
            create: {
              // This should never execute since we created above, but include as fallback
              id: jobDefinitionId,
              name: jobName || 'Unnamed Job',
              enabledTools,
              blueprint,
              workstreamId,
              sourceJobDefinitionId: sourceJobDefinitionIdFromContent,
              sourceRequestId: sourceRequestId,
              codeMetadata,
              createdAt: blockTimestamp,
              lastInteraction: blockTimestamp,
              lastStatus: 'PENDING',
            },
            update: {
              // Do NOT update workstreamId - a job definition can participate in multiple workstreams
              // The workstreamId field only stores the first workstream the job was created in
              // To find all workstreams for a job, query requests by jobDefinitionId and get their unique workstreamIds
            },
          });
          logger.debug({ jobDefinitionId, workstreamId }, "Job definition workstream ID preserved (not updated)");
        } catch (jobDefError: any) {
          logger.error({ jobDefinitionId, error: serializeError(jobDefError) }, "Failed to update job definition");
          // Don't throw - this is not critical enough to fail the entire indexing
        }
      }

      // Index message if present
      if (messageRepo && messageContent) {
        const msgTo = typeof messageContent === 'object' && messageContent.to ? messageContent.to : jobDefinitionId;
        const msgFrom = typeof messageContent === 'object' && messageContent.from ? messageContent.from : sourceJobDefinitionIdFromContent;
        const msgText = typeof messageContent === 'string' ? messageContent : messageContent.content;
        
        if (msgText) {
          await messageRepo.upsert({
            id,
            create: {
              requestId: id,
              sourceRequestId: sourceRequestId,
              sourceJobDefinitionId: msgFrom,
              to: msgTo,
              content: msgText,
              blockTimestamp,
            },
            update: {
              content: msgText,
              to: msgTo,
              sourceJobDefinitionId: msgFrom,
            },
          });
        }
      }
    }

    logger.info({ mech, sender, requestIds }, "Indexed MarketplaceRequest");
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), stack: e?.stack }, "Failed to index MarketplaceRequest");
  }
});

// TASK 3: Add MechMarketplace:MarketplaceDelivery handler to sync delivered status
// This ensures Jinn requests are marked delivered when ANY mech delivers them via marketplace
ponder.on(
  "MechMarketplace:MarketplaceDelivery",
  async ({ event, context }: { event: PonderEventShape; context: PonderContextShape }) => {
  try {
    const deliveryMech: string = String(event.args.deliveryMech);
    const requestIds: string[] = toStringArray((event.args as any).requestIds);
    const deliveredRequests: boolean[] = Array.isArray((event.args as any).deliveredRequests)
      ? ((event.args as any).deliveredRequests as any[]).map((val: any) => Boolean(val))
      : [];
    const txHash: string = String(event.transaction.hash);
    const blockNumber: bigint = BigInt(toBigIntCoercible(event.block.number));
    const blockTimestamp: bigint = BigInt(toBigIntCoercible(event.block.timestamp));

    const requestRepo = (context as any).db?.request || (context as any).entities?.request;
    if (!requestRepo) {
      logger.error("No repository for 'request' in MarketplaceDelivery handler. Skipping.");
      return;
    }

    logger.info(
      { deliveryMech, requestIdsCount: requestIds.length, txHash },
      "Processing MarketplaceDelivery event"
    );

    // Iterate over each request in the delivery batch
    for (let i = 0; i < requestIds.length; i++) {
      const requestId = requestIds[i];
      const wasDelivered = deliveredRequests[i] !== false; // Default true if not present

      if (!wasDelivered) {
        logger.debug(
          { requestId, deliveryMech },
          "Request was revoked in marketplace (deliveredRequests[i] = false), skipping"
        );
        continue;
      }

      // Check if this request exists in our database (i.e., is it a Jinn request?)
      let existingRequest: any = null;
      try {
        existingRequest = await requestRepo.findUnique({ id: requestId });
      } catch (findError: any) {
        logger.error(
          { requestId, error: serializeError(findError) },
          "Failed to check request existence in MarketplaceDelivery handler"
        );
        continue;
      }

      if (!existingRequest) {
        logger.debug(
          { requestId, deliveryMech },
          "Request not found in database (non-Jinn request or created before indexing start), skipping"
        );
        continue;
      }

      // This is a Jinn request that has been delivered by ANY mech via the marketplace
      // Update the request to mark it as delivered with marketplace delivery info
      try {
        await requestRepo.upsert({
          id: requestId,
          create: {
            // Safety fallback - should never execute since we verified existence above
            mech: existingRequest.mech || "0x0000000000000000000000000000000000000000",
            sender: existingRequest.sender || "0x0000000000000000000000000000000000000000",
            workstreamId: existingRequest.workstreamId || requestId,
            transactionHash: existingRequest.transactionHash || txHash,
            blockNumber: existingRequest.blockNumber || blockNumber,
            blockTimestamp: existingRequest.blockTimestamp || blockTimestamp,
            delivered: true,
            deliveryMech: deliveryMech,
            deliveryTxHash: txHash,
            deliveryBlockNumber: blockNumber,
            deliveryBlockTimestamp: blockTimestamp,
          },
          update: {
            // Update delivery status and marketplace delivery metadata
            delivered: true,
            deliveryMech: deliveryMech,
            deliveryTxHash: txHash,
            deliveryBlockNumber: blockNumber,
            deliveryBlockTimestamp: blockTimestamp,
          },
        });

        logger.info(
          { requestId, deliveryMech, txHash },
          "Marked Jinn request as delivered via MarketplaceDelivery"
        );
      } catch (updateError: any) {
        logger.error(
          { requestId, deliveryMech, error: serializeError(updateError) },
          "Failed to update request in MarketplaceDelivery handler"
        );
      }
    }

    logger.info(
      { deliveryMech, processedCount: requestIds.length },
      "Completed MarketplaceDelivery event processing"
    );
  } catch (e: any) {
    logger.error(
      { err: e?.message || String(e), stack: e?.stack },
      "Failed to index MarketplaceDelivery"
    );
  }
});


// Fallback path: index AgentMech (OlasMech) Deliver events which include raw delivery data bytes
ponder.on(
  "OlasMech:Deliver",
  async ({ event, context }: { event: PonderEventShape; context: PonderContextShape }) => {
  try {
    const requestId: string = String(event.args.requestId);
    const dataBytes: string | undefined = event.args.data ? String(event.args.data) : undefined;
    const txHash: string = String(event.transaction.hash);
    const blockNumber: bigint = BigInt(toBigIntCoercible(event.block.number));
    const blockTimestamp: bigint = BigInt(toBigIntCoercible(event.block.timestamp));

    const deliveryRepo = (context as any).db?.delivery || (context as any).entities?.delivery;
    const requestRepo = (context as any).db?.request || (context as any).entities?.request;
    const artifactsRepo = (context as any).db?.artifact || (context as any).entities?.artifact;
    const jobDefRepo = (context as any).db?.jobDefinition || (context as any).entities?.jobDefinition;
    if (!deliveryRepo || !requestRepo) {
      logger.error("No repository for 'delivery' or 'request'. Skipping OlasMech Deliver handler.");
      return;
    }

    // Check if request exists - it should have been pre-seeded by MarketplaceRequest handler
    // If indexing from a later start block, we may see Deliver events for requests that were
    // created before our indexing window. Skip these gracefully.
    let existingRequest: any = null;
    try {
      existingRequest = await requestRepo.findUnique({ id: requestId });
      if (!existingRequest) {
        logger.warn(
          { requestId, txHash },
          'Deliver event received for request that does not exist in database (likely created before indexing start block). Skipping.'
        );
        return;
      }
    } catch (e: any) {
      logger.error({ requestId, error: serializeError(e) }, 'Failed to check request existence before Deliver');
      throw e;
    }

    // Convert raw digest bytes to gateway-compatible CIDv1 (raw codec) hex multibase
    const ipfsHash = dataBytes ? `f01551220${String(dataBytes).replace(/^0x/, '')}` : undefined;

    const baseDeliveryRecord = {
      requestId,
      sourceRequestId: undefined,
      sourceJobDefinitionId: undefined,
      mech: String(event.args.mech || "0x0000000000000000000000000000000000000000"),
      mechServiceMultisig: String(event.args.mechServiceMultisig || "0x0000000000000000000000000000000000000000"),
      deliveryRate: BigInt(toBigIntCoercible((event.args as any).deliveryRate ?? 0)),
      ipfsHash,
      transactionHash: txHash,
      blockNumber,
      blockTimestamp,
    } as const;

    await deliveryRepo.upsert({
      id: requestId,
      create: baseDeliveryRecord,
      update: baseDeliveryRecord,
    });

    // Update request with delivery info, preserving existing fields from pre-seeded row
    // The create path should never execute since we verified existence above, but include
    // existing fields as safety fallback
    await requestRepo.upsert({
      id: requestId,
      create: {
        // Include existing fields if available (safety fallback)
        mech: existingRequest?.mech || String(event.args.mech || "0x0000000000000000000000000000000000000000"),
        sender: existingRequest?.sender || "0x0000000000000000000000000000000000000000",
        workstreamId: existingRequest?.workstreamId || requestId,
        transactionHash: existingRequest?.transactionHash || txHash,
        blockNumber: existingRequest?.blockNumber || blockNumber,
        blockTimestamp: existingRequest?.blockTimestamp || blockTimestamp,
        delivered: true,
        deliveryIpfsHash: ipfsHash,
      },
      update: {
        // Only update delivery-specific fields; preserve all other existing fields
        delivered: true,
        deliveryIpfsHash: ipfsHash,
        // Do not overwrite mech, sender, transactionHash, blockNumber, blockTimestamp here
        // as they come from MarketplaceRequest event
      },
    });

    // Attempt to resolve artifacts from delivery JSON
    try {
      if (ipfsHash) {
        // Prefer reconstructing directory CID (dag-pb) from digest and fetch the named file (requestId)
        // ipfsHash is 'f01551220' + 64-hex digest (raw codec). Extract digest and build CIDv1 dag-pb.
        const digestHex = String(ipfsHash).replace(/^f01551220/i, '');
        let url = `https://gateway.autonolas.tech/ipfs/${ipfsHash}`; // fallback
        try {
          const digestBytes: number[] = [];
          for (let i = 0; i < digestHex.length; i += 2) {
            digestBytes.push(parseInt(digestHex.slice(i, i + 2), 16));
          }
          // Build CIDv1 bytes: [0x01] + [0x70] (dag-pb) + multihash: [0x12, 0x20] + digest
          const cidBytes = [0x01, 0x70, 0x12, 0x20, ...digestBytes];
          // Base32 encode (lowercase, no padding), prefix with 'b'
          const base32Alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
          let bitBuffer = 0;
          let bitCount = 0;
          let out = '';
          for (const b of cidBytes) {
            bitBuffer = (bitBuffer << 8) | (b & 0xff);
            bitCount += 8;
            while (bitCount >= 5) {
              const idx = (bitBuffer >> (bitCount - 5)) & 0x1f;
              bitCount -= 5;
              out += base32Alphabet[idx];
            }
          }
          if (bitCount > 0) {
            const idx = (bitBuffer << (5 - bitCount)) & 0x1f;
            out += base32Alphabet[idx];
          }
          const dirCid = 'b' + out;
          url = `https://gateway.autonolas.tech/ipfs/${dirCid}/${requestId}`;
        } catch {}
        let res: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            res = await axios.get(url, { timeout: 8000 });
            if (res && res.status === 200 && res.data) break;
          } catch (e) {
            if (attempt < 4) await new Promise(r => setTimeout(r, 1500));
          }
        }
        if (res && res.status === 200 && res.data) {
          // Ensure data is parsed if it came back as string (e.g. wrong content-type)
          if (typeof res.data === 'string') {
            try { res.data = JSON.parse(res.data); } catch {}
          }

          // Try to extract jobDefinitionId from delivery payload
          const deliveryJobDefinitionId = typeof res.data.jobDefinitionId === 'string' ? res.data.jobDefinitionId : undefined;
          const jobName = typeof res.data.jobName === 'string' ? res.data.jobName : undefined;
          const enabledTools = Array.isArray(res.data.enabledTools) ? res.data.enabledTools.map((x: any) => String(x)) : undefined;
          // Support both blueprint (new) and prompt (legacy)
          const blueprint = typeof res.data.blueprint === 'string' 
            ? res.data.blueprint 
            : (typeof res.data.prompt === 'string' ? res.data.prompt : undefined);
          // Extract actual job status from delivery payload (COMPLETED, FAILED, DELEGATING, WAITING)
          const deliveryStatus = typeof res.data.status === 'string' ? res.data.status : 'COMPLETED';

          // Backfill job definition on delivery if available
          // Note: deliveryJobDefinitionId from delivery JSON is the job that was executed (target job)
          if (deliveryJobDefinitionId) {
            if (jobDefRepo) {
              try {
                // Inherit workstreamId from the request (or default to requestId if root)
                const workstreamId = existingRequest?.workstreamId || requestId;
                
                await jobDefRepo.upsert({
                  id: deliveryJobDefinitionId,
                  create: { 
                    id: deliveryJobDefinitionId, 
                    name: jobName || 'Unnamed Job', 
                    enabledTools, 
                    blueprint, 
                    workstreamId,
                    sourceRequestId: requestId,
                    createdAt: blockTimestamp,
                    lastInteraction: blockTimestamp,
                    lastStatus: deliveryStatus,
                  },
                  update: { 
                    name: jobName || 'Unnamed Job', 
                    enabledTools, 
                    blueprint, 
                    // Don't overwrite workstreamId on update
                    sourceRequestId: requestId,
                    lastInteraction: blockTimestamp,
                    lastStatus: deliveryStatus,
                  },
                });
              } catch (jdErr: any) {
                logger.error({ jobDefinitionId: deliveryJobDefinitionId, error: serializeError(jdErr) }, "Failed to backfill job definition in Deliver handler");
              }
            }
            // Backfill jobDefinitionId (target job) on delivery and request
            await deliveryRepo.upsert({ id: requestId, update: { sourceJobDefinitionId: deliveryJobDefinitionId, sourceRequestId: requestId } });
            await requestRepo.upsert({ id: requestId, update: { jobDefinitionId: deliveryJobDefinitionId } });
          } else {
            // Fallback: if request has a jobDefinitionId already, propagate it to delivery as sourceJobDefinitionId
            try {
              const req = await requestRepo.upsert({ id: requestId, update: {} });
              const maybeReq = (req as any) || {};
              if (maybeReq && typeof maybeReq.jobDefinitionId === 'string') {
                await deliveryRepo.upsert({ id: requestId, update: { sourceJobDefinitionId: maybeReq.jobDefinitionId, sourceRequestId: requestId } });
              }
            } catch {}
          }

          if (Array.isArray(res.data.artifacts) && artifactsRepo) {
            // Fetch the request to get its sourceRequestId for proper workstream attribution
            let requestSourceRequestId: string | undefined = undefined;
            try {
              const req = await requestRepo.upsert({ id: requestId, update: {} }); // no-op to read latest
              const maybeReq = (req as any) || {};
              requestSourceRequestId = maybeReq && typeof maybeReq.sourceRequestId === 'string' ? maybeReq.sourceRequestId : undefined;
            } catch {}
            
            for (let idx = 0; idx < res.data.artifacts.length; idx++) {
              const a = res.data.artifacts[idx] || {};
              const id = `${requestId}:${idx}`;
              const name = typeof a.name === 'string' ? a.name : `artifact-${idx}`;
              const cid = String(a.cid || '');
              const topic = String(a.topic || '');
              const contentPreview = typeof a.contentPreview === 'string' ? a.contentPreview : undefined;
              const type = typeof a.type === 'string' ? a.type : undefined;
              const tags = Array.isArray(a.tags) ? a.tags.map((t: any) => String(t)) : undefined;
              if (!cid || !topic) continue;
              // Use the request's sourceRequestId if it exists (for child jobs), otherwise use requestId itself (for root jobs)
              const artifactSourceRequestId = requestSourceRequestId || requestId;
              const artifactPayload: any = { requestId, name, cid, topic, contentPreview, type, tags, sourceRequestId: artifactSourceRequestId, blockTimestamp: event.block.timestamp };
              // Prefer delivery sourceJobDefinitionId; fallback to request.sourceJobDefinitionId if not present
              if (deliveryJobDefinitionId) {
                artifactPayload.sourceJobDefinitionId = deliveryJobDefinitionId;
              } else {
                try {
                  const req = await requestRepo.upsert({ id: requestId, update: {} }); // no-op to read latest
                  const maybeReq = (req as any) || {};
                  if (maybeReq && typeof maybeReq.sourceJobDefinitionId === 'string') {
                    artifactPayload.sourceJobDefinitionId = maybeReq.sourceJobDefinitionId;
                  }
                } catch {}
              }
              await artifactsRepo.upsert({ id, create: artifactPayload, update: artifactPayload });

              if (type === 'SITUATION') {
                const pool = getVectorDbPool();
                if (!pool) {
                  logger.warn('node_embeddings database not configured; skipping situation indexing');
                  continue;
                }

                try {
                  const situationUrl = `${IPFS_GATEWAY_BASE}${cid}`;
                  const situationRes = await axios.get(situationUrl, { timeout: 8000 });
                  let situationData = situationRes?.data || {};
                  
                  // IPFS artifact may be wrapped with metadata (name, topic, content fields)
                  // If so, parse the content field which contains the actual situation JSON
                  if (situationData.content && typeof situationData.content === 'string') {
                    try {
                      situationData = JSON.parse(situationData.content);
                    } catch (parseError) {
                      logger.warn({ requestId, cid }, 'Failed to parse artifact content field');
                    }
                  }
                  
                  const situation = situationData;
                  const embedding = situation?.embedding;
                  const vector: number[] | undefined = Array.isArray(embedding?.vector) ? embedding.vector : undefined;
                  const model: string | undefined = typeof embedding?.model === 'string' ? embedding.model : undefined;
                  const dim: number | undefined = typeof embedding?.dim === 'number' ? embedding.dim : Array.isArray(embedding?.vector) ? embedding.vector.length : undefined;
                  const nodeId = typeof situation?.job?.requestId === 'string' ? situation.job.requestId : requestId;

                  if (!vector || vector.length === 0 || !model || !dim) {
                    logger.warn({ requestId, cid }, 'Situation artifact missing embedding payload');
                    continue;
                  }

                  const summary =
                    truncate(situation?.meta?.summaryText) ||
                    truncate(situation?.execution?.finalOutputSummary) ||
                    truncate(situation?.job?.objective) ||
                    truncate(situation?.job?.jobName);

                  const metaPayload = {
                    version: situation?.version,
                    artifactCid: cid,
                    artifactId: id,
                    job: situation?.job,
                    context: situation?.context,
                    artifacts: situation?.artifacts,
                    recognition: situation?.meta?.recognition,
                  };

                  // Use test table when running under Vitest to isolate test data
                  const tableName = process.env.VITEST === 'true' ? 'node_embeddings_test' : 'node_embeddings';

                  const sql = `
                    INSERT INTO ${tableName} (node_id, model, dim, vec, summary, meta)
                    VALUES ($1, $2, $3, $4::vector, $5, $6)
                    ON CONFLICT (node_id)
                    DO UPDATE SET
                      model = EXCLUDED.model,
                      dim = EXCLUDED.dim,
                      vec = EXCLUDED.vec,
                      summary = EXCLUDED.summary,
                      meta = EXCLUDED.meta,
                      updated_at = NOW();
                  `;

                  await pool.query(sql, [
                    nodeId,
                    model,
                    dim,
                    formatVectorLiteral(vector),
                    summary,
                    metaPayload,
                  ]);
                  logger.info({ requestId: nodeId, cid }, 'Indexed situation embedding');
                } catch (indexError: any) {
                  logger.error({ requestId, cid, error: serializeError(indexError) }, 'Failed to index situation embedding');
                }
              }
            }
          }
        }
      }
    } catch (e: any) {
      logger.error({ requestId, err: e?.message || String(e) }, 'Failed to resolve delivery artifacts (OlasMech)');
    }

    logger.info({ requestId, ipfsHash }, "Indexed OlasMech Deliver (delivery ipfs)");
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), stack: e?.stack }, "Failed to index OlasMech Deliver");
  }
});

// TASK 5: Add handler for colleague's mech Deliver events (same logic as OlasMech)
ponder.on(
  "OlasMechColleague:Deliver",
  async ({ event, context }: { event: PonderEventShape; context: PonderContextShape }) => {
  try {
    const requestId: string = String(event.args.requestId);
    const dataBytes: string | undefined = event.args.data ? String(event.args.data) : undefined;
    const txHash: string = String(event.transaction.hash);
    const blockNumber: bigint = BigInt(toBigIntCoercible(event.block.number));
    const blockTimestamp: bigint = BigInt(toBigIntCoercible(event.block.timestamp));

    const deliveryRepo = (context as any).db?.delivery || (context as any).entities?.delivery;
    const requestRepo = (context as any).db?.request || (context as any).entities?.request;
    const artifactsRepo = (context as any).db?.artifact || (context as any).entities?.artifact;
    const jobDefRepo = (context as any).db?.jobDefinition || (context as any).entities?.jobDefinition;
    if (!deliveryRepo || !requestRepo) {
      logger.error("No repository for 'delivery' or 'request'. Skipping OlasMechColleague Deliver handler.");
      return;
    }

    // Check if request exists - it should have been pre-seeded by MarketplaceRequest handler
    // If indexing from a later start block, we may see Deliver events for requests that were
    // created before our indexing window. Skip these gracefully.
    let existingRequest: any = null;
    try {
      existingRequest = await requestRepo.findUnique({ id: requestId });
      if (!existingRequest) {
        logger.warn(
          { requestId, txHash },
          'OlasMechColleague Deliver event received for request that does not exist in database (likely non-Jinn or created before indexing start block). Skipping.'
        );
        return;
      }
    } catch (e: any) {
      logger.error({ requestId, error: serializeError(e) }, 'Failed to check request existence before OlasMechColleague Deliver');
      throw e;
    }

    // Convert raw digest bytes to gateway-compatible CIDv1 (raw codec) hex multibase
    const ipfsHash = dataBytes ? `f01551220${String(dataBytes).replace(/^0x/, '')}` : undefined;

    const baseDeliveryRecord = {
      requestId,
      sourceRequestId: undefined,
      sourceJobDefinitionId: undefined,
      mech: String(event.args.mech || "0x0000000000000000000000000000000000000000"),
      mechServiceMultisig: String(event.args.mechServiceMultisig || "0x0000000000000000000000000000000000000000"),
      deliveryRate: BigInt(toBigIntCoercible((event.args as any).deliveryRate ?? 0)),
      ipfsHash,
      transactionHash: txHash,
      blockNumber,
      blockTimestamp,
    } as const;

    await deliveryRepo.upsert({
      id: requestId,
      create: baseDeliveryRecord,
      update: baseDeliveryRecord,
    });

    // Update request with delivery info, preserving existing fields from pre-seeded row
    await requestRepo.upsert({
      id: requestId,
      create: {
        mech: existingRequest?.mech || String(event.args.mech || "0x0000000000000000000000000000000000000000"),
        sender: existingRequest?.sender || "0x0000000000000000000000000000000000000000",
        workstreamId: existingRequest?.workstreamId || requestId,
        transactionHash: existingRequest?.transactionHash || txHash,
        blockNumber: existingRequest?.blockNumber || blockNumber,
        blockTimestamp: existingRequest?.blockTimestamp || blockTimestamp,
        delivered: true,
        deliveryIpfsHash: ipfsHash,
      },
      update: {
        delivered: true,
        deliveryIpfsHash: ipfsHash,
      },
    });

    // Attempt to resolve artifacts from delivery JSON (same logic as OlasMech)
    try {
      if (ipfsHash) {
        const digestHex = String(ipfsHash).replace(/^f01551220/i, '');
        let url = `https://gateway.autonolas.tech/ipfs/${ipfsHash}`;
        try {
          const digestBytes: number[] = [];
          for (let i = 0; i < digestHex.length; i += 2) {
            digestBytes.push(parseInt(digestHex.slice(i, i + 2), 16));
          }
          const cidBytes = [0x01, 0x70, 0x12, 0x20, ...digestBytes];
          const base32Alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
          let bitBuffer = 0;
          let bitCount = 0;
          let out = '';
          for (const b of cidBytes) {
            bitBuffer = (bitBuffer << 8) | (b & 0xff);
            bitCount += 8;
            while (bitCount >= 5) {
              const idx = (bitBuffer >> (bitCount - 5)) & 0x1f;
              bitCount -= 5;
              out += base32Alphabet[idx];
            }
          }
          if (bitCount > 0) {
            const idx = (bitBuffer << (5 - bitCount)) & 0x1f;
            out += base32Alphabet[idx];
          }
          const dirCid = 'b' + out;
          url = `https://gateway.autonolas.tech/ipfs/${dirCid}/${requestId}`;
        } catch {}
        let res: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            res = await axios.get(url, { timeout: 8000 });
            if (res && res.status === 200 && res.data) break;
          } catch (e) {
            if (attempt < 4) await new Promise(r => setTimeout(r, 1500));
          }
        }
        if (res && res.status === 200 && res.data) {
          if (typeof res.data === 'string') {
            try { res.data = JSON.parse(res.data); } catch {}
          }

          const deliveryJobDefinitionId = typeof res.data.jobDefinitionId === 'string' ? res.data.jobDefinitionId : undefined;
          const jobName = typeof res.data.jobName === 'string' ? res.data.jobName : undefined;
          const enabledTools = Array.isArray(res.data.enabledTools) ? res.data.enabledTools.map((x: any) => String(x)) : undefined;
          const blueprint = typeof res.data.blueprint === 'string' 
            ? res.data.blueprint 
            : (typeof res.data.prompt === 'string' ? res.data.prompt : undefined);
          const deliveryStatus = typeof res.data.status === 'string' ? res.data.status : 'COMPLETED';

          if (deliveryJobDefinitionId) {
            if (jobDefRepo) {
              try {
                const workstreamId = existingRequest?.workstreamId || requestId;
                await jobDefRepo.upsert({
                  id: deliveryJobDefinitionId,
                  create: { 
                    id: deliveryJobDefinitionId, 
                    name: jobName || 'Unnamed Job', 
                    enabledTools, 
                    blueprint, 
                    workstreamId,
                    sourceRequestId: requestId,
                    createdAt: blockTimestamp,
                    lastInteraction: blockTimestamp,
                    lastStatus: deliveryStatus,
                  },
                  update: { 
                    name: jobName || 'Unnamed Job', 
                    enabledTools, 
                    blueprint, 
                    sourceRequestId: requestId,
                    lastInteraction: blockTimestamp,
                    lastStatus: deliveryStatus,
                  },
                });
              } catch (jdErr: any) {
                logger.error({ jobDefinitionId: deliveryJobDefinitionId, error: serializeError(jdErr) }, "Failed to backfill job definition in OlasMechColleague Deliver handler");
              }
            }
            await deliveryRepo.upsert({ id: requestId, update: { sourceJobDefinitionId: deliveryJobDefinitionId, sourceRequestId: requestId } });
            await requestRepo.upsert({ id: requestId, update: { jobDefinitionId: deliveryJobDefinitionId } });
          } else {
            try {
              const req = await requestRepo.upsert({ id: requestId, update: {} });
              const maybeReq = (req as any) || {};
              if (maybeReq && typeof maybeReq.jobDefinitionId === 'string') {
                await deliveryRepo.upsert({ id: requestId, update: { sourceJobDefinitionId: maybeReq.jobDefinitionId, sourceRequestId: requestId } });
              }
            } catch {}
          }

          if (Array.isArray(res.data.artifacts) && artifactsRepo) {
            let requestSourceRequestId: string | undefined = undefined;
            try {
              const req = await requestRepo.upsert({ id: requestId, update: {} });
              const maybeReq = (req as any) || {};
              requestSourceRequestId = maybeReq && typeof maybeReq.sourceRequestId === 'string' ? maybeReq.sourceRequestId : undefined;
            } catch {}
            
            for (let idx = 0; idx < res.data.artifacts.length; idx++) {
              const a = res.data.artifacts[idx] || {};
              const id = `${requestId}:${idx}`;
              const name = typeof a.name === 'string' ? a.name : `artifact-${idx}`;
              const cid = String(a.cid || '');
              const topic = String(a.topic || '');
              const contentPreview = typeof a.contentPreview === 'string' ? a.contentPreview : undefined;
              const type = typeof a.type === 'string' ? a.type : undefined;
              const tags = Array.isArray(a.tags) ? a.tags.map((t: any) => String(t)) : undefined;
              if (!cid || !topic) continue;
              const artifactSourceRequestId = requestSourceRequestId || requestId;
              const artifactPayload: any = { requestId, name, cid, topic, contentPreview, type, tags, sourceRequestId: artifactSourceRequestId, blockTimestamp: event.block.timestamp };
              if (deliveryJobDefinitionId) {
                artifactPayload.sourceJobDefinitionId = deliveryJobDefinitionId;
              } else {
                try {
                  const req = await requestRepo.upsert({ id: requestId, update: {} });
                  const maybeReq = (req as any) || {};
                  if (maybeReq && typeof maybeReq.sourceJobDefinitionId === 'string') {
                    artifactPayload.sourceJobDefinitionId = maybeReq.sourceJobDefinitionId;
                  }
                } catch {}
              }
              await artifactsRepo.upsert({ id, create: artifactPayload, update: artifactPayload });

              if (type === 'SITUATION') {
                const pool = getVectorDbPool();
                if (!pool) {
                  logger.warn('node_embeddings database not configured; skipping situation indexing');
                  continue;
                }

                try {
                  const situationUrl = `${IPFS_GATEWAY_BASE}${cid}`;
                  const situationRes = await axios.get(situationUrl, { timeout: 8000 });
                  let situationData = situationRes?.data || {};
                  
                  if (situationData.content && typeof situationData.content === 'string') {
                    try {
                      situationData = JSON.parse(situationData.content);
                    } catch (parseError) {
                      logger.warn({ requestId, cid }, 'Failed to parse artifact content field');
                    }
                  }
                  
                  const situation = situationData;
                  const embedding = situation?.embedding;
                  const vector: number[] | undefined = Array.isArray(embedding?.vector) ? embedding.vector : undefined;
                  const model: string | undefined = typeof embedding?.model === 'string' ? embedding.model : undefined;
                  const dim: number | undefined = typeof embedding?.dim === 'number' ? embedding.dim : Array.isArray(embedding?.vector) ? embedding.vector.length : undefined;
                  const nodeId = typeof situation?.job?.requestId === 'string' ? situation.job.requestId : requestId;

                  if (!vector || vector.length === 0 || !model || !dim) {
                    logger.warn({ requestId, cid }, 'Situation artifact missing embedding payload');
                    continue;
                  }

                  const summary =
                    truncate(situation?.meta?.summaryText) ||
                    truncate(situation?.execution?.finalOutputSummary) ||
                    truncate(situation?.job?.objective) ||
                    truncate(situation?.job?.jobName);

                  const metaPayload = {
                    version: situation?.version,
                    artifactCid: cid,
                    artifactId: id,
                    job: situation?.job,
                    context: situation?.context,
                    artifacts: situation?.artifacts,
                    recognition: situation?.meta?.recognition,
                  };

                  const tableName = process.env.VITEST === 'true' ? 'node_embeddings_test' : 'node_embeddings';

                  const sql = `
                    INSERT INTO ${tableName} (node_id, model, dim, vec, summary, meta)
                    VALUES ($1, $2, $3, $4::vector, $5, $6)
                    ON CONFLICT (node_id)
                    DO UPDATE SET
                      model = EXCLUDED.model,
                      dim = EXCLUDED.dim,
                      vec = EXCLUDED.vec,
                      summary = EXCLUDED.summary,
                      meta = EXCLUDED.meta,
                      updated_at = NOW();
                  `;

                  await pool.query(sql, [
                    nodeId,
                    model,
                    dim,
                    formatVectorLiteral(vector),
                    summary,
                    metaPayload,
                  ]);
                  logger.info({ requestId: nodeId, cid }, 'Indexed situation embedding from OlasMechColleague');
                } catch (indexError: any) {
                  logger.error({ requestId, cid, error: serializeError(indexError) }, 'Failed to index situation embedding from OlasMechColleague');
                }
              }
            }
          }
        }
      }
    } catch (e: any) {
      logger.error({ requestId, err: e?.message || String(e) }, 'Failed to resolve delivery artifacts (OlasMechColleague)');
    }

    logger.info({ requestId, ipfsHash }, "Indexed OlasMechColleague Deliver (delivery ipfs)");
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), stack: e?.stack }, "Failed to index OlasMechColleague Deliver");
  }
});
