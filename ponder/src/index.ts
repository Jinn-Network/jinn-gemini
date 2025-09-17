import { ponder } from "@/generated";

ponder.on("MechMarketplace:MarketplaceRequest", async ({ event, context }) => {
  try {
    const mech: string = String(event.args.priorityMech);
    const sender: string = String(event.args.requester);
    const requestIds: string[] = (event.args.requestIds || []).map((x: any) => String(x));
    const txHash: string = String(event.transaction.hash);
    const blockNumber: bigint = BigInt(event.block.number);
    const blockTimestamp: bigint = BigInt(event.block.timestamp);

    const repo = (context as any).db?.request || (context as any).entities?.request;
    if (!repo) {
      console.error("No repository for 'request' (neither context.db nor context.entities). Skipping upsert.");
      return;
    }

    for (const id of requestIds) {
      await repo.upsert({
        id,
        create: {
          mech,
          sender,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
          delivered: false,
        },
        update: {
          mech,
          sender,
          transactionHash: txHash,
          blockNumber,
          blockTimestamp,
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


