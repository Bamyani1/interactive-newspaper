#!/usr/bin/env node
// Runs a command (normally `next dev`) with the local database reachable:
// when .env.local's DATABASE_URL is localhost, the neon-http-shim starts here
// and lives as long as the command. A Neon URL passes straight through.
//
// Usage: node scripts/dev/with-local-db.mjs next dev [args…]

import { spawn } from "node:child_process";
import nextEnv from "@next/env";
import { ensureLocalShim } from "../db/lib/local-shim.mjs";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/dev/with-local-db.mjs <command> [args…]");
  process.exit(1);
}

nextEnv.loadEnvConfig(process.cwd(), true);
await ensureLocalShim(process.env.DATABASE_URL);

const child = spawn(command, args, { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
