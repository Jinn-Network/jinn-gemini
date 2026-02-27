import { onchainTable, index } from "ponder";

export const document = onchainTable(
  "document",
  (t) => ({
    id: t.bigint().primaryKey(),                // on-chain documentId (ERC-721 token ID)
    creator: t.hex().notNull(),                 // address that called register()
    documentType: t.text().notNull(),           // e.g. "adw:Artifact", "adw:Blueprint"
    documentURI: t.text().notNull(),            // IPFS URI or other resolvable URI
    contentHash: t.hex().notNull(),             // bytes32 content hash
    timestamp: t.bigint().notNull(),            // block timestamp from event
    blockNumber: t.bigint().notNull(),
    transactionHash: t.hex().notNull(),
    // Aggregated reputation
    feedbackCount: t.integer().notNull().default(0),
    avgScore: t.real(),                         // null until first feedback
    // Aggregated validation
    validationRequestCount: t.integer().notNull().default(0),
    validationResponseCount: t.integer().notNull().default(0),
  }),
  (table) => ({
    creatorIdx: index().on(table.creator),
    documentTypeIdx: index().on(table.documentType),
    timestampIdx: index().on(table.timestamp),
  })
);

export const feedback = onchainTable(
  "feedback",
  (t) => ({
    id: t.text().primaryKey(),                  // `${documentId}-${txHash}-${logIndex}`
    documentId: t.bigint().notNull(),
    sender: t.hex().notNull(),
    score: t.bigint().notNull(),                // int128 raw score
    decimals: t.integer().notNull(),
    tag1: t.text(),
    tag2: t.text(),
    feedbackURI: t.text(),
    feedbackHash: t.hex(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    transactionHash: t.hex().notNull(),
  }),
  (table) => ({
    documentIdIdx: index().on(table.documentId),
    senderIdx: index().on(table.sender),
    timestampIdx: index().on(table.timestamp),
  })
);

export const validationRequest = onchainTable(
  "validation_request",
  (t) => ({
    id: t.hex().primaryKey(),                   // requestHash
    documentId: t.bigint().notNull(),
    validator: t.hex().notNull(),
    requester: t.hex().notNull(),
    requestURI: t.text(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    transactionHash: t.hex().notNull(),
    // Response fields (null until responded)
    responded: t.boolean().notNull().default(false),
    response: t.integer(),                      // uint8 response score
    responseURI: t.text(),
    responseHash: t.hex(),
    responseTag: t.text(),
    respondedAt: t.bigint(),
    respondedBlockNumber: t.bigint(),
    respondedTransactionHash: t.hex(),
  }),
  (table) => ({
    documentIdIdx: index().on(table.documentId),
    validatorIdx: index().on(table.validator),
    requesterIdx: index().on(table.requester),
    respondedIdx: index().on(table.responded),
  })
);
