import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { client, graphql } from "ponder";
import { count } from "ponder";
import { document, feedback, validationRequest } from "ponder:schema";

const app = new Hono();

app.use("/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Accept", "Cache-Control"],
  credentials: true,
}));

app.get("/.well-known/adw.json", async (c) => {
  const typeCounts = await db
    .select({ documentType: document.documentType, count: count() })
    .from(document)
    .groupBy(document.documentType);

  const totalDocuments = typeCounts.reduce((sum, row) => sum + Number(row.count), 0);
  const totalFeedback = await db.select({ count: count() }).from(feedback);
  const totalValidations = await db.select({ count: count() }).from(validationRequest);

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

// SQL over HTTP for @ponder/client (SSE)
app.use("/sql/*", client({ db, schema }));

// GraphQL API
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
