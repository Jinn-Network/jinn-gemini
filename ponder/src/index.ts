import { ponder } from "@/generated";
import { resolveRequestIpfsContent } from "../../gemini-agent/mcp/tools/shared/ipfs";
import axios from "axios";
import { logger, serializeError } from "../../logging/index.js";

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
      const dataHex = requestDatas?.[i] || null;
      // Compute gateway-ready ipfsHash using raw codec (f0155...) as uploads often use raw leaves
      const ipfsHash = dataHex ? `f01551220${String(dataHex).replace(/^0x/, '')}` : undefined;

      let jobName: string | undefined;
      let enabledTools: string[] | undefined;
      let jobDefinitionId: string | undefined;
      let promptContent: string | undefined;
      let sourceRequestId: string | undefined;
      let sourceJobDefinitionIdFromContent: string | undefined;
      let additionalContext: any = undefined;
      let messageContent: any = undefined;
      let codeMetadata: any = undefined;
      if (ipfsHash) {
        try {
          // Minimal IPFS fetch with timeout to avoid blocking database writes during historical indexing
          let content: any = null;
          const fetchPromise = resolveRequestIpfsContent(ipfsHash);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('IPFS timeout')), 5000)
          );
          content = await Promise.race([fetchPromise, timeoutPromise]).catch(() => null);
          if (content && !content.error) {
            jobName = content.jobName;
            enabledTools = content.tools || content.enabledTools;
            jobDefinitionId = typeof content.jobDefinitionId === 'string' ? content.jobDefinitionId : undefined;
            promptContent = typeof content.prompt === 'string' ? content.prompt : undefined;
            sourceRequestId = typeof content.sourceRequestId === 'string' ? content.sourceRequestId : undefined;
            sourceJobDefinitionIdFromContent = typeof (content as any).sourceJobDefinitionId === 'string' ? (content as any).sourceJobDefinitionId : undefined;
            additionalContext = (content as any).additionalContext || undefined;
            // Extract message if present
            if (additionalContext?.message) {
              messageContent = additionalContext.message;
            }
            if (content.codeMetadata && typeof content.codeMetadata === 'object') {
              try {
                codeMetadata = JSON.parse(JSON.stringify(content.codeMetadata));
              } catch (err) {
                codeMetadata = content.codeMetadata;
              }
            }
          }
        } catch (e: any) {
          logger.error(`Failed to resolve IPFS content for hash ${ipfsHash}: ${e.message}`);
        }
      }

      // Upsert jobDefinition if present
      if (jobDefRepo && jobDefinitionId) {
        // Prefer explicit lineage from payload if provided
        const parentJobDefinitionId: string | undefined = sourceJobDefinitionIdFromContent;

        await jobDefRepo.upsert({
          id: jobDefinitionId,
          create: {
            id: jobDefinitionId,
            name: jobName || 'Unnamed Job',
            enabledTools,
            promptContent,
            sourceJobDefinitionId: parentJobDefinitionId,
            sourceRequestId: sourceRequestId,
            codeMetadata,
          },
          update: {
            name: jobName || 'Unnamed Job',
            enabledTools,
            promptContent,
            codeMetadata: codeMetadata || undefined,
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
          contextToStore = JSON.parse(JSON.stringify(additionalContext));
        } catch (e) {
          contextToStore = undefined;
        }
      }

      await repo.upsert({
        id,
        create: {
          mech,
          sender,
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
        },
        update: {
          mech,
          sender,
          jobDefinitionId: jobDefinitionId,
          sourceRequestId: sourceRequestId,
          sourceJobDefinitionId: sourceJobDefinitionIdFromContent,
          requestData: dataHex || undefined,
          ipfsHash,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
          jobName,
          enabledTools,
          additionalContext: contextToStore,
          // intentionally do not overwrite delivered here
        },
      });

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
    logger.error({ err: e?.message || String(e) }, "Failed to index MarketplaceRequest");
  }
});

// Removed MechMarketplace delivery handlers in favor of OlasMech:Deliver


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

    await requestRepo.upsert({
      id: requestId,
      create: {
        delivered: true,
        deliveryIpfsHash: ipfsHash,
        transactionHash: txHash,
        blockNumber,
        blockTimestamp,
      },
      update: {
        delivered: true,
        deliveryIpfsHash: ipfsHash,
        transactionHash: txHash,
        blockNumber,
        blockTimestamp,
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
          // Try to extract jobDefinitionId from delivery payload
          const deliveryJobDefinitionId = typeof res.data.jobDefinitionId === 'string' ? res.data.jobDefinitionId : undefined;
          const jobName = typeof res.data.jobName === 'string' ? res.data.jobName : undefined;
          const enabledTools = Array.isArray(res.data.enabledTools) ? res.data.enabledTools.map((x: any) => String(x)) : undefined;
          const promptContent = typeof res.data.prompt === 'string' ? res.data.prompt : undefined;

          // Backfill job definition on delivery if available
          // Note: deliveryJobDefinitionId from delivery JSON is the job that was executed (target job)
          if (deliveryJobDefinitionId) {
            if (jobDefRepo) {
              await jobDefRepo.upsert({
                id: deliveryJobDefinitionId,
                create: { id: deliveryJobDefinitionId, name: jobName || 'Unnamed Job', enabledTools, promptContent, sourceRequestId: requestId },
                update: { name: jobName || 'Unnamed Job', enabledTools, promptContent, sourceRequestId: requestId },
              });
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
              if (!cid || !topic) continue;
              // Use the request's sourceRequestId if it exists (for child jobs), otherwise use requestId itself (for root jobs)
              const artifactSourceRequestId = requestSourceRequestId || requestId;
              const artifactPayload: any = { requestId, name, cid, topic, contentPreview, sourceRequestId: artifactSourceRequestId, blockTimestamp: event.block.timestamp };
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
            }
          }
        }
      }
    } catch (e: any) {
      logger.error({ requestId, err: e?.message || String(e) }, 'Failed to resolve delivery artifacts (OlasMech)');
    }

    logger.info({ requestId, ipfsHash }, "Indexed OlasMech Deliver (delivery ipfs)");
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, "Failed to index OlasMech Deliver");
  }
});
