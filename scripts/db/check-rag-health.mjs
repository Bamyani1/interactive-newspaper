/**
 * Read-only health check for what RAG retrieval ACTUALLY serves.
 *
 * The failure this exists to catch is silent: a serving filter that matches no
 * rows. Retrieval's vector leg then returns zero rows without erroring, the
 * pipeline degrades to full-text, and nothing in the logs distinguishes that
 * from a question the archive genuinely cannot answer.
 *
 * Every reported field is either configuration (what this deployment intends
 * to serve) or a database fact (what is actually there). The two are never
 * mixed: `config.*` and `build.row.*.expected` come from rag-model-config /
 * rag-index-config, while `served.*` and `coverage.*` come from the served
 * table itself. `served.predicate.count` is the load-bearing number — zero
 * there IS the defect, whatever else looks healthy.
 *
 * `build.row` re-checks every predicate of db.ts's
 * assertConfiguredIndexBuildReady individually, so a failure names the one
 * that broke instead of one opaque "failed readiness validation" string.
 *
 * Writes nothing. Exported functions take an injectable executor so tests
 * drive them against PGlite; main() wires the real Neon executor.
 *
 * Usage (tsx required):
 *   DATABASE_URL=... npx tsx scripts/db/check-rag-health.mjs
 *   DATABASE_URL=... npx tsx scripts/db/check-rag-health.mjs --json
 *
 * Exit: 0 healthy, 1 mismatch, 2 usage/connection error.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The table retrieval reads and the literal WHERE clause it applies, mirroring
 * db.ts's queryRagV2ByEmbedding (versioned/shadow) and
 * queryLegacyArticlesByEmbedding (legacy). Kept in one place so the check can
 * report the filter verbatim rather than paraphrasing it.
 */
export function servingPlan(config) {
    if (config.mode === "legacy") {
        return {
            table: "articles",
            buildScoped: false,
            where: "embedding IS NOT NULL AND embedding_model = $1",
            params: [config.embeddingModel],
        };
    }
    return {
        table: "article_chunks",
        buildScoped: true,
        where:
            "embedding IS NOT NULL AND index_build_id = $1 AND embedding_model = $2 " +
            "AND embedding_input_version = $3",
        params: [
            config.activeIndexBuildId,
            config.embeddingModel,
            config.textEmbeddingInputVersion,
        ],
    };
}

function predicate(name, expected, actual) {
    return { name, ok: String(actual) === String(expected), expected, actual };
}

/**
 * Every predicate of assertConfiguredIndexBuildReady, evaluated one at a time.
 * Legacy mode has no build row by construction, so it reports applicable:false
 * rather than a fabricated pass.
 */
export async function checkBuildRow(executor, config) {
    if (config.mode === "legacy") {
        return {
            applicable: false,
            reason: "legacy retrieval serves the unversioned articles index",
        };
    }
    if (!config.activeIndexBuildId) {
        return {
            applicable: true,
            exists: false,
            failures: ["RAG_ACTIVE_INDEX_BUILD_ID is not set"],
        };
    }

    const rows = await executor.query({
        text: `SELECT id, corpus_version, status, pipeline_version, embedding_model,
                      text_embedding_input_version, image_embedding_input_version,
                      (SELECT COUNT(*)::int FROM rag_index_builds active
                       WHERE active.corpus_version = build.corpus_version
                         AND active.status = 'active') AS active_count
                 FROM rag_index_builds build
                WHERE id = $1`,
        params: [config.activeIndexBuildId],
    });
    const build = rows[0];
    if (!build) {
        return {
            applicable: true,
            exists: false,
            failures: [`index build ${config.activeIndexBuildId} does not exist`],
        };
    }

    // Mirrors db.ts: 'versioned' serves only an active build; 'shadow' may also
    // measure a merely validated one.
    const allowedStatuses =
        config.mode === "versioned" ? ["active"] : ["validated", "active"];
    const checks = [
        predicate("corpus_version", config.corpusVersion, build.corpus_version),
        predicate("pipeline_version", config.pipelineVersion, build.pipeline_version),
        predicate("embedding_model", config.embeddingModel, build.embedding_model),
        predicate(
            "text_embedding_input_version",
            config.textEmbeddingInputVersion,
            build.text_embedding_input_version,
        ),
        predicate(
            "image_embedding_input_version",
            config.imageEmbeddingInputVersion,
            build.image_embedding_input_version,
        ),
        {
            name: "status",
            ok: allowedStatuses.includes(String(build.status)),
            expected: allowedStatuses.join(" | "),
            actual: build.status,
        },
    ];
    // active_count is a 'versioned'-only predicate in db.ts; reporting it as a
    // pass under 'shadow' would claim a check that never ran.
    if (config.mode === "versioned") {
        checks.push(predicate("active_count", 1, Number(build.active_count)));
    }

    return {
        applicable: true,
        exists: true,
        row: Object.fromEntries(
            checks.map((check) => [
                check.name,
                { ok: check.ok, expected: check.expected, actual: check.actual },
            ]),
        ),
        failures: checks
            .filter((check) => !check.ok)
            .map(
                (check) =>
                    `build.row.${check.name}: configured ${JSON.stringify(check.expected)}, ` +
                    `database has ${JSON.stringify(check.actual)}`,
            ),
    };
}

/** Distinct (embedding_model, embedding_input_version) pairs actually present. */
export async function readServedStamps(executor, plan) {
    const rows = await executor.query({
        text: `SELECT embedding_model, embedding_input_version, COUNT(*)::int AS rows
                 FROM ${plan.table}
                WHERE embedding IS NOT NULL
                GROUP BY embedding_model, embedding_input_version
                ORDER BY embedding_model, embedding_input_version`,
        params: [],
    });
    return rows.map((row) => ({
        embeddingModel: row.embedding_model,
        embeddingInputVersion: row.embedding_input_version,
        rows: Number(row.rows),
    }));
}

/** The serving WHERE clause, run verbatim as a COUNT. Zero is the defect. */
export async function countServedPredicate(executor, plan) {
    const rows = await executor.query({
        text: `SELECT COUNT(*)::int AS count FROM ${plan.table} WHERE ${plan.where}`,
        params: plan.params,
    });
    return Number(rows[0].count);
}

export async function readCoverage(executor, plan, config) {
    const scoped = plan.buildScoped;
    const rows = await executor.query({
        text: `SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS embedded
                 FROM ${plan.table}
                ${scoped ? "WHERE index_build_id = $1" : ""}`,
        params: scoped ? [config.activeIndexBuildId] : [],
    });
    const total = Number(rows[0].total);
    const embedded = Number(rows[0].embedded);
    return { total, embedded, ratio: total === 0 ? null : embedded / total };
}

/**
 * Full report. `deps.assertMigrationsCurrent` stays injectable because the real
 * one reads a ledger that only exists on a migrated database.
 */
export async function checkRagHealth(executor, deps) {
    const { config } = deps;
    const plan = servingPlan(config);
    const failures = [];

    let migrations = { current: true };
    try {
        await deps.assertMigrationsCurrent(executor);
    } catch (error) {
        migrations = {
            current: false,
            error: error instanceof Error ? error.message : String(error),
        };
        failures.push(`migrations.current: ${migrations.error}`);
    }

    const build = await checkBuildRow(executor, config);
    failures.push(...(build.failures ?? []));

    const stamps = await readServedStamps(executor, plan);
    const predicateCount = await countServedPredicate(executor, plan);
    const coverage = await readCoverage(executor, plan, config);

    if (predicateCount === 0) {
        failures.push(
            `served.predicate matched 0 rows in ${plan.table}: the serving filter reaches ` +
                `nothing, so retrieval's vector leg returns zero rows without erroring`,
        );
    }
    const configuredStamp = stamps.find(
        (stamp) =>
            stamp.embeddingModel === config.embeddingModel &&
            stamp.embeddingInputVersion === config.textEmbeddingInputVersion,
    );
    if (!configuredStamp) {
        failures.push(
            `served.stamps: ${plan.table} holds no rows stamped ` +
                `(${config.embeddingModel}, ${config.textEmbeddingInputVersion}); present: ` +
                (stamps.length === 0
                    ? "none"
                    : stamps
                          .map((s) => `(${s.embeddingModel}, ${s.embeddingInputVersion})`)
                          .join(", ")),
        );
    }

    return {
        healthy: failures.length === 0,
        config: {
            mode: config.mode,
            activeIndexBuildId: config.activeIndexBuildId,
            corpusVersion: config.corpusVersion,
            pipelineVersion: config.pipelineVersion,
            embeddingModel: config.embeddingModel,
            textEmbeddingInputVersion: config.textEmbeddingInputVersion,
            imageEmbeddingInputVersion: config.imageEmbeddingInputVersion,
        },
        migrations,
        build,
        served: {
            table: plan.table,
            stamps,
            predicate: {
                where: plan.where,
                params: plan.params,
                count: predicateCount,
            },
        },
        coverage,
        failures,
    };
}

export function formatReport(report) {
    const mark = (ok) => (ok ? "ok  " : "FAIL");
    const lines = [
        `config.mode                 ${report.config.mode}`,
        `config.indexBuildId         ${report.config.activeIndexBuildId ?? "(none)"}`,
        `${mark(report.migrations.current)} migrations.current`,
    ];

    if (!report.build.applicable) {
        lines.push(`     build.row               n/a — ${report.build.reason}`);
    } else if (!report.build.exists) {
        lines.push("FAIL build.row               missing");
    } else {
        for (const [name, check] of Object.entries(report.build.row)) {
            lines.push(
                `${mark(check.ok)} build.row.${name.padEnd(30)}` +
                    `configured=${JSON.stringify(check.expected)} database=${JSON.stringify(check.actual)}`,
            );
        }
    }

    lines.push(`     served.table            ${report.served.table}`);
    lines.push(
        report.served.stamps.length === 0
            ? "     served.stamps           (none)"
            : `     served.stamps           ${report.served.stamps
                  .map(
                      (s) =>
                          `(${s.embeddingModel}, ${s.embeddingInputVersion}) x${s.rows}`,
                  )
                  .join(", ")}`,
    );
    lines.push(
        `${mark(report.served.predicate.count > 0)} served.predicate        ` +
            `${report.served.predicate.count} row(s) match WHERE ${report.served.predicate.where}`,
    );
    lines.push(
        `     coverage.ratio          ${
            report.coverage.ratio === null
                ? "n/a (0 rows)"
                : `${report.coverage.ratio.toFixed(4)} (${report.coverage.embedded}/${report.coverage.total})`
        }`,
    );

    if (report.failures.length > 0) {
        lines.push("", "Mismatches:");
        for (const failure of report.failures) lines.push(`  - ${failure}`);
    }
    return lines.join("\n");
}

async function main() {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
        console.error("ERROR: DATABASE_URL is required.");
        process.exit(2);
    }

    let executor;
    let config;
    let assertMigrationsCurrent;
    try {
        const executorModule = await import("./lib/neon-executor.ts");
        const runnerModule = await import("./lib/migration-runner.ts");
        const indexConfigModule = await import("../../src/lib/rag-index-config.ts");
        const { createNeonExecutor } = executorModule.default ?? executorModule;
        ({ assertMigrationsCurrent } = runnerModule.default ?? runnerModule);
        const { getRagRetrievalConfig } =
            indexConfigModule.default ?? indexConfigModule;
        // Throws on an invalid RAG_RETRIEVAL_MODE or a candidate mode with no
        // build id — a configuration error, not a health mismatch.
        config = getRagRetrievalConfig();
        executor = createNeonExecutor(databaseUrl);
    } catch (error) {
        console.error(
            `ERROR: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(2);
    }

    let report;
    try {
        report = await checkRagHealth(executor, { config, assertMigrationsCurrent });
    } catch (error) {
        console.error(
            `ERROR: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(2);
    }

    console.log(
        process.argv.includes("--json")
            ? JSON.stringify(report, null, 2)
            : formatReport(report),
    );
    process.exit(report.healthy ? 0 : 1);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(2);
    });
}
