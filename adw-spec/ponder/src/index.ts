import { ponder } from "ponder:registry";
import { document, feedback, validationRequest } from "ponder:schema";

// ── Document Registry ──────────────────────────────────────────────────────

ponder.on("ADWDocumentRegistry:DocumentRegistered", async ({ event, context }) => {
  const { documentId, creator, documentType, documentURI, contentHash, timestamp } = event.args;

  await context.db
    .insert(document)
    .values({
      id: documentId,
      creator,
      documentType,
      documentURI,
      contentHash,
      timestamp,
      blockNumber: BigInt(event.block.number),
      transactionHash: event.transaction.hash,
      feedbackCount: 0,
      validationRequestCount: 0,
      validationResponseCount: 0,
    })
    .onConflictDoNothing();
});

ponder.on("ADWDocumentRegistry:DocumentURIUpdated", async ({ event, context }) => {
  const { documentId, newDocumentURI } = event.args;

  await context.db
    .update(document, { id: documentId })
    .set({ documentURI: newDocumentURI });
});

// ── Reputation Registry ────────────────────────────────────────────────────

ponder.on("ADWReputationRegistry:FeedbackGiven", async ({ event, context }) => {
  const { documentId, sender, score, decimals, tag1, tag2, feedbackURI, feedbackHash, timestamp } = event.args;

  const feedbackId = `${documentId}-${event.transaction.hash}-${event.log.logIndex}`;

  await context.db
    .insert(feedback)
    .values({
      id: feedbackId,
      documentId,
      sender,
      score,
      decimals,
      tag1: tag1 || null,
      tag2: tag2 || null,
      feedbackURI: feedbackURI || null,
      feedbackHash: feedbackHash || null,
      timestamp,
      blockNumber: BigInt(event.block.number),
      transactionHash: event.transaction.hash,
    })
    .onConflictDoNothing();

  // Update document aggregate
  const allFeedback = await context.db.sql`
    SELECT score, decimals FROM feedback WHERE document_id = ${documentId}
  `;

  const count = allFeedback.rows.length;
  let avgScore: number | null = null;
  if (count > 0) {
    const sum = allFeedback.rows.reduce((acc: number, row: { score: bigint; decimals: number }) => {
      return acc + Number(row.score) / (10 ** row.decimals);
    }, 0);
    avgScore = sum / count;
  }

  await context.db
    .update(document, { id: documentId })
    .set({ feedbackCount: count, avgScore });
});

// ── Validation Registry ────────────────────────────────────────────────────

ponder.on("ADWValidationRegistry:ValidationRequested", async ({ event, context }) => {
  const { validator, documentId, requester, requestURI, requestHash, timestamp } = event.args;

  await context.db
    .insert(validationRequest)
    .values({
      id: requestHash,
      documentId,
      validator,
      requester,
      requestURI: requestURI || null,
      timestamp,
      blockNumber: BigInt(event.block.number),
      transactionHash: event.transaction.hash,
      responded: false,
    })
    .onConflictDoNothing();

  // Update document aggregate
  const requests = await context.db.sql`
    SELECT COUNT(*) as cnt FROM validation_request WHERE document_id = ${documentId}
  `;
  const count = Number(requests.rows[0]?.cnt ?? 0);

  await context.db
    .update(document, { id: documentId })
    .set({ validationRequestCount: count });
});

ponder.on("ADWValidationRegistry:ValidationResponded", async ({ event, context }) => {
  const { requestHash, response, responseURI, responseHash, tag, timestamp } = event.args;

  await context.db
    .update(validationRequest, { id: requestHash })
    .set({
      responded: true,
      response,
      responseURI: responseURI || null,
      responseHash: responseHash || null,
      responseTag: tag || null,
      respondedAt: timestamp,
      respondedBlockNumber: BigInt(event.block.number),
      respondedTransactionHash: event.transaction.hash,
    });

  // Update document aggregate — find the documentId from the request
  const req = await context.db.find(validationRequest, { id: requestHash });
  if (req) {
    const responses = await context.db.sql`
      SELECT COUNT(*) as cnt FROM validation_request
      WHERE document_id = ${req.documentId} AND responded = true
    `;
    const count = Number(responses.rows[0]?.cnt ?? 0);

    await context.db
      .update(document, { id: req.documentId })
      .set({ validationResponseCount: count });
  }
});
