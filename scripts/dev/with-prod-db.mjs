#!/usr/bin/env node
// Runs a command against PRODUCTION: DATABASE_URL becomes .env.local's
// PROD_DATABASE_URL for the command and everything it starts (their own
// .env.local loading keeps an already-set DATABASE_URL).
//
// Usage: npm run with-prod -- npm run db:seed -- --date 1983-04-21

import { spawn } from "node:child_process";
import nextEnv from "@next/env";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: npm run with-prod -- <command> [args…]");
  process.exit(1);
}

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });
const prodUrl = process.env.PROD_DATABASE_URL;
if (!prodUrl) {
  console.error("PROD_DATABASE_URL is not set in .env.local.");
  process.exit(1);
}
console.error(
  `[with-prod] DATABASE_URL -> PRODUCTION (${new URL(prodUrl).hostname.split(".")[0]})`
);

const child = spawn(command, args, {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: prodUrl },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
