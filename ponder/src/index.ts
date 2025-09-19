import { ponder } from "@/generated";
import { resolveRequestIpfsContent } from "../../gemini-agent/mcp/tools/shared/ipfs";

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

    for (const reqId of requestIds) {
      await repo.upsert({
        id: reqId,
        create: {
          requestId: reqId,
          mech: deliveryMech,
          mechServiceMultisig: ZERO_ADDRESS,
          deliveryRate: ZERO_RATE,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
        },
        update: {
          requestId: reqId,
          mech: deliveryMech,
          mechServiceMultisig: ZERO_ADDRESS,
          deliveryRate: ZERO_RATE,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
        },
      });
      const requestRepo = (context as any).db?.request || (context as any).entities?.request;
      if (requestRepo) {
        await requestRepo.upsert({
          id: reqId,
          create: { delivered: true },
          update: { delivered: true },
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

    for (const reqId of requestIds) {
      await repo.upsert({
        id: reqId,
        create: {
          requestId: reqId,
          mech: deliveryMech,
          mechServiceMultisig: ZERO_ADDRESS,
          deliveryRate: ZERO_RATE,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
        },
        update: {
          requestId: reqId,
          mech: deliveryMech,
          mechServiceMultisig: ZERO_ADDRESS,
          deliveryRate: ZERO_RATE,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
        },
      });
      const requestRepo = (context as any).db?.request || (context as any).entities?.request;
      if (requestRepo) {
        await requestRepo.upsert({
          id: reqId,
          create: { delivered: true },
          update: { delivered: true },
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

    console.log({ requestId, ipfsHash }, "Indexed Deliver (delivery ipfs)");
  } catch (e: any) {
    console.error({ err: e?.message || String(e) }, "Failed to index Deliver");
  }
});


