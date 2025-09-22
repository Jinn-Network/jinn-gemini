import { ponder } from "@/generated";
import { resolveRequestIpfsContent } from "../../gemini-agent/mcp/tools/shared/ipfs";
import axios from "axios";
import { decodeFunctionData, parseAbi } from "viem";

ponder.on("MechMarketplace:MarketplaceRequest", async ({ event, context }) => {
  try {
    const mech: string = String(event.args.priorityMech);
    const sender: string = String(event.args.requester);
    const requestIds: string[] = (event.args.requestIds || []).map((x: any) => String(x));
    const requestDatas: string[] = (event.args.requestDatas || []).map((x: any) => String(x));
    const txHash: string = String(event.transaction.hash);
    const blockNumber: bigint = BigInt(event.block.number);
    const blockTimestamp: bigint = BigInt(event.block.timestamp);

    const repo = (context as any).db?.request || (context as any).entities?.request;
    if (!repo) {
      console.error("No repository for 'request' (neither context.db nor context.entities). Skipping upsert.");
      return;
    }

    for (let i = 0; i < requestIds.length; i++) {
      const id = requestIds[i];
      const dataHex = requestDatas?.[i] || null;
      // Compute gateway-ready ipfsHash using raw codec (f0155...) as uploads often use raw leaves
      const ipfsHash = dataHex ? `f01551220${String(dataHex).replace(/^0x/, '')}` : undefined;

      let jobName: string | undefined;
      let enabledTools: string[] | undefined;
      if (ipfsHash) {
        try {
          const content = await resolveRequestIpfsContent(ipfsHash);
          if (content && !content.error) {
            jobName = content.jobName;
            enabledTools = content.tools || content.enabledTools;
          }
        } catch (e: any) {
          console.error(`Failed to resolve IPFS content for hash ${ipfsHash}: ${e.message}`);
        }
      }

      await repo.upsert({
        id,
        create: {
          mech,
          sender,
          requestData: dataHex || undefined,
          ipfsHash,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
          delivered: false,
          jobName,
          enabledTools,
        },
        update: {
          mech,
          sender,
          requestData: dataHex || undefined,
          ipfsHash,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
          jobName,
          enabledTools,
          // intentionally do not overwrite delivered here
        },
      });
    }

    console.log({ mech, sender, requestIds }, "Indexed MarketplaceRequest");
  } catch (e: any) {
    console.error({ err: e?.message || String(e) }, "Failed to index MarketplaceRequest");
  }
});

// Handle marketplace batch/signed deliveries used by Safe flow
ponder.on("MechMarketplace:MarketplaceDelivery", async ({ event, context }) => {
  try {
    const deliveryMech: string = String(event.args.deliveryMech);
    const requestIds: string[] = (event.args.requestIds || []).map((x: any) => String(x));
    const txHash: string = String(event.transaction.hash);
    const blockNumber: bigint = BigInt(event.block.number);
    const blockTimestamp: bigint = BigInt(event.block.timestamp);

    const repo = (context as any).db?.delivery || (context as any).entities?.delivery;
    if (!repo) {
      console.error("No repository for 'delivery' (neither context.db nor context.entities). Skipping upsert.");
      return;
    }

    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const ZERO_RATE = 0n;

    let digestByReqId: Record<string, string> = {};
    try {
      const rpcUrl = process.env.MECHX_CHAIN_RPC || process.env.MECH_RPC_HTTP_URL;
      if (rpcUrl) {
        const rpcResp = await axios.post(rpcUrl, { jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [txHash] }, { timeout: 8000 });
        const input: string | undefined = rpcResp?.data?.result?.input;
        if (input && input.startsWith("0x")) {
          const safeAbi = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)"]);
          const decodedSafe = decodeFunctionData({ abi: safeAbi, data: input as `0x${string}` });
          const innerData: `0x${string}` | undefined = (decodedSafe?.args?.[2] as any);
          if (innerData) {
            const agentAbi = parseAbi(["function deliverToMarketplace(bytes32[] requestIds, bytes32[] resultDigests)"]);
            const decodedInner = decodeFunctionData({ abi: agentAbi, data: innerData });
            const reqs: readonly string[] = (decodedInner?.args?.[0] as any[]) || [];
            const digests: readonly string[] = (decodedInner?.args?.[1] as any[]) || [];
            for (let i = 0; i < Math.min(reqs.length, digests.length); i++) {
              const rIdHex = String(reqs[i]).toLowerCase();
              const digestHex = String(digests[i]).replace(/^0x/, '').toLowerCase();
              const ipfsHash = `f01551220${digestHex}`;
              digestByReqId[rIdHex] = ipfsHash;
            }
          }
        }
      }
    } catch (e: any) {
      console.warn({ txHash, err: e?.message || String(e) }, "Failed to decode Safe inner call for delivery digest");
    }

    for (const reqId of requestIds) {
      const rIdHex = String(reqId).toLowerCase();
      const ipfsHash = digestByReqId[rIdHex];
      await repo.upsert({
        id: reqId,
        create: {
          requestId: reqId,
          mech: deliveryMech,
          mechServiceMultisig: ZERO_ADDRESS,
          deliveryRate: ZERO_RATE,
          ipfsHash,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
        },
        update: {
          requestId: reqId,
          mech: deliveryMech,
          mechServiceMultisig: ZERO_ADDRESS,
          deliveryRate: ZERO_RATE,
          ipfsHash,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
        },
      });
      const requestRepo = (context as any).db?.request || (context as any).entities?.request;
      if (requestRepo) {
        await requestRepo.upsert({
          id: reqId,
          create: { delivered: true, deliveryIpfsHash: ipfsHash },
          update: { delivered: true, deliveryIpfsHash: ipfsHash },
        });
      }
    }

    console.log({ deliveryMech, requestIds }, "Indexed MarketplaceDelivery");
  } catch (e: any) {
    console.error({ err: e?.message || String(e) }, "Failed to index MarketplaceDelivery");
  }
});

ponder.on("MechMarketplace:MarketplaceDeliveryWithSignatures", async ({ event, context }) => {
  try {
    const deliveryMech: string = String(event.args.deliveryMech);
    const requestIds: string[] = (event.args.requestIds || []).map((x: any) => String(x));
    const txHash: string = String(event.transaction.hash);
    const blockNumber: bigint = BigInt(event.block.number);
    const blockTimestamp: bigint = BigInt(event.block.timestamp);

    const repo = (context as any).db?.delivery || (context as any).entities?.delivery;
    if (!repo) {
      console.error("No repository for 'delivery' (neither context.db nor context.entities). Skipping upsert.");
      return;
    }

    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
    const ZERO_RATE = 0n;

    let digestByReqId: Record<string, string> = {};
    try {
      const rpcUrl = process.env.MECHX_CHAIN_RPC || process.env.MECH_RPC_HTTP_URL;
      if (rpcUrl) {
        const rpcResp = await axios.post(rpcUrl, { jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [txHash] }, { timeout: 8000 });
        const input: string | undefined = rpcResp?.data?.result?.input;
        if (input && input.startsWith("0x")) {
          const safeAbi = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures)"]);
          const decodedSafe = decodeFunctionData({ abi: safeAbi, data: input as `0x${string}` });
          const innerData: `0x${string}` | undefined = (decodedSafe?.args?.[2] as any);
          if (innerData) {
            const agentAbi = parseAbi(["function deliverToMarketplace(bytes32[] requestIds, bytes32[] resultDigests)"]);
            const decodedInner = decodeFunctionData({ abi: agentAbi, data: innerData });
            const reqs: readonly string[] = (decodedInner?.args?.[0] as any[]) || [];
            const digests: readonly string[] = (decodedInner?.args?.[1] as any[]) || [];
            for (let i = 0; i < Math.min(reqs.length, digests.length); i++) {
              const rIdHex = String(reqs[i]).toLowerCase();
              const digestHex = String(digests[i]).replace(/^0x/, '').toLowerCase();
              const ipfsHash = `f01551220${digestHex}`;
              digestByReqId[rIdHex] = ipfsHash;
            }
          }
        }
      }
    } catch (e: any) {
      console.warn({ txHash, err: e?.message || String(e) }, "Failed to decode Safe inner call for delivery digest");
    }

    for (const reqId of requestIds) {
      const rIdHex = String(reqId).toLowerCase();
      const ipfsHash = digestByReqId[rIdHex];
      await repo.upsert({
        id: reqId,
        create: {
          requestId: reqId,
          mech: deliveryMech,
          mechServiceMultisig: ZERO_ADDRESS,
          deliveryRate: ZERO_RATE,
          ipfsHash,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
        },
        update: {
          requestId: reqId,
          mech: deliveryMech,
          mechServiceMultisig: ZERO_ADDRESS,
          deliveryRate: ZERO_RATE,
          ipfsHash,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
        },
      });
      const requestRepo = (context as any).db?.request || (context as any).entities?.request;
      if (requestRepo) {
        await requestRepo.upsert({
          id: reqId,
          create: { delivered: true, deliveryIpfsHash: ipfsHash },
          update: { delivered: true, deliveryIpfsHash: ipfsHash },
        });
      }
    }

    console.log({ deliveryMech, requestIds }, "Indexed MarketplaceDeliveryWithSignatures");
  } catch (e: any) {
    console.error({ err: e?.message || String(e) }, "Failed to index MarketplaceDeliveryWithSignatures");
  }
});


// Capture per-request delivery IPFS hash from Deliver events (deliveryData)
ponder.on("MechMarketplace:Deliver", async ({ event, context }) => {
  try {
    const requestId: string = String(event.args.requestId);
    const deliveryData: string | undefined = event.args.deliveryData ? String(event.args.deliveryData) : undefined;
    const txHash: string = String(event.transaction.hash);
    const blockNumber: bigint = BigInt(event.block.number);
    const blockTimestamp: bigint = BigInt(event.block.timestamp);

    const deliveryRepo = (context as any).db?.delivery || (context as any).entities?.delivery;
    const requestRepo = (context as any).db?.request || (context as any).entities?.request;
    if (!deliveryRepo || !requestRepo) {
      console.error("No repository for 'delivery' or 'request'. Skipping Deliver handler.");
      return;
    }

    const ipfsHash = deliveryData ? `f01551220${String(deliveryData).replace(/^0x/, '')}` : undefined;

    await deliveryRepo.upsert({
      id: requestId,
      create: {
        requestId,
        mech: String(event.args.mech || event.args.deliveryMech || "0x0000000000000000000000000000000000000000"),
        mechServiceMultisig: String(event.args.mechServiceMultisig || "0x0000000000000000000000000000000000000000"),
        deliveryRate: BigInt(event.args.deliveryRate || 0),
        ipfsHash,
        transactionHash: txHash,
        blockNumber,
        blockTimestamp,
      },
      update: {
        requestId,
        mech: String(event.args.mech || event.args.deliveryMech || "0x0000000000000000000000000000000000000000"),
        mechServiceMultisig: String(event.args.mechServiceMultisig || "0x0000000000000000000000000000000000000000"),
        deliveryRate: BigInt(event.args.deliveryRate || 0),
        ipfsHash,
        transactionHash: txHash,
        blockNumber,
        blockTimestamp,
      },
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

    // If delivery IPFS JSON includes artifacts array, upsert them
    try {
      if (ipfsHash) {
        const url = `https://gateway.autonolas.tech/ipfs/${ipfsHash}`;
        let res: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            res = await axios.get(url, { timeout: 8000 });
            if (res && res.status === 200 && res.data) break;
          } catch (e) {
            if (attempt < 4) await new Promise(r => setTimeout(r, 1500));
          }
        }
        if (res && res.status === 200 && res.data && Array.isArray(res.data.artifacts)) {
          const artifactsRepo = (context as any).db?.artifact || (context as any).entities?.artifact;
          if (artifactsRepo) {
            for (let idx = 0; idx < res.data.artifacts.length; idx++) {
              const a = res.data.artifacts[idx] || {};
              const id = `${requestId}:${idx}`; // deterministic within request
              const name = typeof a.name === 'string' ? a.name : `artifact-${idx}`;
              const cid = String(a.cid || '');
              const topic = String(a.topic || '');
              const contentPreview = typeof a.contentPreview === 'string' ? a.contentPreview : undefined;
              if (!cid || !topic) continue;
              await artifactsRepo.upsert({
                id,
                create: { requestId, name, cid, topic, contentPreview },
                update: { requestId, name, cid, topic, contentPreview },
              });
            }
          }
        }
      }
    } catch (e: any) {
      console.error({ requestId, err: e?.message || String(e) }, 'Failed to resolve delivery artifacts');
    }

    console.log({ requestId, ipfsHash }, "Indexed Deliver (delivery ipfs)");
  } catch (e: any) {
    console.error({ err: e?.message || String(e) }, "Failed to index Deliver");
  }
});


