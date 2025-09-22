import { createSchema } from "@ponder/core";

export default createSchema((p: any) => ({
  request: p.createTable(
    {
      id: p.string(),
      mech: p.hex(),
      sender: p.hex(),
      requestData: p.string().optional(),
      ipfsHash: p.string().optional(),
      deliveryIpfsHash: p.string().optional(),
      transactionHash: p.string().optional(),
      blockNumber: p.bigint(),
      blockTimestamp: p.bigint(),
      delivered: p.boolean(),
      jobName: p.string().optional(),
      enabledTools: p.string().list().optional(),
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
      ipfsHash: p.string().optional(),
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
  artifact: p.createTable(
    {
      id: p.string(),
      requestId: p.string(),
      name: p.string(),
      cid: p.string(),
      topic: p.string(),
      contentPreview: p.string().optional(),
    },
    {
      requestIdIdx: p.index("requestId"),
      topicIdx: p.index("topic"),
    }
  ),
}));


