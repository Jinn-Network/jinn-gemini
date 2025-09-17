import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  request: p.createTable(
    {
      id: p.string(),
      mech: p.hex(),
      sender: p.hex(),
      ipfsHash: p.string().optional(),
      transactionHash: p.string().optional(),
      blockNumber: p.bigint(),
      blockTimestamp: p.bigint(),
      delivered: p.boolean(),
    },
    {
      ts: p.index("blockTimestamp").desc(),
      mechIdx: p.index("mech"),
      senderIdx: p.index("sender"),
    }
  ),
  delivery: p.createTable(
    {
      id: p.string(),
      requestId: p.string(),
      mech: p.hex(),
      mechServiceMultisig: p.hex(),
      deliveryRate: p.bigint(),
      transactionHash: p.string(),
      blockNumber: p.bigint(),
      blockTimestamp: p.bigint(),
    },
    {
      ts: p.index("blockTimestamp").desc(),
      mechIdx: p.index("mech"),
      requestIdIdx: p.index("requestId"),
    }
  ),
}));


