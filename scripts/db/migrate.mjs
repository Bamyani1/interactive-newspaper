/**
 * Canonical migration CLI.
 *
 * Applies the numbered migrations in scripts/db/migrations against
 * DATABASE_URL via the shared migration runner (advisory-locked, checksummed,
 * one transaction per migration).
 *
 * Usage:
 *   npm run db:migrate           — apply pending migrations
 *   npm run db:migrate:status    — show applied/pending without applying
 */

import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// .mjs importing .ts named exports needs the default-interop pattern (tsx
// compiles .ts to CJS because package.json has no "type":"module").
const localEnvModule = await import("../lib/local-env.ts");
const { loadLocalEnv } = localEnvModule.default ?? localEnvModule;
loadLocalEnv(path.resolve(scriptDir, "../../.env.local"));

if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL is required.");
    console.error("Set it in .env.local or export it before running this script.");
    process.exit(1);
}

const migrationRunnerModule = await import("./lib/migration-runner.ts");
const { runMigrations, migrationStatus } = migrationRunnerModule.default ?? migrationRunnerModule;
const neonExecutorModule = await import("./lib/neon-executor.ts");
const { createNeonExecutor } = neonExecutorModule.default ?? neonExecutorModule;

const isStatus = process.argv.includes("--status");

function printList(label, ids) {
    console.log(`${label} (${ids.length}):${ids.length === 0 ? " none" : ""}`);
    for (const id of ids) {
        console.log(`  ${id}`);
    }
}

async function main() {
    const executor = createNeonExecutor(process.env.DATABASE_URL);

    if (isStatus) {
        const status = await migrationStatus(executor);
        printList("Applied", status.applied);
        printList("Pending", status.pending);
        return;
    }

    const result = await runMigrations(executor);
    printList("Applied", result.applied);
    printList("Skipped (concurrent runner won)", result.skipped);
    printList("Already applied", result.alreadyApplied);
}

main().catch((error) => {
    console.error("Migration failed:", error instanceof Error ? error.message : error);
    process.exit(1);
});
