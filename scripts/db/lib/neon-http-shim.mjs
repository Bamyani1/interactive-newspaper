#!/usr/bin/env node
// Local eval bridge: implements the subset of Neon's SQL-over-HTTP protocol
// that @neondatabase/serverless emits (single query + non-interactive
// transaction batch), executing against a local Postgres via node-postgres.
//
// The driver always requests raw text output + array mode; values pass through
// untouched so the driver's client-side type parsers see exactly the bytes
// Neon would have sent.
//
// Fail-closed: requests are refused unless the Neon-Connection-String header's
// host equals SHIM_EXPECTED_HOST, so a real Neon URL can never be routed here
// by a stray NEON_HTTP_SHIM_URL.
//
// Usage:
//   SHIM_TARGET_DATABASE_URL=postgresql:///evaldb_local node scripts/db/lib/neon-http-shim.mjs
// then point clients at it:
//   NEON_HTTP_SHIM_URL=http://127.0.0.1:7432/sql
//   EVAL_DATABASE_URL=postgresql://local:local@neon-local-shim/evaldb_local

import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json"),
);
const pg = require("pg");

const PORT = Number(process.env.SHIM_PORT ?? 7432);
const TARGET = process.env.SHIM_TARGET_DATABASE_URL;
const EXPECTED_HOST = process.env.SHIM_EXPECTED_HOST ?? "neon-local-shim";
const MAX_BODY_BYTES = 256 * 1024 * 1024;

if (!TARGET) {
  console.error("SHIM_TARGET_DATABASE_URL is required.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: TARGET, max: 8 });
// Identity parsers: keep every value as the raw text Postgres sent.
const rawText = { getTypeParser: () => (value) => value };

const ISOLATION_LEVELS = {
  ReadUncommitted: "READ UNCOMMITTED",
  ReadCommitted: "READ COMMITTED",
  RepeatableRead: "REPEATABLE READ",
  Serializable: "SERIALIZABLE",
};

function toResult(res) {
  return {
    command: res.command,
    rowCount: res.rowCount ?? 0,
    fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rows: res.rows,
    rowAsArray: true,
  };
}

function pgErrorBody(error) {
  const body = { message: error.message };
  for (const key of [
    "severity", "code", "detail", "hint", "position", "internalPosition",
    "internalQuery", "where", "schema", "table", "column", "dataType",
    "constraint", "file", "line", "routine",
  ]) {
    if (error[key] !== undefined) body[key] = String(error[key]);
  }
  return JSON.stringify(body);
}

function queryConfig(q) {
  return {
    text: q.query,
    values: q.params ?? [],
    rowMode: "array",
    types: rawText,
  };
}

async function runBatch(queries, headers) {
  const client = await pool.connect();
  try {
    const isolation = ISOLATION_LEVELS[headers["neon-batch-isolation-level"]] ?? null;
    let begin = "BEGIN";
    if (isolation) begin += ` ISOLATION LEVEL ${isolation}`;
    if (headers["neon-batch-read-only"] === "true") begin += " READ ONLY";
    if (headers["neon-batch-deferrable"] === "true") begin += " DEFERRABLE";
    await client.query(begin);
    const results = [];
    for (const q of queries) {
      results.push(toResult(await client.query(queryConfig(q))));
    }
    await client.query("COMMIT");
    return results;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function hostOf(connectionString) {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(200, { "content-type": "text/plain" }).end("neon-http-shim ok");
    return;
  }
  const chunks = [];
  let bytes = 0;
  req.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) req.destroy();
    else chunks.push(chunk);
  });
  req.on("end", async () => {
    try {
      const connHost = hostOf(req.headers["neon-connection-string"] ?? "");
      if (connHost !== EXPECTED_HOST) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({
          message: `neon-http-shim refuses host "${connHost}"; expected "${EXPECTED_HOST}". This shim only serves the local eval database.`,
        }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      let payload;
      if (Array.isArray(body.queries)) {
        payload = { results: await runBatch(body.queries, req.headers) };
      } else {
        payload = toResult(await pool.query(queryConfig(body)));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(pgErrorBody(error));
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`neon-http-shim listening on http://127.0.0.1:${PORT}/sql -> local Postgres`);
});
