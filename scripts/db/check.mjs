import { createSql } from "../../src/lib/sql.ts";
import { ensureLocalShim } from "./lib/local-shim.mjs";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirnameEnv = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirnameEnv, "../../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

await ensureLocalShim(process.env.DATABASE_URL);
const sql = createSql(process.env.DATABASE_URL);

async function main() {
  const result = await sql`SELECT date, article_count, page_count FROM editions ORDER BY date;`;
  console.log(`Found ${result.length} editions in the database:`);
  result.forEach((r) =>
    console.log(`  ${r.date}: ${r.article_count} articles, ${r.page_count} pages`)
  );
}

main().catch(console.error);
