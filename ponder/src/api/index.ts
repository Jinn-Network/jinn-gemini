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

// SQL over HTTP for @ponder/client (SSE)
app.use("/sql/*", client({ db, schema }));

// GraphQL API for existing queries
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;

