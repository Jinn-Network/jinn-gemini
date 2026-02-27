import { ponder } from "ponder:registry";
import { document, feedback, validationRequest } from "ponder:schema";
import { desc, eq, count, sql } from "ponder";

ponder.get("/.well-known/adw.json", async (c) => {
  // Count documents by type
  const typeCounts = await c.db
    .select({ documentType: document.documentType, count: count() })
    .from(document)
    .groupBy(document.documentType);

  const totalDocuments = typeCounts.reduce((sum, row) => sum + Number(row.count), 0);
  const totalFeedback = await c.db.select({ count: count() }).from(feedback);
  const totalValidations = await c.db.select({ count: count() }).from(validationRequest);

  return c.json({
    "@context": "https://adw.dev/v0.1",
    type: "https://adw.dev/v0.1#discovery",
    publisher: {
      name: "ADW Registry (Base)",
      description: "On-chain document registry for the Agentic Document Web",
    },
    stats: {
      totalDocuments,
      totalFeedback: Number(totalFeedback[0]?.count ?? 0),
      totalValidationRequests: Number(totalValidations[0]?.count ?? 0),
      documentsByType: Object.fromEntries(
        typeCounts.map((row) => [row.documentType, Number(row.count)])
      ),
    },
    registries: {
      "base:8453": {
        documentRegistry: "0x40Eac2B201D12b13b442c330eED0A2aB04b06DeE",
        reputationRegistry: "0x6dF7f8d643DD140fCE38C5bf346A11DA4a4B0330",
        validationRegistry: "0xC552bd9f22f8BB9CFa898A11f12B8D676D8155F6",
      },
    },
    api: {
      graphql: process.env.ADW_PONDER_PUBLIC_URL
        ? `${process.env.ADW_PONDER_PUBLIC_URL}/graphql`
        : "/graphql",
    },
    storage: {
      primary: "ipfs",
      gateway: "https://gateway.autonolas.tech/ipfs/",
    },
  });
});

// Health check
ponder.get("/health", async (c) => {
  const result = await c.db.select({ count: count() }).from(document);
  return c.json({ ok: true, documents: Number(result[0]?.count ?? 0) });
});
