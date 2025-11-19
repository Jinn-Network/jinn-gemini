import { createSchema } from "@ponder/core";

export default createSchema((p: any) => ({
  jobDefinition: p.createTable(
    {
      id: p.string(),
      name: p.string(),
      enabledTools: p.string().list().optional(),
      blueprint: p.string().optional(),
      sourceJobDefinitionId: p.string().optional(),
      sourceRequestId: p.string().optional(),
      codeMetadata: p.json().optional(),
      createdAt: p.bigint().optional(),
      lastInteraction: p.bigint().optional(),
      lastStatus: p.string().optional(),
    },
    {
      nameIdx: p.index("name"),
      sourceJobDefIdx: p.index("sourceJobDefinitionId"),
      sourceReqIdx: p.index("sourceRequestId"),
      lastInteractionIdx: p.index("lastInteraction").desc(),
    }
  ),
  request: p.createTable(
    {
      id: p.string(),
      mech: p.hex(),
      sender: p.hex(),
      workstreamId: p.string().optional(),
      jobDefinitionId: p.string().optional(),
      sourceRequestId: p.string().optional(),
      sourceJobDefinitionId: p.string().optional(),
      requestData: p.string().optional(),
      ipfsHash: p.string().optional(),
      deliveryIpfsHash: p.string().optional(),
      transactionHash: p.string().optional(),
      blockNumber: p.bigint(),
      blockTimestamp: p.bigint(),
      delivered: p.boolean(),
      jobName: p.string().optional(),
      enabledTools: p.string().list().optional(),
      additionalContext: p.json().optional(),
      dependencies: p.string().list().optional(),
    },
    {
      ts: p.index("blockTimestamp").desc(),
      mechIdx: p.index("mech"),
      senderIdx: p.index("sender"),
      workstreamIdIdx: p.index("workstreamId"),
      jobDefIdx: p.index("jobDefinitionId"),
      sourceReqIdx: p.index("sourceRequestId"),
      sourceJobDefIdx: p.index("sourceJobDefinitionId"),
    }
  ),
  delivery: p.createTable(
    {
      id: p.string(),
      requestId: p.string(),
      sourceRequestId: p.string().optional(),
      sourceJobDefinitionId: p.string().optional(),
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
      sourceReqIdx: p.index("sourceRequestId"),
      sourceJobDefIdx: p.index("sourceJobDefinitionId"),
    }
  ),
  artifact: p.createTable(
    {
      id: p.string(),
      requestId: p.string(),
      sourceRequestId: p.string().optional(),
      sourceJobDefinitionId: p.string().optional(),
      name: p.string(),
      cid: p.string(),
      topic: p.string(),
      contentPreview: p.string().optional(),
      blockTimestamp: p.bigint(),
      type: p.string().optional(),           // NEW: 'MEMORY', 'RESEARCH_REPORT', etc.
      tags: p.string().list().optional(),    // NEW: ['staking', 'bug-fix', 'optimization']
      utilityScore: p.int().optional(),      // NEW: cumulative rating score
      accessCount: p.int().optional(),       // NEW: how many times accessed
    },
    {
      requestIdIdx: p.index("requestId"),
      sourceReqIdx: p.index("sourceRequestId"),
      sourceJobDefIdx: p.index("sourceJobDefinitionId"),
      topicIdx: p.index("topic"),
      timestampIdx: p.index("blockTimestamp"),
      typeIdx: p.index("type"),              // NEW: filter by type
      utilityIdx: p.index("utilityScore"),   // NEW: rank by utility
    }
  ),
  message: p.createTable(
    {
      id: p.string(),
      requestId: p.string(),
      sourceRequestId: p.string().optional(),
      sourceJobDefinitionId: p.string().optional(),
      to: p.string().optional(),
      content: p.string(),
      blockTimestamp: p.bigint(),
    },
    {
      requestIdx: p.index("requestId"),
      sourceReqIdx: p.index("sourceRequestId"),
      sourceJobDefIdx: p.index("sourceJobDefinitionId"),
      toIdx: p.index("to"),
      ts: p.index("blockTimestamp").desc(),
    }
  ),
}));


