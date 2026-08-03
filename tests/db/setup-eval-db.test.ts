/** @vitest-environment node */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import {
    PRIVATE_TABLES,
    PUBLIC_EXPORT_ALLOWLIST,
    exportPublicCorpus,
} from "../../scripts/rag/export-public-corpus";
import {
    assertNotProductionUrl,
    introspectSchemaViaExecutor,
    setupEvalDb,
} from "../../scripts/rag/setup-eval-db.mjs";
import schemaSnapshot from "../../scripts/db/schema-snapshot.json";
import { MIGRATIONS_DIR, createTestDb, introspectSchema, type TestDb } from "./helpers/pglite";

const EMBEDDING = `[${Array.from({ length: 768 }, (_, i) => (i % 5 === 0 ? "0.5" : "0")).join(",")}]`;

/** SYNTHETIC frozen-corpus metadata matching the seeded fixture (2/2/1). */
const SYNTHETIC_CORPUS = {
    schemaVersion: 2,
    generatedAt: "2026-08-02T00:00:00.000Z",
    retrievalMode: "legacy",
    corpusVersion: "test-corpus-0001",
    corpusSha256: "0".repeat(64),
    counts: { editions: 2, articles: 2, ads: 1, images: 0 },
};

async function seedSourceFixtures(db: TestDb): Promise<void> {
    await db.executor.query({
        text: `INSERT INTO editions (date, publication_info, page_count, article_count)
               VALUES ('1955-03-09', 'Vol. 1 No. 1', 4, 2), ('1955-03-10', 'Vol. 1 No. 2', 2, 0)`,
    });
    await db.executor.query({
        text: `INSERT INTO articles
                   (id, edition_date, position, category, headline, summary, full_text,
                    body_plain, byline, page, is_hero, image_urls, image_captions, embedding,
                    embedding_model, embedding_input_hash, embedding_input_version)
               VALUES
                   ('art-1', '1955-03-09', 1, 'News', 'Canal Reopens', 'The canal reopens.',
                    'The canal reopens after repairs.', 'The canal reopens after repairs.',
                    'A. Reporter', 1, TRUE, '[]', '[]', $1, 'gemini-embedding-2', 'hash-1',
                    'article-chunk-v1'),
                   ('art-2', '1955-03-09', 2, 'Sports', 'Nine Wins Opener', 'The nine wins.',
                    'The town nine wins its opener.', 'The town nine wins its opener.',
                    NULL, 2, FALSE, '[]', '[]', NULL, NULL, NULL, NULL)`,
        params: [EMBEDDING],
    });
    await db.executor.query({
        text: `INSERT INTO ads (edition_date, position, title, body, category, phone, image_urls)
               VALUES ('1955-03-09', 1, 'Hardware Sale', 'Nails half price.', 'Retail', '555-0100', '[]')`,
    });
    await db.executor.query({
        text: `INSERT INTO weather (date, scope, tmax_c, tmin_c, precip_mm, source, is_estimated)
               VALUES ('1955-03-09', 'delaware', 12.5, 2.5, 0.5, 'noaa', FALSE)`,
    });
    await db.executor.query({
        text: `INSERT INTO music (year, month, rank, title, artist, youtube_id)
               VALUES (1955, '03', 1, 'Sincerely', 'The McGuire Sisters', 'yt-abc123')`,
    });
    // Private-table rows: they must never reach the evaluation database.
    await db.executor.query({
        text: `INSERT INTO ask_session_turns (session_id, question, answer)
               VALUES ('SECRET-SESSION-1', 'Who asked about the canal?', 'It reopened in 1955.')`,
    });
    await db.executor.query({
        text: `INSERT INTO ask_feedback (request_id, question, answer, vote)
               VALUES ('req-1', 'Was the canal answer wrong?', 'The canal answer.', 'down')`,
    });
    await db.executor.query({
        text: `INSERT INTO api_rate_bucket (key, count, expires_at)
               VALUES ('PRIVATE-RATE-KEY', 3, '2026-08-02T00:00:00Z')`,
    });
    await db.executor.query({
        text: "INSERT INTO ai_spend_counter (day, spent_usd) VALUES ('2026-08-02', 1.23)",
    });
}

function writeCorpusJson(dir: string, corpus: Record<string, unknown>, name: string): string {
    const corpusPath = path.join(dir, name);
    writeFileSync(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
    return corpusPath;
}

async function countRows(db: TestDb, table: string): Promise<number> {
    const rows = await db.executor.query({ text: `SELECT count(*)::int AS n FROM ${table}` });
    return Number(rows[0].n);
}

describe("setup-eval-db (PGlite)", () => {
    let exportDir: string;
    let corpusJsonPath: string;

    beforeAll(async () => {
        const source = await createTestDb();
        try {
            await runMigrations(source.executor, { dir: MIGRATIONS_DIR });
            await seedSourceFixtures(source);
            exportDir = mkdtempSync(path.join(tmpdir(), "eval-corpus-export-"));
            await exportPublicCorpus(source.executor, { outDir: exportDir });
        } finally {
            await source.close();
        }
        corpusJsonPath = writeCorpusJson(exportDir, SYNTHETIC_CORPUS, "frozen-corpus.json");
    });

    it("happy path: bootstraps a fresh eval DB with verified schema, counts, and identities", async () => {
        const evalDb = await createTestDb();
        try {
            const result = await setupEvalDb(evalDb.executor, {
                exportDir,
                introspect: () => introspectSchema(evalDb.pg),
                corpusJsonPath,
            });

            expect(result).toEqual({
                schemaVerified: true,
                imported: { editions: 2, articles: 2, ads: 1, weather: 1, music: 1 },
                identity: { issues: 2, items: 2, revisions: 2, aliases: 2, skipped: 0 },
                corpusVersion: "test-corpus-0001",
            });

            // Allowlisted tables hold exactly the imported rows.
            for (const table of PUBLIC_EXPORT_ALLOWLIST) {
                expect(await countRows(evalDb, table), table).toBe(result.imported[table]);
            }
            // Private tables are EMPTY in the evaluation database.
            for (const { name } of PRIVATE_TABLES.filter((t) => t.name !== "schema_migrations")) {
                expect(await countRows(evalDb, name), name).toBe(0);
            }
            // Identity backfill really ran: aliases exist for editions and articles.
            expect(await countRows(evalDb, "legacy_edition_aliases")).toBe(2);
            expect(await countRows(evalDb, "legacy_content_aliases")).toBe(2);
            // Corpus version registered.
            const corpusRows = await evalDb.executor.query({
                text: `SELECT id, edition_count, article_count, ad_count, image_count
                       FROM corpus_versions`,
            });
            expect(corpusRows).toEqual([
                {
                    id: "test-corpus-0001",
                    edition_count: 2,
                    article_count: 2,
                    ad_count: 1,
                    image_count: 0,
                },
            ]);
            // The executor-based introspection agrees with the committed snapshot too.
            expect(await introspectSchemaViaExecutor(evalDb.executor)).toEqual(schemaSnapshot);
        } finally {
            await evalDb.close();
        }
    });

    it("throws on a count mismatch, listing frozen-corpus and database counts", async () => {
        const doctoredPath = writeCorpusJson(
            mkdtempSync(path.join(tmpdir(), "eval-corpus-doctored-")),
            { ...SYNTHETIC_CORPUS, counts: { ...SYNTHETIC_CORPUS.counts, editions: 5 } },
            "frozen-corpus.json",
        );
        const evalDb = await createTestDb();
        try {
            await expect(
                setupEvalDb(evalDb.executor, {
                    exportDir,
                    introspect: () => introspectSchema(evalDb.pg),
                    corpusJsonPath: doctoredPath,
                }),
            ).rejects.toThrow(
                /editions: frozen corpus declares 5, evaluation database has 2/,
            );
        } finally {
            await evalDb.close();
        }
    });

    it("throws on schema divergence, naming the differing schema object", async () => {
        const droppedIndex = Object.keys(schemaSnapshot.indexes)[0];
        expect(droppedIndex).toBeTruthy();

        const evalDb = await createTestDb();
        try {
            await expect(
                setupEvalDb(evalDb.executor, {
                    exportDir,
                    introspect: async () => {
                        const snapshot = await introspectSchema(evalDb.pg);
                        const indexes = { ...snapshot.indexes };
                        delete indexes[droppedIndex];
                        return { ...snapshot, indexes };
                    },
                    corpusJsonPath,
                }),
            ).rejects.toThrow(
                `indexes.${droppedIndex}: present in snapshot, missing from live schema`,
            );
            // Nothing was imported: the schema gate fires before any data write.
            expect(await countRows(evalDb, "editions")).toBe(0);
        } finally {
            await evalDb.close();
        }
    });

    describe("assertNotProductionUrl", () => {
        const PROD = "postgres://app:pw@db.prod.example.com/newspaper";

        it("throws when eval URL shares host AND database with the production URL", () => {
            expect(() =>
                assertNotProductionUrl(
                    "postgres://other:pw2@db.prod.example.com/newspaper",
                    PROD,
                    { env: {} },
                ),
            ).toThrow(/same host AND database as DATABASE_URL/);
        });

        it("throws when eval URL is the identical string", () => {
            expect(() => assertNotProductionUrl(PROD, PROD, { env: {} })).toThrow(
                /identical to DATABASE_URL/,
            );
        });

        it("passes when the database name differs and contains 'eval'", () => {
            expect(
                assertNotProductionUrl(
                    "postgres://app:pw@db.prod.example.com/newspaper_eval",
                    PROD,
                    { env: {} },
                ),
            ).toEqual({ host: "db.prod.example.com", database: "newspaper_eval" });
        });

        it("throws on a non-eval name without the flag, passes with it", () => {
            const nonEval = "postgres://app:pw@db.other.example.com/newspaper_copy";
            expect(() => assertNotProductionUrl(nonEval, PROD, { env: {} })).toThrow(
                /--allow-nonstandard-name/,
            );
            expect(
                assertNotProductionUrl(nonEval, PROD, { env: {}, allowNonstandardName: true }),
            ).toEqual({ host: "db.other.example.com", database: "newspaper_copy" });
        });

        it("throws when the eval URL is unset or empty", () => {
            expect(() => assertNotProductionUrl(undefined, PROD, { env: {} })).toThrow(
                /EVAL_DATABASE_URL is required/,
            );
            expect(() => assertNotProductionUrl("", PROD, { env: {} })).toThrow(
                /EVAL_DATABASE_URL is required/,
            );
        });

        it("throws when prod URL is unset but eval URL equals a DATABASE_URL in env", () => {
            const url = "postgres://app:pw@db.eval.example.com/newspaper_eval";
            expect(() =>
                assertNotProductionUrl(url, undefined, { env: { DATABASE_URL: url } }),
            ).toThrow(/equals DATABASE_URL in the environment/);
            // The same URL passes once no env variable claims it.
            expect(() => assertNotProductionUrl(url, undefined, { env: {} })).not.toThrow();
        });

        it("throws on unparseable or non-postgres URLs", () => {
            expect(() => assertNotProductionUrl("not a url", PROD, { env: {} })).toThrow(
                /not a valid postgres URL/,
            );
            expect(() =>
                assertNotProductionUrl("https://db.eval.example.com/evaldb", PROD, { env: {} }),
            ).toThrow(/expected postgres/);
        });
    });
});
