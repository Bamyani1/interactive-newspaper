#!/usr/bin/env node
// Local eval bridge CLI: runs the neon-http-shim (./local-shim.mjs) as its own
// process for evaluation runs. Fail-closed: requests are refused unless the
// Neon-Connection-String header's host equals SHIM_EXPECTED_HOST, so a real
// Neon URL can never be routed here by a stray NEON_HTTP_SHIM_URL.
//
// Usage:
//   SHIM_TARGET_DATABASE_URL=postgresql:///evaldb_local node scripts/db/lib/neon-http-shim.mjs
// then point clients at it:
//   NEON_HTTP_SHIM_URL=http://127.0.0.1:7432/sql
//   EVAL_DATABASE_URL=postgresql://local:local@neon-local-shim/evaldb_local

import { startNeonHttpShim } from "./local-shim.mjs";

const TARGET = process.env.SHIM_TARGET_DATABASE_URL;
if (!TARGET) {
  console.error("SHIM_TARGET_DATABASE_URL is required.");
  process.exit(1);
}

const shim = await startNeonHttpShim({
  targetUrl: TARGET,
  port: Number(process.env.SHIM_PORT ?? 7432),
  expectedHost: process.env.SHIM_EXPECTED_HOST ?? "neon-local-shim",
  allowedDatabases: (process.env.SHIM_ALLOWED_DATABASES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
});
console.log(`neon-http-shim listening on http://127.0.0.1:${shim.port}/sql -> local Postgres`);
