/**
 * Versioned publication CLI — drives the Phase 4 state machine and revision
 * writer against a migrated database. Data-only; schema comes from
 * `npm run db:migrate`.
 *
 * This phase authorizes LOCAL/TEST databases only. Production staging and
 * activation remain gated behind the Phase 8 rollout approval.
 *
 * Usage (all commands require DATABASE_URL and --yes):
 *   node --import tsx scripts/db/publish-edition.mjs --stage <date> [--editions-dir DIR] [--run RUN_ID]
 *   node --import tsx scripts/db/publish-edition.mjs --validate <editionRevisionId>
 *   node --import tsx scripts/db/publish-edition.mjs --activate <editionRevisionId> --run <RUN_ID>
 *   node --import tsx scripts/db/publish-edition.mjs --rollback-to <editionRevisionId> --run <RUN_ID>
 *   node --import tsx scripts/db/publish-edition.mjs --resume <RUN_ID>
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));

const localEnvModule = await import("../lib/local-env.ts");
const { loadLocalEnv } = localEnvModule.default ?? localEnvModule;
const runnerModule = await import("./lib/migration-runner.ts");
const { assertMigrationsCurrent } = runnerModule.default ?? runnerModule;
const executorModule = await import("./lib/neon-executor.ts");
const { createNeonExecutor } = executorModule.default ?? executorModule;
const stateMachineModule = await import("../../src/server/publisher/state-machine.ts");
const { createRun, getRun, transitionRun, activateRevision, rollbackActiveRevision, resumeRun } =
    stateMachineModule.default ?? stateMachineModule;
const writerModule = await import("../../src/server/publisher/revision-writer.ts");
const { writeEditionRevision } = writerModule.default ?? writerModule;
const validateModule = await import("../../src/server/publisher/validate-revision.ts");
const { validateRevision } = validateModule.default ?? validateModule;

function argValue(flag) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

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

    const stageDate = argValue("--stage");
    const validateId = argValue("--validate");
    const activateId = argValue("--activate");
    const rollbackId = argValue("--rollback-to");
    const resumeId = argValue("--resume");
    const runId = argValue("--run");

    if (stageDate) {
        const editionsDir = argValue("--editions-dir") ?? path.resolve(__dirnameLocal, "../../public/editions");
        const editionPath = path.join(editionsDir, stageDate, "edition.json");
        if (!existsSync(editionPath)) fail(`No edition.json at ${editionPath}`);
        const edition = JSON.parse(readFileSync(editionPath, "utf8"));

        const manifestPath = path.join(editionsDir, stageDate, "asset-manifest.json");
        const assetManifest = existsSync(manifestPath)
            ? JSON.parse(readFileSync(manifestPath, "utf8"))
            : undefined;

        const run = runId ?? (await createRun(executor, { metadata: { editionDate: stageDate } }));
        if (!runId) {
            await transitionRun(executor, run, "acquired", { note: "local edition.json source" });
            await transitionRun(executor, run, "ocr_candidate", { note: "existing OCR output" });
            await transitionRun(executor, run, "assets_staged", {
                note: assetManifest ? `manifest v${assetManifest.schema_version}` : "no asset manifest",
            });
        }
        const result = await writeEditionRevision(executor, {
            editionDate: stageDate,
            edition,
            runId: run,
            assetManifest,
        });
        await transitionRun(executor, run, "db_revision_staged", {
            note: `revision ${result.editionRevisionId} (created=${result.created})`,
        });
        console.log(JSON.stringify({ run, ...result }, null, 2));
        return;
    }

    if (validateId) {
        const result = await validateRevision(executor, validateId);
        console.log(JSON.stringify(result, null, 2));
        if (result.ok && runId) {
            await transitionRun(executor, runId, "validated", { note: `revision ${validateId}` });
            console.log(`Run ${runId} -> validated`);
        }
        if (!result.ok) process.exit(1);
        return;
    }

    if (activateId) {
        if (!runId) fail("--activate requires --run <RUN_ID> in state 'validated'.");
        const revision = await executor.query({
            text: "SELECT issue_id FROM edition_revisions WHERE id = $1",
            params: [activateId],
        });
        if (!revision[0]) fail(`Edition revision ${activateId} not found.`);
        await activateRevision(executor, {
            issueId: String(revision[0].issue_id),
            editionRevisionId: activateId,
            runId,
        });
        console.log(`Activated ${activateId} for issue ${revision[0].issue_id} (run ${runId}).`);
        return;
    }

    if (rollbackId) {
        if (!runId) fail("--rollback-to requires --run <RUN_ID> of the active run being rolled back.");
        const revision = await executor.query({
            text: "SELECT issue_id FROM edition_revisions WHERE id = $1",
            params: [rollbackId],
        });
        if (!revision[0]) fail(`Edition revision ${rollbackId} not found.`);
        await rollbackActiveRevision(executor, {
            issueId: String(revision[0].issue_id),
            toRevisionId: rollbackId,
            runId,
        });
        console.log(`Rolled back issue ${revision[0].issue_id} to ${rollbackId} (run ${runId}).`);
        return;
    }

    if (resumeId) {
        const run = await getRun(executor, resumeId);
        if (!run) fail(`Run ${resumeId} not found.`);
        const action = await resumeRun(executor, resumeId);
        console.log(JSON.stringify(action, null, 2));
        return;
    }

    fail("One of --stage, --validate, --activate, --rollback-to, --resume is required.");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
