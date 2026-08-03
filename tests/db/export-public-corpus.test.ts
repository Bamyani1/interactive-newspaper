/** @vitest-environment node */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EXCLUDED_COLUMNS,
    PRIVATE_TABLES,
    PUBLIC_EXPORT_ALLOWLIST,
    exportPublicCorpus,
    exportTableRows,
    importPublicCorpus,
    manifestSelfSha256,
    type ExportPublicCorpusResult,
} from "../../scripts/rag/export-public-corpus";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const SESSION_TOKEN = "SECRET-SESSION-TOKEN-777";
const TURN_QUESTION = "PRIVATE-TURN-QUESTION who asked about the canal?";
const FEEDBACK_QUESTION = "PRIVATE-FEEDBACK-QUESTION was the canal answer wrong?";
const RATE_KEY = "PRIVATE-RATE-KEY-42";
const SENTINELS = [SESSION_TOKEN, TURN_QUESTION, FEEDBACK_QUESTION, RATE_KEY];

const EMBEDDING = `[${Array.from({ length: 768 }, (_, i) => (i % 7 === 0 ? "0.25" : "0")).join(",")}]`;

async function seedFixtures(db: TestDb): Promise<void> {
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
                    'A. Reporter', 1, TRUE, $1, $2, $3, 'gemini-embedding-2', 'hash-1', 'article-chunk-v1'),
                   ('art-2', '1955-03-09', 2, 'Sports', 'Nine Wins Opener', 'The nine wins.',
                    'The town nine wins its opener.', 'The town nine wins its opener.',
                    NULL, 2, FALSE, '[]', '[]', NULL, NULL, NULL, NULL)`,
        params: [
            JSON.stringify(["1955-03-09/images/photo_1.webp"]),
            JSON.stringify(["The canal at dawn"]),
            EMBEDDING,
        ],
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
    // Private rows whose sentinel strings must never reach an exported file.
    await db.executor.query({
        text: `INSERT INTO ask_session_turns (session_id, question, answer)
               VALUES ($1, $2, 'It reopened in March 1955.')`,
        params: [SESSION_TOKEN, TURN_QUESTION],
    });
    await db.executor.query({
        text: `INSERT INTO ask_feedback (request_id, question, answer, vote)
               VALUES ('req-1', $1, 'The canal answer.', 'down')`,
        params: [FEEDBACK_QUESTION],
    });
    await db.executor.query({
        text: `INSERT INTO api_rate_bucket (key, count, expires_at)
               VALUES ($1, 3, '2026-08-02T00:00:00Z')`,
        params: [RATE_KEY],
    });
    await db.executor.query({
        text: "INSERT INTO ai_spend_counter (day, spent_usd) VALUES ('2026-08-02', 1.23)",
    });
}

function sha256OfFile(filePath: string): string {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("export-public-corpus (PGlite)", () => {
    let db: TestDb;
    let exported: ExportPublicCorpusResult;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
        await seedFixtures(db);
        exported = await exportPublicCorpus(db.executor, {
            outDir: mkdtempSync(path.join(tmpdir(), "public-corpus-")),
        });
    });

    afterAll(async () => {
        await db.close();
    });

    it("manifest lists exactly the allowlisted tables with correct counts and hashes", () => {
        const { manifest, outDir } = exported;
        expect(manifest.tables.map((t) => t.name)).toEqual([...PUBLIC_EXPORT_ALLOWLIST]);
        expect(
            Object.fromEntries(manifest.tables.map((t) => [t.name, t.rowCount])),
        ).toEqual({ editions: 2, articles: 2, ads: 1, weather: 1, music: 1 });
        for (const table of manifest.tables) {
            expect(sha256OfFile(path.join(outDir, `${table.name}.jsonl`)), table.name).toBe(
                table.sha256,
            );
        }
        expect(manifest.selfSha256).toBe(manifestSelfSha256(manifest));

        // The proof artifact affirmatively lists every private table as excluded.
        const excludedNames = manifest.excludedTables.map((t) => t.name);
        for (const name of ["ask_session_turns", "ask_feedback", "api_rate_bucket", "ai_spend_counter"]) {
            expect(excludedNames).toContain(name);
        }
        expect(excludedNames).toEqual(PRIVATE_TABLES.map((t) => t.name));
        expect(manifest.excludedColumns).toEqual(
            EXCLUDED_COLUMNS.map((entry) => ({ ...entry })),
        );
        expect(manifest.schemaProvenance.migrations.length).toBeGreaterThan(0);

        // Nothing beyond the five JSONL files and the manifest is written.
        expect(readdirSync(outDir).sort()).toEqual(
            [...PUBLIC_EXPORT_ALLOWLIST.map((name) => `${name}.jsonl`), "manifest.json"].sort(),
        );
    });

    it("exports no private-row content and drops excluded columns", () => {
        for (const file of readdirSync(exported.outDir)) {
            const bytes = readFileSync(path.join(exported.outDir, file), "utf8");
            for (const sentinel of SENTINELS) {
                expect(bytes.includes(sentinel), `${sentinel} leaked into ${file}`).toBe(false);
            }
        }
        const articleLines = readFileSync(path.join(exported.outDir, "articles.jsonl"), "utf8")
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(articleLines).toHaveLength(2);
        for (const row of articleLines) {
            expect(row).not.toHaveProperty("search_vector");
        }
        expect(articleLines[0].embedding).toBe(EMBEDDING);
    });

    it("is deterministic: a second export yields identical hashes", async () => {
        const again = await exportPublicCorpus(db.executor, {
            outDir: mkdtempSync(path.join(tmpdir(), "public-corpus-again-")),
        });
        expect(again.manifest.selfSha256).toBe(exported.manifest.selfSha256);
        expect(again.manifest.tables).toEqual(exported.manifest.tables);
    });

    it("hard-fails when the table-export internal is asked for a private table", async () => {
        await expect(exportTableRows(db.executor, "ask_feedback")).rejects.toThrow(
            /not in PUBLIC_EXPORT_ALLOWLIST/,
        );
        await expect(exportTableRows(db.executor, "schema_migrations")).rejects.toThrow(
            /not in PUBLIC_EXPORT_ALLOWLIST/,
        );
    });

    it("round-trips into a fresh database, repopulating search_vector via trigger", async () => {
        const target = await createTestDb();
        try {
            await runMigrations(target.executor, { dir: MIGRATIONS_DIR });
            const inserted = await importPublicCorpus(target.executor, { dir: exported.outDir });
            expect(inserted).toEqual({ editions: 2, articles: 2, ads: 1, weather: 1, music: 1 });

            for (const table of PUBLIC_EXPORT_ALLOWLIST) {
                const rows = await target.executor.query({
                    text: `SELECT count(*)::int AS n FROM ${table}`,
                });
                expect(rows[0].n, table).toBe(inserted[table]);
            }
            for (const { name } of PRIVATE_TABLES.filter((t) => t.name !== "schema_migrations")) {
                const rows = await target.executor.query({
                    text: `SELECT count(*)::int AS n FROM ${name}`,
                });
                expect(rows[0].n, name).toBe(0);
            }

            const article = await target.executor.query({
                text: `SELECT search_vector IS NOT NULL AS has_search_vector,
                              embedding::text AS embedding
                       FROM articles WHERE id = 'art-1'`,
            });
            expect(article[0].has_search_vector).toBe(true);
            expect(article[0].embedding).toBe(EMBEDDING);

            // Re-importing is a no-op thanks to ON CONFLICT DO NOTHING.
            const again = await importPublicCorpus(target.executor, { dir: exported.outDir });
            expect(again).toEqual({ editions: 0, articles: 0, ads: 0, weather: 0, music: 0 });
        } finally {
            await target.close();
        }
    });

    it("refuses a tampered JSONL file before writing anything", async () => {
        const tamperedDir = mkdtempSync(path.join(tmpdir(), "public-corpus-tampered-"));
        await exportPublicCorpus(db.executor, { outDir: tamperedDir });
        const articlesPath = path.join(tamperedDir, "articles.jsonl");
        writeFileSync(
            articlesPath,
            readFileSync(articlesPath, "utf8").replace("Canal Reopens", "Canal Xeopens"),
            "utf8",
        );

        const target = await createTestDb();
        try {
            await runMigrations(target.executor, { dir: MIGRATIONS_DIR });
            await expect(importPublicCorpus(target.executor, { dir: tamperedDir })).rejects.toThrow(
                /articles: file hash mismatch/,
            );
            const editions = await target.executor.query({
                text: "SELECT count(*)::int AS n FROM editions",
            });
            expect(editions[0].n).toBe(0);
        } finally {
            await target.close();
        }
    });
});
