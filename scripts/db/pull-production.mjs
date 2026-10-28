#!/usr/bin/env node
// Replaces the local database's public schema with a fresh copy of production's.
// Reads PROD_DATABASE_URL (source, only read) and DATABASE_URL (target, must be
// localhost) from .env.local. pg_dump streams into one local psql transaction
// that commits only after the dump finished cleanly, so a failed pull leaves
// the previous local copy in place. Other local schemas (ops) are untouched.
//
// Usage: npm run db:pull

import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import { describeDatabaseTarget, isLocalDatabaseUrl } from "../../src/lib/sql.ts";

/** Neon's pooler can't serve pg_dump; the direct host drops `-pooler`. */
export function directHostUrl(url) {
  return url.replace(/([@/])([^/:@.]+)-pooler\./, "$1$2.");
}

export function assertLocalTarget(url) {
  if (!isLocalDatabaseUrl(url ?? "")) {
    throw new Error(
      `db:pull only writes to a local database; DATABASE_URL is ${describeDatabaseTarget(url ?? "")}.`
    );
  }
}

export function pullPlan({ prodUrl, localUrl }) {
  return {
    dumpArgs: [
      "--format=plain",
      "--no-owner",
      "--no-acl",
      "--schema=public",
      "--extension=vector",
      directHostUrl(prodUrl),
    ],
    psqlArgs: [
      localUrl,
      "--single-transaction",
      "-v",
      "ON_ERROR_STOP=1",
      "--quiet",
      "--output=/dev/null",
    ],
    resetSql: "SET client_min_messages = warning;\nDROP SCHEMA IF EXISTS public CASCADE;\n",
  };
}

function counts(url) {
  return execFileSync(
    "psql",
    [
      url,
      "-At",
      "-c",
      "SELECT (SELECT count(*) FROM editions) || ' editions, ' || (SELECT count(*) FROM articles) || ' articles'",
    ],
    { encoding: "utf8" }
  ).trim();
}

async function main() {
  nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });
  const prodUrl = process.env.PROD_DATABASE_URL;
  const localUrl = process.env.DATABASE_URL;
  if (!prodUrl) throw new Error("PROD_DATABASE_URL is required (the production Neon URL).");
  assertLocalTarget(localUrl);

  const plan = pullPlan({ prodUrl, localUrl });
  console.error(
    `[db:pull] ${describeDatabaseTarget(prodUrl)} -> ${describeDatabaseTarget(localUrl)}`
  );
  const started = Date.now();

  const psql = spawn("psql", plan.psqlArgs, { stdio: ["pipe", "inherit", "inherit"] });
  const dump = spawn("pg_dump", plan.dumpArgs, { stdio: ["ignore", "pipe", "inherit"] });
  const psqlDone = new Promise((resolve) => psql.on("close", resolve));
  const dumpDone = new Promise((resolve) => dump.on("close", resolve));

  psql.stdin.write(plan.resetSql);
  // end: false — stdin closes (and psql commits) only after pg_dump exits 0.
  dump.stdout.pipe(psql.stdin, { end: false });

  const dumpCode = await dumpDone;
  if (dumpCode !== 0) {
    psql.kill("SIGTERM");
    await psqlDone;
    throw new Error(`pg_dump exited ${dumpCode}; local database left as it was.`);
  }
  psql.stdin.end();
  const psqlCode = await psqlDone;
  if (psqlCode !== 0) throw new Error(`psql exited ${psqlCode}; local database left as it was.`);

  const seconds = Math.round((Date.now() - started) / 1000);
  console.error(`[db:pull] done in ${seconds}s`);
  console.error(`[db:pull] production: ${counts(directHostUrl(prodUrl))}`);
  console.error(`[db:pull] local:      ${counts(localUrl)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[db:pull] ${err.message}`);
    process.exit(1);
  });
}
