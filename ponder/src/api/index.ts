import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { client, graphql } from "ponder";

const app = new Hono();

// Enable CORS for all routes (required for SSE from different origins)
app.use("/*", cors({
  origin: "*", // Allow all origins (or specify your domains)
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Accept", "Cache-Control"],
  credentials: true,
}));

// ADW discovery endpoint
app.get("/.well-known/adw.json", (c) => {
  return c.json({
    "@context": "https://adw.dev/v0.1",
    "type": "https://adw.dev/v0.1#discovery",
    "publisher": {
      "name": "Jinn Network",
      "url": "https://jinn.network",
    },
    "documentTypes": [
      "adw:Artifact",
      "adw:Blueprint",
      "adw:Template",
      "adw:Skill",
      "adw:Configuration",
      "adw:Knowledge",
      "adw:AgentCard",
    ],
    "registries": {
      "base:8453": {
        "documentRegistry": "0x40Eac2B201D12b13b442c330eED0A2aB04b06DeE",
        "reputationRegistry": "0x6dF7f8d643DD140fCE38C5bf346A11DA4a4B0330",
        "validationRegistry": "0xC552bd9f22f8BB9CFa898A11f12B8D676D8155F6",
      },
    },
    "api": {
      "graphql": "https://indexer.jinn.network/graphql",
      "explorer": "https://adw-explorer.jinn.network",
    },
    "storage": {
      "primary": "ipfs",
      "gateway": "https://gateway.autonolas.tech/ipfs/",
    },
  });
});

// SQL over HTTP for @ponder/client (SSE)
app.use("/sql/*", client({ db, schema }));

// GraphQL API for existing queries
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;

