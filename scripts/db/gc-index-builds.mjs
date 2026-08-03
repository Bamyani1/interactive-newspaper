/**
 * Gated garbage collection for superseded RAG index builds (Phase 9).
 *
 * Deletes the chunk/image rows and build row of ONE non-active build at a
 * time. Refuses unless promotion is proven: some OTHER build of the same
 * corpus must currently be 'active'. Legacy rows (index_build_id IS NULL)
 * are structurally out of reach — every DELETE is keyed on the build id.
 *
 * Read-only by default (--list). Destruction requires BOTH --prune <id>
 * AND --yes, and never touches an 'active' build.
 *
 * Usage (tsx required):
 *   DATABASE_URL=... npx tsx scripts/db/gc-index-builds.mjs --list
 *   DATABASE_URL=... npx tsx scripts/db/gc-index-builds.mjs --prune <buildId> --yes
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function listBuilds(executor) {
    return executor.query({
        text: `SELECT b.id, b.corpus_version, b.status, b.created_at, b.activated_at,
                      (SELECT COUNT(*)::int FROM article_chunks c WHERE c.index_build_id = b.id) AS chunk_rows,
                      (SELECT COUNT(*)::int FROM article_images i WHERE i.index_build_id = b.id) AS image_rows
               FROM rag_index_builds b
               ORDER BY b.created_at`,
        params: [],
    });
}

export async function pruneBuild(executor, buildId) {
    const [build] = await executor.query({
        text: `SELECT id, corpus_version, status FROM rag_index_builds WHERE id = $1`,
        params: [buildId],
    });
    if (!build) throw new Error(`Unknown index build ${buildId}.`);
    if (build.status === "active") {
        throw new Error(
            `Refusing to prune ${buildId}: it is ACTIVE. Promote a replacement and ` +
                `--rollback-activation first if this build really must go.`,
        );
    }
    const active = await executor.query({
        text: `SELECT id FROM rag_index_builds
               WHERE corpus_version = $1 AND status = 'active' AND id <> $2`,
        params: [build.corpus_version, buildId],
    });
    if (active.length === 0) {
        throw new Error(
            `Refusing to prune ${buildId}: corpus ${build.corpus_version} has no OTHER active ` +
                `build. GC only runs after a promoted replacement is serving (Phase 9 gate).`,
        );
    }

    // Single-statement prune: the gate CTE re-checks BOTH conditions inside
    // the same snapshot as the deletes, so a concurrent --activate can never
    // interleave between the check and the destruction (the earlier SELECTs
    // above exist only for friendly error messages).
    const [result] = await executor.query({
        text: `WITH gate AS (
                   SELECT 1 FROM rag_index_builds b
                   WHERE b.id = $1 AND b.status <> 'active'
                     AND EXISTS (
                       SELECT 1 FROM rag_index_builds o
                       WHERE o.corpus_version = b.corpus_version
                         AND o.status = 'active' AND o.id <> b.id
                     )
               ), del_chunks AS (
                   DELETE FROM article_chunks
                   WHERE index_build_id = $1 AND EXISTS (SELECT 1 FROM gate)
                   RETURNING 1
               ), del_images AS (
                   DELETE FROM article_images
                   WHERE index_build_id = $1 AND EXISTS (SELECT 1 FROM gate)
                   RETURNING 1
               ), del_build AS (
                   DELETE FROM rag_index_builds
                   WHERE id = $1 AND status <> 'active' AND EXISTS (SELECT 1 FROM gate)
                   RETURNING 1
               )
               SELECT (SELECT COUNT(*)::int FROM del_chunks) AS chunks,
                      (SELECT COUNT(*)::int FROM del_images) AS images,
                      (SELECT COUNT(*)::int FROM del_build) AS build`,
        params: [buildId],
    });
    if (Number(result.build) === 0) {
        throw new Error(
            `Prune of ${buildId} aborted at execution time: the build's status or its corpus's ` +
                `active-build changed concurrently. Nothing was deleted; re-run --list and retry.`,
        );
    }
    return {
        buildId,
        deletedChunks: Number(result.chunks),
        deletedImages: Number(result.images),
        survivingActiveBuild: String(active[0].id),
    };
}

function argValue(flag) {
    const index = process.argv.indexOf(flag);
    if (index === -1 || index + 1 >= process.argv.length) return null;
    return process.argv[index + 1];
}

async function main() {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL is required.");
    const executorModule = await import("./lib/neon-executor");
    const runnerModule = await import("./lib/migration-runner");
    const { createNeonExecutor } = executorModule.default ?? executorModule;
    const { assertMigrationsCurrent } = runnerModule.default ?? runnerModule;
    const executor = createNeonExecutor(databaseUrl);

    const pruneId = argValue("--prune");
    if (pruneId) {
        if (!process.argv.includes("--yes")) {
            throw new Error("--prune permanently deletes rows. Re-run with --yes to confirm.");
        }
        await assertMigrationsCurrent(executor);
        console.log(JSON.stringify(await pruneBuild(executor, pruneId), null, 2));
        return;
    }
    console.log(JSON.stringify(await listBuilds(executor), null, 2));
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
