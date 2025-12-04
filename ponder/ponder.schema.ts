import { onchainTable, index } from "ponder";

export const jobDefinition = onchainTable(
  "job_definition",
  (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
    enabledTools: t.text().array(),
    blueprint: t.text(),
    workstreamId: t.text(),
    sourceJobDefinitionId: t.text(),
    sourceRequestId: t.text(),
    codeMetadata: t.json(),
    dependencies: t.text().array(),
    createdAt: t.bigint(),
    lastInteraction: t.bigint(),
    lastStatus: t.text(),
  }),
  (table) => ({
    nameIdx: index().on(table.name),
    workstreamIdIdx: index().on(table.workstreamId),
    sourceJobDefIdx: index().on(table.sourceJobDefinitionId),
    sourceReqIdx: index().on(table.sourceRequestId),
    lastInteractionIdx: index().on(table.lastInteraction),
  })
);

export const request = onchainTable(
  "request",
  (t) => ({
    id: t.text().primaryKey(),
    mech: t.hex().notNull(),
    sender: t.hex().notNull(),
    workstreamId: t.text(),
    jobDefinitionId: t.text(),
    sourceRequestId: t.text(),
    sourceJobDefinitionId: t.text(),
    requestData: t.text(),
    ipfsHash: t.text(),
    deliveryIpfsHash: t.text(),
    transactionHash: t.text(),
    blockNumber: t.bigint().notNull(),
    blockTimestamp: t.bigint().notNull(),
    delivered: t.boolean().notNull(),
    jobName: t.text(),
    enabledTools: t.text().array(),
    additionalContext: t.json(),
    dependencies: t.text().array(),
  }),
  (table) => ({
    ts: index().on(table.blockTimestamp),
    mechIdx: index().on(table.mech),
    senderIdx: index().on(table.sender),
    workstreamIdIdx: index().on(table.workstreamId),
    jobDefIdx: index().on(table.jobDefinitionId),
    sourceReqIdx: index().on(table.sourceRequestId),
    sourceJobDefIdx: index().on(table.sourceJobDefinitionId),
  })
);

export const delivery = onchainTable(
  "delivery",
  (t) => ({
    id: t.text().primaryKey(),
    requestId: t.text().notNull(),
    sourceRequestId: t.text(),
    sourceJobDefinitionId: t.text(),
    mech: t.hex().notNull(),
    mechServiceMultisig: t.hex().notNull(),
    deliveryRate: t.bigint().notNull(),
    ipfsHash: t.text(),
    transactionHash: t.text().notNull(),
    blockNumber: t.bigint().notNull(),
    blockTimestamp: t.bigint().notNull(),
  }),
  (table) => ({
    ts: index().on(table.blockTimestamp),
    mechIdx: index().on(table.mech),
    requestIdIdx: index().on(table.requestId),
    sourceReqIdx: index().on(table.sourceRequestId),
    sourceJobDefIdx: index().on(table.sourceJobDefinitionId),
  })
);

export const artifact = onchainTable(
  "artifact",
  (t) => ({
    id: t.text().primaryKey(),
    requestId: t.text().notNull(),
    sourceRequestId: t.text(),
    sourceJobDefinitionId: t.text(),
    name: t.text().notNull(),
    cid: t.text().notNull(),
    topic: t.text().notNull(),
    contentPreview: t.text(),
    blockTimestamp: t.bigint().notNull(),
    type: t.text(),
    tags: t.text().array(),
    utilityScore: t.integer(),
    accessCount: t.integer(),
  }),
  (table) => ({
    requestIdIdx: index().on(table.requestId),
    sourceReqIdx: index().on(table.sourceRequestId),
    sourceJobDefIdx: index().on(table.sourceJobDefinitionId),
    topicIdx: index().on(table.topic),
    timestampIdx: index().on(table.blockTimestamp),
    typeIdx: index().on(table.type),
    utilityIdx: index().on(table.utilityScore),
  })
);

export const message = onchainTable(
  "message",
  (t) => ({
    id: t.text().primaryKey(),
    requestId: t.text().notNull(),
    sourceRequestId: t.text(),
    sourceJobDefinitionId: t.text(),
    to: t.text(),
    content: t.text().notNull(),
    blockTimestamp: t.bigint().notNull(),
  }),
  (table) => ({
    requestIdx: index().on(table.requestId),
    sourceReqIdx: index().on(table.sourceRequestId),
    sourceJobDefIdx: index().on(table.sourceJobDefinitionId),
    toIdx: index().on(table.to),
    ts: index().on(table.blockTimestamp),
  })
);

export const workstream = onchainTable(
  "workstream",
  (t) => ({
    id: t.text().primaryKey(), // workstreamId (same as root request ID)
    rootRequestId: t.text().notNull(),
    jobName: t.text(),
    mech: t.hex().notNull(),
    sender: t.hex().notNull(),
    blockTimestamp: t.bigint().notNull(),
    lastActivity: t.bigint().notNull(),
    childRequestCount: t.integer().notNull(),
    hasLauncherBriefing: t.boolean().notNull(),
    delivered: t.boolean().notNull(),
  }),
  (table) => ({
    timestampIdx: index().on(table.blockTimestamp),
    lastActivityIdx: index().on(table.lastActivity),
    mechIdx: index().on(table.mech),
    senderIdx: index().on(table.sender),
  })
);
