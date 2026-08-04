/**
 * Operator-runnable retention sweep — deletes expired ask_session_turns,
 * out-of-retention ask_feedback, and stale api_rate_bucket rows via
 * src/lib/retention.ts. Data-only; schema comes from `npm run db:migrate`.
 *
 * This phase authorizes LOCAL/TEST databases only. Production use remains
 * gated behind the Phase 8 rollout approval (the Vercel cron in
 * vercel.json is inert until the project is deployed).
 *
 * Usage (requires DATABASE_URL and --yes):
 *   node --import tsx scripts/db/retention-sweep.mjs --yes
 *
 * Prints the deletion counts as JSON: { sessionTurns, feedback, rateBuckets }.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const localEnvModule = await import("../lib/local-env.ts");
const { loadLocalEnv } = localEnvModule.default ?? localEnvModule;
const runnerModule = await import("./lib/migration-runner.ts");
const { assertMigrationsCurrent } = runnerModule.default ?? runnerModule;
const executorModule = await import("./lib/neon-executor.ts");
const { createNeonExecutor } = executorModule.default ?? executorModule;
const retentionModule = await import("../../src/lib/retention.ts");
const { runRetentionSweep } = retentionModule.default ?? retentionModule;

function fail(message) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

async function main() {
    loadLocalEnv();
    if (!process.env.DATABASE_URL) fail("DATABASE_URL is required.");
    if (!process.argv.includes("--yes")) {
        fail(
            "This phase authorizes local/test databases only. Re-run with --yes to confirm the target database is not production.",
        );
    }

    const executor = createNeonExecutor(process.env.DATABASE_URL);
    await assertMigrationsCurrent(executor);

    const counts = await runRetentionSweep(executor);
    console.log(JSON.stringify(counts, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
