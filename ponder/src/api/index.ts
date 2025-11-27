import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client } from "ponder";

const app = new Hono();

// Enable SQL over HTTP for @ponder/client
app.use("/sql/*", client({ db, schema }));

export default app;

