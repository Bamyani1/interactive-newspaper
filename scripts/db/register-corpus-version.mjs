#!/usr/bin/env node
/**
 * Registers the frozen legacy corpus snapshot in corpus_versions. DATA-ONLY
 * and idempotent (ON CONFLICT (id) DO NOTHING); the row is never written by
 * migrations (see 0009_revision_keys_and_corpus.sql).
 *
 * Reads evaluation/rag/corpus/legacy-8b8207373510d69e.json and copies only
 * parsed metadata: corpusVersion (the id), corpusSha256 (manifest_hash), and
 * counts. image_count comes from counts.images — the article_images evidence
 * rows, 0 in the frozen legacy corpus, whose images live inline on articles.
 *
 * Executor-injectable: tests drive registerCorpusVersion(executor) against
 * PGlite. main() runs only when this file is the CLI entry, requires
 * DATABASE_URL plus an explicit --yes, and is authorized for local/test
 * databases only in this phase.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_FILE = path.resolve(
    scriptDir,
    "../../evaluation/rag/corpus/legacy-8b8207373510d69e.json",
);

export async function registerCorpusVersion(executor, corpusPath = CORPUS_FILE) {
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
    const id = String(corpus.corpusVersion ?? "");
    if (!id) {
        throw new Error(`corpusVersion missing in ${corpusPath}`);
    }
    const counts = corpus.counts ?? {};
    const description =
        `Frozen legacy corpus snapshot (retrievalMode=${corpus.retrievalMode ?? "legacy"}), ` +
        `generated at ${corpus.generatedAt ?? "unknown"}`;

    const inserted = await executor.query({
        text: `INSERT INTO corpus_versions
                   (id, manifest_hash, edition_count, article_count, ad_count, image_count, description)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (id) DO NOTHING RETURNING id`,
        params: [
            id,
            corpus.corpusSha256 ?? null,
            counts.editions ?? null,
            counts.articles ?? null,
            counts.ads ?? null,
            counts.images ?? null,
            description,
        ],
    });
    return { id, inserted: inserted.length > 0 };
}

async function main() {
    console.warn(
        "NOTE: production runs are gated by the Phase 8 rollout runbook " +
            "(docs/architecture/rag-phase8-rollout-runbook.md); this insert is idempotent.",
    );
    if (!process.env.DATABASE_URL) {
        console.error("ERROR: DATABASE_URL is required.");
        process.exit(1);
    }
    if (!process.argv.slice(2).includes("--yes")) {
        console.error("Refusing to run without an explicit --yes flag.");
        process.exit(1);
    }

    // This package compiles .ts to CJS (no "type":"module"), so .ts modules
    // must be loaded dynamically and unwrapped via `mod.default ?? mod`.
    const neonMod = await import("./lib/neon-executor.ts");
    const { createNeonExecutor } = neonMod.default ?? neonMod;
    const runnerMod = await import("./lib/migration-runner.ts");
    const { assertMigrationsCurrent } = runnerMod.default ?? runnerMod;

    const executor = createNeonExecutor(process.env.DATABASE_URL);
    await assertMigrationsCurrent(executor);
    const result = await registerCorpusVersion(executor);
    console.log(JSON.stringify(result));
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
