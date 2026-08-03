/** @vitest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { EmbedContentResponse } from "@google/genai";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import {
    activateBuild,
    createIndexBuild,
    dryRunReport,
    embedBuildImages,
    embedBuildText,
    finalizeBuild,
    populateBuildRecords,
    rollbackActivation,
} from "../../scripts/db/build-rag-index.mjs";
import { buildArticleChunkRecords } from "../../src/lib/article-chunking";
import { buildEmbeddingInput } from "../../src/lib/embeddings";
import { computeEmbeddingCostUsd } from "../../src/lib/cost-tracker";
import {
    RAG_EMBEDDING_MODEL,
    RAG_IMAGE_EMBEDDING_INPUT_VERSION,
    RAG_PIPELINE_VERSION,
    RAG_TEXT_EMBEDDING_INPUT_VERSION,
} from "../../src/lib/rag-model-config";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const EMBED_MJS_PATH = path.resolve(testDir, "../../scripts/db/embed.mjs");

const DATE = "1954-05-05";
const CORPUS = "corpus-test-v1";
const A1 = `${DATE}-0`; // long body -> multiple chunks, 2 images, aliased
const A2 = `${DATE}-1`; // long body -> multiple chunks, no images, aliased
const A3 = `${DATE}-2`; // short body -> 1 chunk, NO alias
const HEX64 = "ab".repeat(32);
const GOOD_IMAGE_URL = `https://cdn.example.org/${DATE}/images/${HEX64}.webp`;
const MISSING_IMAGE_URL = `https://archive.example.org/${DATE}/images/court-scene.webp`;
const CREV1 = "crev-fixture-a1";
const CREV2 = "crev-fixture-a2";

const BUILD_OPTIONS = {
    corpusVersion: CORPUS,
    pipelineVersion: RAG_PIPELINE_VERSION,
    embeddingModel: RAG_EMBEDDING_MODEL,
    textInputVersion: RAG_TEXT_EMBEDDING_INPUT_VERSION,
    imageInputVersion: RAG_IMAGE_EMBEDDING_INPUT_VERSION,
} as const;

function longBody(seed: string, sentences: number): string {
    const parts: string[] = [];
    for (let index = 0; index < sentences; index += 1) {
        parts.push(
            `${seed} dispatch number ${index} recounts the week of campus happenings in ` +
                "careful and deliberate detail for the archive.",
        );
    }
    return parts.join(" ");
}

interface FixtureArticle {
    id: string;
    headline: string;
    byline: string | null;
    body_plain: string;
    edition_date: string;
    category: string;
    summary: string | null;
    image_urls: string[];
    image_caption: string | null;
    image_captions: (string | null)[];
}

const FIXTURE_ARTICLES: FixtureArticle[] = [
    {
        id: A1,
        headline: "Moot Court Marathon Fills Gray Chapel",
        byline: "By Jack Morris",
        body_plain: longBody("The moot court", 80),
        edition_date: DATE,
        category: "News",
        summary: "Law society stages an all-day mock trial marathon.",
        image_urls: [GOOD_IMAGE_URL, MISSING_IMAGE_URL],
        image_caption: "The moot court panel hears opening arguments",
        image_captions: ["The moot court panel hears opening arguments", null],
    },
    {
        id: A2,
        headline: "Glee Club Plans Spring Tour",
        byline: null,
        body_plain: longBody("The glee club", 60),
        edition_date: DATE,
        category: "Campus",
        summary: "Six Ohio cities are on the spring itinerary.",
        image_urls: [],
        image_caption: null,
        image_captions: [],
    },
    {
        id: A3,
        headline: "Weather Delays Baseball Opener",
        byline: "By Ruth Adams",
        body_plain: "Rain postponed the baseball opener until Thursday afternoon.",
        edition_date: DATE,
        category: "Sports",
        summary: null,
        image_urls: [],
        image_caption: null,
        image_captions: [],
    },
];

function expectedChunkRecords() {
    return FIXTURE_ARTICLES.map((article) => ({
        article,
        records: buildArticleChunkRecords({
            id: article.id,
            headline: article.headline,
            byline: article.byline,
            body_plain: article.body_plain,
            edition_date: article.edition_date,
            category: article.category,
            summary: article.summary,
        }),
    }));
}

const TOTAL_CHUNKS = expectedChunkRecords().reduce((sum, e) => sum + e.records.length, 0);

function deterministicVector(text: string): number[] {
    let acc = 7;
    for (let index = 0; index < text.length; index += 1) {
        acc = (acc * 31 + text.charCodeAt(index)) % 997;
    }
    return Array.from({ length: 768 }, (_, i) => ((acc + i) % 100) / 100);
}

interface FakeEmbedFn {
    (inputs: Array<{ text: string }>): Promise<number[][]>;
    calls: number;
}

function makeEmbedFn(): FakeEmbedFn {
    const fn = (async (inputs: Array<{ text: string }>) => {
        fn.calls += 1;
        return inputs.map((input) => deterministicVector(input.text));
    }) as FakeEmbedFn;
    fn.calls = 0;
    return fn;
}

function fakeWebpBuffer(): Buffer {
    const payload = Buffer.alloc(24, 7);
    const buffer = Buffer.alloc(12 + payload.length);
    buffer.write("RIFF", 0, "ascii");
    buffer.writeUInt32LE(4 + payload.length, 4);
    buffer.write("WEBP", 8, "ascii");
    payload.copy(buffer, 12);
    return buffer;
}

/** Serves the object as a two-part async iterable to exercise streaming. */
function streamOf(buffer: Buffer): AsyncIterable<Buffer> {
    return (async function* () {
        yield buffer.subarray(0, 10);
        yield buffer.subarray(10);
    })();
}

function syntheticResponse(tokenCount: number): EmbedContentResponse {
    return { embeddings: [{ statistics: { tokenCount } }] } as EmbedContentResponse;
}

async function insertFixture(pg: PGlite): Promise<void> {
    await pg.query(
        `INSERT INTO editions (date, publication_info, page_count, article_count)
         VALUES ($1, 'Ohio Wesleyan Transcript, Volume 86, Number 27', 4, 3)`,
        [DATE],
    );
    for (const [position, article] of FIXTURE_ARTICLES.entries()) {
        await pg.query(
            `INSERT INTO articles
                 (id, edition_date, position, category, headline, summary, full_text,
                  body_plain, byline, page, image_urls, image_caption, image_captions)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                article.id,
                article.edition_date,
                position,
                article.category,
                article.headline,
                article.summary ?? "",
                `<p>${article.body_plain}</p>`,
                article.body_plain,
                article.byline,
                1,
                JSON.stringify(article.image_urls),
                article.image_caption,
                JSON.stringify(article.image_captions),
            ],
        );
    }

    // backfill-identities-style alias setup, inserted directly: A1 and A2 get
    // legacy_content_aliases rows pointing at content revisions; A3 does not.
    await pg.query(`INSERT INTO issues (id, canonical_date) VALUES ('issue-fixture-1', $1)`, [
        DATE,
    ]);
    for (const [item, revision, legacyId] of [
        ["item-fixture-a1", CREV1, A1],
        ["item-fixture-a2", CREV2, A2],
    ] as const) {
        await pg.query(
            `INSERT INTO content_items (id, issue_id, content_type, identity_key)
             VALUES ($1, 'issue-fixture-1', 'article', $2)`,
            [item, `key-${item}`],
        );
        await pg.query(
            `INSERT INTO content_revisions (id, content_item_id, revision_hash)
             VALUES ($1, $2, $3)`,
            [revision, item, `hash-${item}`],
        );
        await pg.query(
            `INSERT INTO legacy_content_aliases
                 (legacy_id, content_item_id, content_revision_id, alias_kind)
             VALUES ($1, $2, $3, 'article')`,
            [legacyId, item, revision],
        );
    }
}

describe("build-rag-index against PGlite", () => {
    let db: TestDb;
    let buildA: string;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
        await insertFixture(db.pg);
    }, 120_000);

    afterAll(async () => {
        await db.close();
    });

    it("creates a 'building' build with a build- prefixed ULID id", async () => {
        buildA = await createIndexBuild(db.executor, BUILD_OPTIONS);
        expect(buildA).toMatch(/^build-[0-9A-HJKMNP-TV-Z]{26}$/);
        const { rows } = await db.pg.query<{ status: string; corpus_version: string }>(
            "SELECT status, corpus_version FROM rag_index_builds WHERE id = $1",
            [buildA],
        );
        expect(rows[0]).toEqual({ status: "building", corpus_version: CORPUS });
    });

    it("populates build-scoped records with alias-derived content_revision_id", async () => {
        const counts = await populateBuildRecords(db.executor, buildA);
        expect(counts).toEqual({ articles: 3, chunks: TOTAL_CHUNKS, images: 2 });
        expect(TOTAL_CHUNKS).toBeGreaterThanOrEqual(4); // A1 and A2 chunk multiply

        const { rows: chunks } = await db.pg.query<{
            id: string;
            article_id: string;
            content_revision_id: string | null;
            embedding_input_hash: string;
        }>(
            `SELECT id, article_id, content_revision_id, embedding_input_hash
             FROM article_chunks WHERE index_build_id = $1 ORDER BY id`,
            [buildA],
        );
        expect(chunks).toHaveLength(TOTAL_CHUNKS);
        for (const chunk of chunks) {
            expect(chunk.id.startsWith(`${buildA}:`)).toBe(true);
            expect(chunk.embedding_input_hash).toMatch(/^[a-f0-9]{64}$/);
            const expectedRevision =
                chunk.article_id === A1 ? CREV1 : chunk.article_id === A2 ? CREV2 : null;
            expect(chunk.content_revision_id).toBe(expectedRevision);
        }
        const a1Records = expectedChunkRecords()[0].records;
        expect(a1Records.length).toBeGreaterThan(1);
        expect(chunks.map((c) => c.id).slice(0, a1Records.length)).toEqual(
            a1Records.map((record) => `${buildA}:${record.id}`),
        );

        const { rows: images } = await db.pg.query<{
            id: string;
            caption: string | null;
            content_revision_id: string | null;
            embedding_input_hash: string | null;
        }>(
            `SELECT id, caption, content_revision_id, embedding_input_hash
             FROM article_images WHERE index_build_id = $1 ORDER BY id`,
            [buildA],
        );
        expect(images.map((image) => image.id)).toEqual([
            `${buildA}:${A1}:image:000`,
            `${buildA}:${A1}:image:001`,
        ]);
        expect(images[0].caption).toBe("The moot court panel hears opening arguments");
        expect(images[1].caption).toBeNull();
        // The image input hash needs the object BYTES; it stays NULL until embed.
        expect(images.map((image) => image.embedding_input_hash)).toEqual([null, null]);
        expect(images.map((image) => image.content_revision_id)).toEqual([CREV1, CREV1]);

        // Resumable: a second populate converges without duplicating rows.
        const again = await populateBuildRecords(db.executor, buildA);
        expect(again).toEqual(counts);
        const { rows: recount } = await db.pg.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM article_chunks WHERE index_build_id = $1",
            [buildA],
        );
        expect(recount[0].n).toBe(TOTAL_CHUNKS);
    });

    it("embeds every text chunk with cost-tracker pricing", async () => {
        const embedFn = makeEmbedFn();
        const result = await embedBuildText(db.executor, buildA, { embedFn });
        expect(result.planned).toBe(TOTAL_CHUNKS);
        expect(result.embedded).toBe(TOTAL_CHUNKS);
        expect(result.skipped).toBe(0);
        expect(result.failed).toEqual([]);
        expect(result.textTokens).toBeGreaterThan(0);
        expect(result.costUsd).toBeCloseTo(
            computeEmbeddingCostUsd(RAG_EMBEDDING_MODEL, syntheticResponse(result.textTokens)),
            12,
        );
        expect(embedFn.calls).toBe(Math.ceil(TOTAL_CHUNKS / 50));

        const { rows } = await db.pg.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM article_chunks
             WHERE index_build_id = $1 AND embedding IS NOT NULL
               AND embedding_model = $2 AND embedding_input_version = $3`,
            [buildA, RAG_EMBEDDING_MODEL, RAG_TEXT_EMBEDDING_INPUT_VERSION],
        );
        expect(rows[0].n).toBe(TOTAL_CHUNKS);
    });

    it("exact-hash resumability: a second text pass never calls the model", async () => {
        const embedFn = makeEmbedFn();
        const result = await embedBuildText(db.executor, buildA, { embedFn });
        expect(result.planned).toBe(0);
        expect(result.embedded).toBe(0);
        expect(result.skipped).toBe(TOTAL_CHUNKS);
        expect(result.failed).toEqual([]);
        expect(embedFn.calls).toBe(0);
    });

    it("streams images one at a time and isolates per-item failures", async () => {
        const fetchedKeys: string[] = [];
        const goodKey = `ocr-assets/${HEX64}.webp`;
        const fetchObject = async (key: string) => {
            fetchedKeys.push(key);
            if (key === goodKey) return streamOf(fakeWebpBuffer());
            throw new Error(`NoSuchKey: ${key}`);
        };
        const embedFn = makeEmbedFn();
        const result = await embedBuildImages(db.executor, buildA, { embedFn, fetchObject });

        expect(result.images).toBe(2);
        expect(result.planned).toBe(2);
        expect(result.embedded).toBe(1);
        expect(result.skipped).toBe(0);
        expect(result.failed).toEqual([
            {
                id: `${buildA}:${A1}:image:001`,
                reason: `NoSuchKey: ${DATE}/images/court-scene.webp`,
            },
        ]);
        expect(fetchedKeys).toEqual([goodKey, `${DATE}/images/court-scene.webp`]);

        // Expected cost from the exact multimodal input the script builds.
        const caption = "The moot court panel hears opening arguments";
        const imageInput = buildEmbeddingInput({
            headline: FIXTURE_ARTICLES[0].headline,
            byline: FIXTURE_ARTICLES[0].byline,
            body_plain: `Image caption: ${caption}`,
            edition_date: DATE,
            category: FIXTURE_ARTICLES[0].category,
            summary: FIXTURE_ARTICLES[0].summary,
            image_caption: caption,
        });
        const imageTokens = Math.ceil(imageInput.text.length / 4);
        expect(result.costUsd).toBeCloseTo(
            computeEmbeddingCostUsd(RAG_EMBEDDING_MODEL, syntheticResponse(imageTokens), {
                imageCount: 1,
            }),
            12,
        );

        const { rows } = await db.pg.query<{
            id: string;
            has_embedding: boolean;
            embedding_input_hash: string | null;
        }>(
            `SELECT id, (embedding IS NOT NULL) AS has_embedding, embedding_input_hash
             FROM article_images WHERE index_build_id = $1 ORDER BY id`,
            [buildA],
        );
        expect(rows[0].has_embedding).toBe(true);
        expect(rows[0].embedding_input_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(rows[1].has_embedding).toBe(false);
        expect(rows[1].embedding_input_hash).toBeNull();

        // Second pass: the embedded image is skipped without refetching; only
        // the still-missing object is retried (and fails again, loop intact).
        fetchedKeys.length = 0;
        const second = await embedBuildImages(db.executor, buildA, { embedFn, fetchObject });
        expect(second.skipped).toBe(1);
        expect(second.planned).toBe(1);
        expect(second.embedded).toBe(0);
        expect(second.failed).toHaveLength(1);
        expect(fetchedKeys).toEqual([`${DATE}/images/court-scene.webp`]);
    });

    it("finalizes to 'validated' when text coverage is complete, despite image failures", async () => {
        const result = await finalizeBuild(db.executor, buildA);
        expect(result.status).toBe("validated");
        expect(result.pendingChunks).toBe(0);
        expect(result.pendingImages).toBe(1); // the missing R2 object — does not fail the build

        const { rows } = await db.pg.query<{
            status: string;
            validated_at: string | null;
            failure_reason: string | null;
        }>("SELECT status, validated_at, failure_reason FROM rag_index_builds WHERE id = $1", [
            buildA,
        ]);
        expect(rows[0].status).toBe("validated");
        expect(rows[0].validated_at).not.toBeNull();
        expect(rows[0].failure_reason).toBeNull();
    });

    it("no-force invariant: finalized builds are immutable; a rebuild is a NEW id", async () => {
        await expect(finalizeBuild(db.executor, buildA)).rejects.toThrow(/immutable/);
        await expect(
            embedBuildText(db.executor, buildA, { embedFn: makeEmbedFn() }),
        ).rejects.toThrow(/immutable/);
        await expect(populateBuildRecords(db.executor, buildA)).rejects.toThrow(/immutable/);

        const rebuild = await createIndexBuild(db.executor, BUILD_OPTIONS);
        expect(rebuild).not.toBe(buildA);
        expect(rebuild).toMatch(/^build-/);
    });

    it("activates a validated build, enforces single-active, and rolls back", async () => {
        await expect(activateBuild(db.executor, "build-missing")).rejects.toThrow(/Unknown/);

        const activated = await activateBuild(db.executor, buildA);
        expect(activated.status).toBe("active");
        const { rows } = await db.pg.query<{ status: string; activated_at: string | null }>(
            "SELECT status, activated_at FROM rag_index_builds WHERE id = $1",
            [buildA],
        );
        expect(rows[0].status).toBe("active");
        expect(rows[0].activated_at).not.toBeNull();

        // A second validated build of the same corpus cannot activate on top.
        const rival = await createIndexBuild(db.executor, BUILD_OPTIONS);
        await populateBuildRecords(db.executor, rival);
        await embedBuildText(db.executor, rival, { embedFn: makeEmbedFn() });
        await finalizeBuild(db.executor, rival);
        await expect(activateBuild(db.executor, rival)).rejects.toThrow(/already has active build/);

        // Rollback demotes to validated; the rival can then take over.
        const demoted = await rollbackActivation(db.executor, buildA);
        expect(demoted.status).toBe("validated");
        const swapped = await activateBuild(db.executor, rival);
        expect(swapped.status).toBe("active");

        // 'building' builds can never activate; only 'active' rolls back.
        const fresh = await createIndexBuild(db.executor, BUILD_OPTIONS);
        await expect(activateBuild(db.executor, fresh)).rejects.toThrow(/only 'validated'/);
        await expect(rollbackActivation(db.executor, buildA)).rejects.toThrow(/only 'active'/);

        // Leave no active build behind so later tests see the same world as before.
        await rollbackActivation(db.executor, rival);
    });

    it("per-batch text failure isolation, and finalize reports pending coverage", async () => {
        const buildC = await createIndexBuild(db.executor, BUILD_OPTIONS);
        await populateBuildRecords(db.executor, buildC);

        let calls = 0;
        const flaky = async (inputs: Array<{ text: string }>) => {
            calls += 1;
            if (calls === 1) throw new Error("simulated batch outage");
            return inputs.map((input) => deterministicVector(input.text));
        };
        const result = await embedBuildText(db.executor, buildC, {
            embedFn: flaky,
            batchSize: 2,
        });
        expect(result.planned).toBe(TOTAL_CHUNKS);
        expect(result.failed).toHaveLength(2);
        for (const failure of result.failed) {
            expect(failure.reason).toBe("simulated batch outage");
        }
        expect(result.embedded).toBe(TOTAL_CHUNKS - 2); // later batches still ran

        const finalized = await finalizeBuild(db.executor, buildC);
        expect(finalized.status).toBe("failed");
        expect(finalized.pendingChunks).toBe(2);
        expect(finalized.failureReason).toContain("2 text chunk(s)");
        expect(finalized.failureReason).toContain("2 image(s)");
        const { rows } = await db.pg.query<{ status: string; failure_reason: string }>(
            "SELECT status, failure_reason FROM rag_index_builds WHERE id = $1",
            [buildC],
        );
        expect(rows[0].status).toBe("failed");
        expect(rows[0].failure_reason).toContain("2 text chunk(s)");
    });

    it("keeps concurrent builds disjoint; embedding one never touches the other", async () => {
        const buildD = await createIndexBuild(db.executor, BUILD_OPTIONS);
        const buildE = await createIndexBuild(db.executor, BUILD_OPTIONS);
        await populateBuildRecords(db.executor, buildD);
        await populateBuildRecords(db.executor, buildE); // uq_article_chunks_build satisfied

        const { rows: counts } = await db.pg.query<{ d: number; e: number; overlap: number }>(
            `SELECT (SELECT count(*)::int FROM article_chunks WHERE index_build_id = $1) AS d,
                    (SELECT count(*)::int FROM article_chunks WHERE index_build_id = $2) AS e,
                    (SELECT count(*)::int FROM article_chunks c1
                     JOIN article_chunks c2 ON c1.id = c2.id
                     WHERE c1.index_build_id = $1 AND c2.index_build_id = $2) AS overlap`,
            [buildD, buildE],
        );
        expect(counts[0]).toEqual({ d: TOTAL_CHUNKS, e: TOTAL_CHUNKS, overlap: 0 });

        await embedBuildText(db.executor, buildD, { embedFn: makeEmbedFn() });
        const { rows } = await db.pg.query<{ d_pending: number; e_pending: number }>(
            `SELECT (SELECT count(*)::int FROM article_chunks
                     WHERE index_build_id = $1 AND embedding IS NULL) AS d_pending,
                    (SELECT count(*)::int FROM article_chunks
                     WHERE index_build_id = $2 AND embedding IS NULL) AS e_pending`,
            [buildD, buildE],
        );
        expect(rows[0].d_pending).toBe(0);
        expect(rows[0].e_pending).toBe(TOTAL_CHUNKS); // untouched
    });

    it("never modifies legacy NULL-build rows, and the embed.mjs fence holds", async () => {
        await db.pg.query(
            `INSERT INTO article_chunks
                 (id, article_id, chunk_index, chunk_text, embedding_input_hash,
                  embedding_model, embedding_input_version)
             VALUES ($1, $2, 0, 'legacy chunk text', 'legacy-hash', 'legacy-model', 'legacy-v0')`,
            [`${A3}:0000`, A3],
        );

        const buildF = await createIndexBuild(db.executor, BUILD_OPTIONS);
        await populateBuildRecords(db.executor, buildF);
        await embedBuildText(db.executor, buildF, { embedFn: makeEmbedFn() });

        const { rows: legacy } = await db.pg.query<{
            chunk_text: string;
            embedding_model: string;
            embedding_input_hash: string;
            has_embedding: boolean;
        }>(
            `SELECT chunk_text, embedding_model, embedding_input_hash,
                    (embedding IS NOT NULL) AS has_embedding
             FROM article_chunks WHERE id = $1 AND index_build_id IS NULL`,
            [`${A3}:0000`],
        );
        expect(legacy).toHaveLength(1);
        expect(legacy[0]).toEqual({
            chunk_text: "legacy chunk text",
            embedding_model: "legacy-model",
            embedding_input_hash: "legacy-hash",
            has_embedding: false,
        });

        // An embed.mjs-shaped UPDATE (fenced with index_build_id IS NULL) can
        // never reach a build-scoped row.
        const buildRowId = `${buildF}:${A3}:0000`;
        const touched = await db.pg.query(
            `UPDATE article_chunks SET embedding_model = 'embed-mjs-touch'
             WHERE id = $1 AND index_build_id IS NULL`,
            [buildRowId],
        );
        expect(touched.affectedRows ?? 0).toBe(0);
        const { rows: buildRow } = await db.pg.query<{ embedding_model: string }>(
            "SELECT embedding_model FROM article_chunks WHERE id = $1",
            [buildRowId],
        );
        expect(buildRow[0].embedding_model).toBe(RAG_EMBEDDING_MODEL);

        // Static fence on the script itself: legacy-only guard present, every
        // chunk/image statement carries the NULL-build predicate, no --force.
        const source = readFileSync(EMBED_MJS_PATH, "utf8");
        expect(source).toContain("--legacy-unversioned");
        expect(source).not.toContain("--force");
        expect(source).not.toContain("isForce");
        const fenced = source.match(/index_build_id IS NULL/g) ?? [];
        expect(fenced.length).toBeGreaterThanOrEqual(4); // 2 SELECTs + 2 UPDATEs
    });

    it("dryRunReport prices the exact chunk plan with cost-tracker constants", async () => {
        const before = await db.pg.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM article_chunks",
        );
        const report = await dryRunReport(db.executor, { corpusVersion: CORPUS });
        const after = await db.pg.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM article_chunks",
        );
        expect(after.rows[0].n).toBe(before.rows[0].n); // read-only

        const expectedChars = expectedChunkRecords().reduce(
            (sum, entry) =>
                sum +
                entry.records.reduce((inner, record) => inner + record.embeddingInput.text.length, 0),
            0,
        );
        expect(report.corpusVersion).toBe(CORPUS);
        expect(report.articles).toBe(3);
        expect(report.chunks).toBe(TOTAL_CHUNKS);
        expect(report.chunkChars).toBe(expectedChars);
        expect(report.estTextTokens).toBe(Math.ceil(expectedChars / 4));
        expect(report.images).toBe(2);

        // Pinned to the tracker's own pricing (imported, not re-stated).
        expect(report.estTextUsd).toBeCloseTo(
            computeEmbeddingCostUsd(RAG_EMBEDDING_MODEL, syntheticResponse(report.estTextTokens)),
            12,
        );
        expect(report.estTextUsd).toBeCloseTo(((expectedChars / 4) / 1_000_000) * 0.2, 6);
        expect(report.estImageUsd).toBeCloseTo(
            computeEmbeddingCostUsd(RAG_EMBEDDING_MODEL, {} as EmbedContentResponse, {
                imageCount: report.images,
            }),
            12,
        );
        expect(report.estImageUsd).toBeCloseTo(report.images * 0.00012, 12);
        expect(report.totalUsd).toBeCloseTo(report.estTextUsd + report.estImageUsd, 12);
    });
});
