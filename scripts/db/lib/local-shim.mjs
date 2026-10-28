// Local neon-http-shim: implements the subset of Neon's SQL-over-HTTP protocol
// that @neondatabase/serverless emits (single query + non-interactive
// transaction batch), executing against a local Postgres via node-postgres.
//
// The driver always requests raw text output + array mode; values pass through
// untouched so the driver's client-side type parsers see exactly the bytes
// Neon would have sent.
//
// Fail-closed: requests are refused unless the Neon-Connection-String header's
// host equals the expected host, and only allowlisted databases are served, so
// a real Neon URL can never be answered here.
//
// Two users: the eval CLI (neon-http-shim.mjs, host "neon-local-shim") and
// ensureLocalShim(), which every script and `npm run dev` call so a localhost
// DATABASE_URL just works (src/lib/sql.ts routes localhost here).

import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json")
);
const pg = require("pg");

const MAX_BODY_BYTES = 256 * 1024 * 1024;
const DEFAULT_LOCAL_SHIM_PORT = 7433;

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
    "severity",
    "code",
    "detail",
    "hint",
    "position",
    "internalPosition",
    "internalQuery",
    "where",
    "schema",
    "table",
    "column",
    "dataType",
    "constraint",
    "file",
    "line",
    "routine",
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

async function runBatch(pool, queries, headers) {
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

function parseConnection(connectionString) {
  try {
    const url = new URL(connectionString);
    return { host: url.hostname, database: url.pathname.replace(/^\//, "") };
  } catch {
    return { host: null, database: null };
  }
}

/**
 * Start a shim. Requests are routed to the LOCAL database named in the
 * connection string, but only names in `allowedDatabases` are served
 * (default: the database of `targetUrl`), so two local databases (e.g. the
 * eval DB and a rehearsal DB) never cross-write. `unref` lets a script that
 * started it in-process exit normally after its last query.
 */
export function startNeonHttpShim({
  targetUrl,
  port,
  expectedHost,
  allowedDatabases,
  unref = false,
}) {
  if (!targetUrl) throw new Error("startNeonHttpShim: targetUrl is required.");
  const defaultDatabase = new URL(targetUrl).pathname.replace(/^\//, "");
  const allowed = new Set(
    (allowedDatabases?.length ? allowedDatabases : [defaultDatabase]).filter(Boolean)
  );

  const pools = new Map();
  function poolFor(database) {
    if (!allowed.has(database)) {
      throw new Error(
        `neon-http-shim refuses database "${database}"; allowed: ${[...allowed].join(", ")}.`
      );
    }
    let pool = pools.get(database);
    if (!pool) {
      const url = new URL(targetUrl);
      url.pathname = `/${database}`;
      pool = new pg.Pool({ connectionString: url.toString(), max: 8, allowExitOnIdle: unref });
      pools.set(database, pool);
    }
    return pool;
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
        const conn = parseConnection(req.headers["neon-connection-string"] ?? "");
        if (conn.host !== expectedHost) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              message: `neon-http-shim refuses host "${conn.host}"; expected "${expectedHost}". This shim only serves allowlisted local databases.`,
            })
          );
          return;
        }
        const pool = poolFor(conn.database);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        let payload;
        if (Array.isArray(body.queries)) {
          payload = { results: await runBatch(pool, body.queries, req.headers) };
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
  if (unref) {
    // Idle keep-alive sockets must not hold a finished script open either.
    server.on("connection", (socket) => socket.unref());
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      if (unref) server.unref();
      resolve({
        port: server.address().port,
        async close() {
          await new Promise((done) => server.close(() => done()));
          await Promise.all([...pools.values()].map((pool) => pool.end()));
        },
      });
    });
  });
}

function localShimPort() {
  return Number(process.env.NEON_LOCAL_SHIM_PORT?.trim() || DEFAULT_LOCAL_SHIM_PORT);
}

async function shimServes(port, databaseUrl) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/sql`, {
      method: "POST",
      headers: { "Neon-Connection-String": databaseUrl, "content-type": "application/json" },
      body: JSON.stringify({ query: "SELECT 1", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const ensured = new Map();

/**
 * Make a localhost DATABASE_URL answerable: reuse a shim already serving this
 * database on the local shim port (another script, `npm run dev`), or start
 * one in this process. A non-local URL is left alone — Neon serves it.
 */
export function ensureLocalShim(databaseUrl = process.env.DATABASE_URL) {
  let host;
  try {
    host = new URL(databaseUrl ?? "").hostname;
  } catch {
    return Promise.resolve();
  }
  if (host !== "localhost") return Promise.resolve();

  const port = localShimPort();
  const key = `${port} ${databaseUrl}`;
  if (!ensured.has(key)) {
    ensured.set(
      key,
      (async () => {
        if (await shimServes(port, databaseUrl)) return;
        try {
          await startNeonHttpShim({
            targetUrl: databaseUrl,
            port,
            expectedHost: "localhost",
            unref: true,
          });
        } catch (error) {
          if (error?.code === "EADDRINUSE" && (await shimServes(port, databaseUrl))) return;
          if (error?.code === "EADDRINUSE") {
            throw new Error(
              `Port ${port} is busy with something that doesn't serve ${new URL(databaseUrl).pathname.slice(1)}. Stop it or set NEON_LOCAL_SHIM_PORT.`
            );
          }
          throw error;
        }
      })().catch((error) => {
        ensured.delete(key);
        throw error;
      })
    );
  }
  return ensured.get(key);
}
