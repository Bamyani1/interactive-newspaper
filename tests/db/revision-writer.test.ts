/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import {
    AmbiguousIdentityMatchError,
    deriveIdentityKey,
    hydrateArticleFromRevision,
    type ContentRevisionRow,
} from "../../src/server/identity/content-identity";
import { ulid } from "../../src/server/identity/ulid";
import { transformArticles } from "../../src/server/ocr-adapter";
import {
    writeEditionRevision,
    type AssetManifestV2,
    type WriteEditionRevisionInput,
    type WriteEditionRevisionResult,
} from "../../src/server/publisher/revision-writer";
import type { OcrEdition, OcrImage } from "../../src/types";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const DATE = "1955-03-09";
const RUN_ID = "run-revision-writer-test";
const H1 = "a1".repeat(32);
const H2 = "b2".repeat(32);

const ARTICLE_BODIES = [
    "The Bishops outlasted Denison in an overtime thriller Tuesday night, winning 68-66 " +
        "before a packed Edwards Gymnasium crowd that roared through the final minute of play.\n\n" +
        "Coach Willett praised the squad for holding its nerve at the free-throw line, where " +
        "the Bishops sank nine of ten attempts in the extra period to seal the victory.",
    "The music department announced a four-concert spring series for Gray Chapel, beginning " +
        "with the Cleveland Symphonietta in April and closing with the university choir's " +
        "annual commencement performance in June. Season tickets go on sale at the union " +
        "desk Monday morning.",
    "Trustees cut the ribbon on the new library wing Monday morning, opening three floors of " +
        "stacks that add forty thousand volumes of shelf space to the university's " +
        "collection.\n\nLibrarian Helen Shaw called the addition the most significant campus " +
        "improvement since the war, and predicted record circulation this spring.",
];

const CAPTION_0 = "The Bishops celebrate their overtime win at Edwards Gymnasium";
const CAPTION_2 = "Students explore the new stacks in Slocum Hall";

function buildFixtureEdition(): OcrEdition {
    return {
        edition_date: DATE,
        publication_info: "Ohio Wesleyan Transcript, Volume 87, Number 21",
        articles: [
            {
                headline: "Bishops Defeat Denison In Overtime Thriller",
                author: "By Jack Morris",
                writer_position: "Sports Editor",
                body: ARTICLE_BODIES[0],
                images: [
                    // `credit` is an extension field the OCR contract may carry;
                    // the writer must preserve it onto asset_references.
                    { caption: CAPTION_0, position: "top", credit: "Transcript Photo" } as OcrImage,
                ],
                image_files: [`images/${H1}.webp`],
                source_pages: ["1"],
            },
            {
                headline: "Spring Concert Series Announced",
                body: ARTICLE_BODIES[1],
                images: [],
                image_files: [],
                source_pages: ["2", "3"],
            },
            {
                headline: "New Library Wing Opens",
                author: "By Ruth Adams",
                body: ARTICLE_BODIES[2],
                images: [{ caption: CAPTION_2, position: "" }],
                image_files: [`images/${H2}.webp`],
                source_pages: ["1"],
            },
        ],
        categories: ["Sports", "Campus News", "News"],
        ads: [
            {
                business_name: "The Brown Jug Restaurant",
                body:
                    "Try our famous coney islands and thick malted milks. " +
                    "Open until midnight every day of the week.",
                image_files: [],
            },
            {
                business_name: "Buns Bakery",
                body:
                    "Fresh doughnuts and pastries for your next house party. " +
                    "Call 2-1234 for special orders.",
                image_files: [],
            },
        ],
        other_content: [
            {
                title: "Campus Calendar",
                body:
                    "Friday: All-campus dance at Stuyvesant Hall, 9 p.m. " +
                    "Saturday: Swim meet against Wooster at Pfeiffer Natatorium.",
            },
            { title: "Blank Space", body: "   " },
        ],
    };
}

function buildAssetManifest(): AssetManifestV2 {
    return {
        schema_version: 2,
        date: DATE,
        assets: [
            {
                hash: H1,
                public_path: `images/${H1}.webp`,
                r2_key: `ocr-assets/${H1}.webp`,
                size_bytes: 48213,
                width: 1400,
                height: 900,
                quality: 80,
                status: "uploaded",
                mime_type: "image/webp",
                source_sha256: "c3".repeat(32),
            },
            {
                hash: H2,
                public_path: `images/${H2}.webp`,
                r2_key: `ocr-assets/${H2}.webp`,
                size_bytes: 51777,
                width: 1200,
                height: 1600,
                quality: 85,
                status: "existing",
            },
        ],
    };
}

function buildInput(): WriteEditionRevisionInput {
    return {
        editionDate: DATE,
        edition: buildFixtureEdition(),
        runId: RUN_ID,
        expectedPages: 6,
        pageStates: { 5: "failed" },
        assetManifest: buildAssetManifest(),
    };
}

/** Same recipe as scripts/db/seed.mjs stripHtml (the legacy body_plain basis). */
function stripHtml(html: string): string {
    return html.replace(/\0/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function asJson(value: unknown): unknown {
    return typeof value === "string" ? JSON.parse(value) : value;
}

/** Normalizes a text[] column that PGlite may return as an array or a literal. */
function asTextArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    return String(value)
        .replace(/^\{|\}$/g, "")
        .split(",")
        .map((entry) => entry.replace(/^"|"$/g, ""));
}

interface LegacyCounts {
    editions: number;
    articles: number;
    ads: number;
}

async function legacyCounts(pg: PGlite): Promise<LegacyCounts> {
    const { rows } = await pg.query<{ editions: number; articles: number; ads: number }>(
        `SELECT (SELECT count(*)::int FROM editions) AS editions,
                (SELECT count(*)::int FROM articles) AS articles,
                (SELECT count(*)::int FROM ads) AS ads`,
    );
    return rows[0];
}

async function newTableCounts(pg: PGlite): Promise<Record<string, number>> {
    const tables = [
        "issues",
        "legacy_edition_aliases",
        "edition_revisions",
        "edition_revision_pages",
        "content_items",
        "content_revisions",
        "legacy_content_aliases",
        "content_identity_conflicts",
        "assets",
        "asset_references",
    ];
    const counts: Record<string, number> = {};
    for (const table of tables) {
        const { rows } = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
        counts[table] = rows[0].n;
    }
    return counts;
}

async function seedLegacyRows(pg: PGlite): Promise<void> {
    await pg.query(
        `INSERT INTO editions (date, publication_info, page_count, article_count)
         VALUES ('1950-01-11', 'Ohio Wesleyan Transcript, Volume 82, Number 13', 4, 1)`,
    );
    await pg.query(
        `INSERT INTO articles (id, edition_date, position, category, headline, summary,
                               full_text, body_plain, byline, page)
         VALUES ('1950-01-11-0', '1950-01-11', 0, 'Sports', 'Legacy Headline',
                 'Legacy summary.', '<p>Legacy body.</p>', 'Legacy body.', 'Jack Morris', 1)`,
    );
    await pg.query(
        `INSERT INTO ads (edition_date, position, title, body)
         VALUES ('1950-01-11', 0, 'Legacy Ad', 'Legacy ad body.')`,
    );
}

describe("writeEditionRevision against PGlite", () => {
    let db: TestDb;
    let legacyBefore: LegacyCounts;
    let firstResult: WriteEditionRevisionResult;
    let firstArticleRevisionId: string;
    let firstArticleItemId: string;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
        await seedLegacyRows(db.pg);
        await db.pg.query(
            "INSERT INTO publication_runs (id, state) VALUES ($1, 'db_revision_staged')",
            [RUN_ID],
        );
        legacyBefore = await legacyCounts(db.pg);
        firstResult = await writeEditionRevision(db.executor, buildInput());
    }, 120_000);

    afterAll(async () => {
        await db.close();
    });

    it("stages the edition contract: pages, all three content types, captions and credits", async () => {
        expect(firstResult.created).toBe(true);
        expect(firstResult.counts).toEqual({
            items: 6,
            revisions: 6,
            aliases: 5,
            pages: 6,
            assets: 2,
            refs: 2,
        });

        // Issue + edition alias
        const { rows: aliasRows } = await db.pg.query<{ issue_id: string }>(
            "SELECT issue_id FROM legacy_edition_aliases WHERE date = $1",
            [DATE],
        );
        expect(aliasRows[0].issue_id).toBe(firstResult.issueId);

        // edition_revisions row
        const { rows: revRows } = await db.pg.query<Record<string, unknown>>(
            `SELECT issue_id, revision_hash, publication_info, expected_pages,
                    processed_pages, failed_pages, created_by_run
             FROM edition_revisions WHERE id = $1`,
            [firstResult.editionRevisionId],
        );
        expect(revRows).toHaveLength(1);
        expect(revRows[0].issue_id).toBe(firstResult.issueId);
        expect(String(revRows[0].revision_hash)).toMatch(/^erev-sha256:[0-9a-f]{64}$/);
        expect(revRows[0].publication_info).toBe(
            "Ohio Wesleyan Transcript, Volume 87, Number 21",
        );
        expect(revRows[0].expected_pages).toBe(6);
        expect(revRows[0].processed_pages).toBe(3);
        expect(asJson(revRows[0].failed_pages)).toEqual([5]);
        expect(revRows[0].created_by_run).toBe(RUN_ID);

        // edition_revision_pages: covered pages processed, page 5 failed, rest missing
        const { rows: pageRows } = await db.pg.query<{ page_number: number; status: string }>(
            `SELECT page_number, status FROM edition_revision_pages
             WHERE edition_revision_id = $1 ORDER BY page_number`,
            [firstResult.editionRevisionId],
        );
        expect(pageRows).toEqual([
            { page_number: 1, status: "processed" },
            { page_number: 2, status: "processed" },
            { page_number: 3, status: "processed" },
            { page_number: 4, status: "missing" },
            { page_number: 5, status: "failed" },
            { page_number: 6, status: "missing" },
        ]);

        // All three content types, with revisions for each
        const { rows: typeRows } = await db.pg.query<{ content_type: string; n: number }>(
            `SELECT ci.content_type, count(cr.id)::int AS n
             FROM content_items ci
             JOIN content_revisions cr ON cr.content_item_id = ci.id
             WHERE ci.issue_id = $1
             GROUP BY ci.content_type ORDER BY ci.content_type`,
            [firstResult.issueId],
        );
        expect(typeRows).toEqual([
            { content_type: "ad", n: 2 },
            { content_type: "article", n: 3 },
            { content_type: "other", n: 1 },
        ]);

        // Ads and substantive other_content are stored (empty one skipped)
        const { rows: adRevisions } = await db.pg.query<{ headline: string; body_plain: string }>(
            `SELECT cr.headline, cr.body_plain
             FROM content_revisions cr
             JOIN content_items ci ON ci.id = cr.content_item_id
             WHERE ci.issue_id = $1 AND ci.content_type = 'ad'
             ORDER BY cr.headline`,
            [firstResult.issueId],
        );
        expect(adRevisions.map((row) => row.headline)).toEqual([
            "Buns Bakery",
            "The Brown Jug Restaurant",
        ]);
        const { rows: otherRevisions } = await db.pg.query<{ headline: string }>(
            `SELECT cr.headline
             FROM content_revisions cr
             JOIN content_items ci ON ci.id = cr.content_item_id
             WHERE ci.issue_id = $1 AND ci.content_type = 'other'`,
            [firstResult.issueId],
        );
        expect(otherRevisions).toEqual([{ headline: "Campus Calendar" }]);

        // Assets: manifest metadata + legacy_key preserved
        const { rows: assetRows } = await db.pg.query<Record<string, unknown>>(
            "SELECT sha256, byte_count, width, height, mime_type, source_sha256, storage_key, legacy_key FROM assets ORDER BY sha256",
        );
        expect(assetRows).toHaveLength(2);
        expect(assetRows[0].sha256).toBe(H1);
        expect(Number(assetRows[0].byte_count)).toBe(48213);
        expect(assetRows[0].width).toBe(1400);
        expect(assetRows[0].height).toBe(900);
        expect(assetRows[0].mime_type).toBe("image/webp");
        expect(assetRows[0].source_sha256).toBe("c3".repeat(32));
        expect(assetRows[0].storage_key).toBe(`ocr-assets/${H1}.webp`);
        expect(assetRows[0].legacy_key).toBe(`${DATE}/images/${H1}.webp`);
        expect(assetRows[1].sha256).toBe(H2);
        expect(assetRows[1].mime_type).toBe("image/webp");
        expect(assetRows[1].source_sha256).toBeNull();

        // Asset references carry captions and credits from the OCR article
        const { rows: aliasArticle0 } = await db.pg.query<{
            content_item_id: string;
            content_revision_id: string;
        }>(
            "SELECT content_item_id, content_revision_id FROM legacy_content_aliases WHERE legacy_id = $1",
            [`${DATE}-0`],
        );
        firstArticleItemId = aliasArticle0[0].content_item_id;
        firstArticleRevisionId = aliasArticle0[0].content_revision_id;

        const { rows: refs0 } = await db.pg.query<Record<string, unknown>>(
            `SELECT position, asset_id, role, printed_caption, credit
             FROM asset_references WHERE content_revision_id = $1`,
            [firstArticleRevisionId],
        );
        expect(refs0).toEqual([
            {
                position: 0,
                asset_id: H1,
                role: "article_image",
                printed_caption: CAPTION_0,
                credit: "Transcript Photo",
            },
        ]);

        const { rows: aliasArticle2 } = await db.pg.query<{ content_revision_id: string }>(
            "SELECT content_revision_id FROM legacy_content_aliases WHERE legacy_id = $1",
            [`${DATE}-2`],
        );
        const { rows: refs2 } = await db.pg.query<Record<string, unknown>>(
            `SELECT position, asset_id, role, printed_caption, credit
             FROM asset_references WHERE content_revision_id = $1`,
            [aliasArticle2[0].content_revision_id],
        );
        expect(refs2).toEqual([
            {
                position: 0,
                asset_id: H2,
                role: "article_image",
                printed_caption: CAPTION_2,
                credit: null,
            },
        ]);
    });

    it("golden legacy comparison: hydrated revisions equal the adapter projection", async () => {
        const adapterArticles = transformArticles(buildFixtureEdition());
        expect(adapterArticles).toHaveLength(3);

        for (const article of adapterArticles) {
            const { rows: aliasRows } = await db.pg.query<{
                legacy_id: string;
                content_revision_id: string;
            }>(
                "SELECT legacy_id, content_revision_id FROM legacy_content_aliases WHERE legacy_id = $1",
                [article.id],
            );
            expect(aliasRows).toHaveLength(1);

            const { rows: revisionRows } = await db.pg.query<ContentRevisionRow>(
                `SELECT category, headline, summary, full_text, body_plain,
                        byline, writer_position, page
                 FROM content_revisions WHERE id = $1`,
                [aliasRows[0].content_revision_id],
            );
            expect(revisionRows).toHaveLength(1);

            const hydrated = hydrateArticleFromRevision(revisionRows[0], aliasRows[0]);
            expect(hydrated).toEqual({
                id: article.id,
                category: article.category,
                headline: article.headline,
                summary: article.summary,
                full_text: article.fullText,
                body_plain: stripHtml(article.fullText),
                byline: article.byline ?? null,
                writer_position: article.writerPosition ?? null,
                page: article.page,
            });
        }
    });

    it("is expand-only: legacy editions/articles/ads are untouched", async () => {
        expect(await legacyCounts(db.pg)).toEqual(legacyBefore);
    });

    it("is idempotent: an identical re-stage returns created:false and writes nothing", async () => {
        const before = await newTableCounts(db.pg);
        const second = await writeEditionRevision(db.executor, buildInput());
        expect(second.created).toBe(false);
        expect(second.issueId).toBe(firstResult.issueId);
        expect(second.editionRevisionId).toBe(firstResult.editionRevisionId);
        expect(second.counts).toEqual({
            items: 0,
            revisions: 0,
            aliases: 0,
            pages: 0,
            assets: 0,
            refs: 0,
        });
        expect(await newTableCounts(db.pg)).toEqual(before);
    });

    it("a changed body keeps the item, adds a revision, and moves the active pointer", async () => {
        const input = buildInput();
        input.edition.articles[0].body +=
            "\n\nA late scoring surge by the reserve squad stretched the margin in the closing seconds.";

        const third = await writeEditionRevision(db.executor, input);
        expect(third.created).toBe(true);
        expect(third.issueId).toBe(firstResult.issueId);
        expect(third.editionRevisionId).not.toBe(firstResult.editionRevisionId);
        expect(third.counts).toEqual({
            items: 0,
            revisions: 1,
            aliases: 0,
            pages: 6,
            assets: 0,
            refs: 1,
        });

        // Identity stable: the alias still points at the same content item,
        // but its revision pointer moved to the new revision.
        const { rows: aliasRows } = await db.pg.query<{
            content_item_id: string;
            content_revision_id: string;
        }>(
            "SELECT content_item_id, content_revision_id FROM legacy_content_aliases WHERE legacy_id = $1",
            [`${DATE}-0`],
        );
        expect(aliasRows[0].content_item_id).toBe(firstArticleItemId);
        expect(aliasRows[0].content_revision_id).not.toBe(firstArticleRevisionId);

        const { rows: revisionRows } = await db.pg.query<{
            id: string;
            edition_revision_id: string;
        }>(
            `SELECT id, edition_revision_id FROM content_revisions
             WHERE content_item_id = $1 ORDER BY edition_revision_id`,
            [firstArticleItemId],
        );
        expect(revisionRows).toHaveLength(2);
        expect(revisionRows.map((row) => row.id)).toContain(firstArticleRevisionId);
        expect(revisionRows.map((row) => row.id)).toContain(aliasRows[0].content_revision_id);

        const { rows: itemRows } = await db.pg.query<{ active_revision_id: string }>(
            "SELECT active_revision_id FROM content_items WHERE id = $1",
            [firstArticleItemId],
        );
        expect(itemRows[0].active_revision_id).toBe(aliasRows[0].content_revision_id);

        // The superseded revision is still present and immutable.
        await expect(
            db.pg.query("UPDATE content_revisions SET headline = 'tampered' WHERE id = $1", [
                firstArticleRevisionId,
            ]),
        ).rejects.toThrow(/immutable/);

        // Still expand-only after a re-stage.
        expect(await legacyCounts(db.pg)).toEqual(legacyBefore);
    });

    it("mints positional ad aliases with alias_kind 'ad'", async () => {
        const { rows } = await db.pg.query<{
            legacy_id: string;
            alias_kind: string;
            content_type: string;
            headline: string;
        }>(
            `SELECT a.legacy_id, a.alias_kind, ci.content_type, cr.headline
             FROM legacy_content_aliases a
             JOIN content_items ci ON ci.id = a.content_item_id
             JOIN content_revisions cr ON cr.id = a.content_revision_id
             WHERE a.alias_kind = 'ad'
             ORDER BY a.legacy_id`,
        );
        expect(rows).toEqual([
            {
                legacy_id: `ad:${DATE}:0`,
                alias_kind: "ad",
                content_type: "ad",
                headline: "The Brown Jug Restaurant",
            },
            {
                legacy_id: `ad:${DATE}:1`,
                alias_kind: "ad",
                content_type: "ad",
                headline: "Buns Bakery",
            },
        ]);
    });
});

describe("writeEditionRevision ambiguity handling", () => {
    const AMBIGUOUS_DATE = "1957-05-01";
    let db: TestDb;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
    }, 120_000);

    afterAll(async () => {
        await db.close();
    });

    it("records the conflict, throws, and writes no content rows", async () => {
        const issueId = ulid();
        await db.pg.query("INSERT INTO issues (id, canonical_date) VALUES ($1, $2)", [
            issueId,
            AMBIGUOUS_DATE,
        ]);
        await db.pg.query("INSERT INTO legacy_edition_aliases (date, issue_id) VALUES ($1, $2)", [
            AMBIGUOUS_DATE,
            issueId,
        ]);

        // UNIQUE (issue_id, identity_key) forbids this state going forward; drop
        // it to simulate a corpus where duplicate identities already exist
        // (e.g. hand-repaired rows) so the matcher can observe ambiguity.
        const { rows: constraints } = await db.pg.query<{ conname: string }>(
            `SELECT conname FROM pg_constraint
             WHERE conrelid = 'content_items'::regclass AND contype = 'u'`,
        );
        for (const { conname } of constraints) {
            await db.pg.query(`ALTER TABLE content_items DROP CONSTRAINT "${conname}"`);
        }

        const identityKey = deriveIdentityKey({
            contentType: "article",
            sourcePages: [1],
            headline: "Duplicate Headline Story",
            byline: "Jane Doe",
        });
        const itemA = ulid();
        const itemB = ulid();
        for (const itemId of [itemA, itemB]) {
            await db.pg.query(
                `INSERT INTO content_items (id, issue_id, content_type, identity_key)
                 VALUES ($1, $2, 'article', $3)`,
                [itemId, issueId, identityKey],
            );
        }

        const before = await newTableCounts(db.pg);
        const edition: OcrEdition = {
            edition_date: AMBIGUOUS_DATE,
            publication_info: "",
            articles: [
                {
                    headline: "Duplicate Headline Story",
                    author: "By Jane Doe",
                    body:
                        "Two campus organizations announced a joint charity drive Monday, " +
                        "promising to canvass every residence hall before the end of the month " +
                        "in support of the county hospital fund. Organizers expect to raise " +
                        "over one thousand dollars.",
                    images: [],
                    image_files: [],
                    source_pages: ["1"],
                },
            ],
            ads: [],
            other_content: [],
        };

        const attempt = writeEditionRevision(db.executor, {
            editionDate: AMBIGUOUS_DATE,
            edition,
        });
        await expect(attempt).rejects.toBeInstanceOf(AmbiguousIdentityMatchError);

        // Conflict row exists with both candidate items.
        const { rows: conflictRows } = await db.pg.query<Record<string, unknown>>(
            `SELECT issue_id, candidate_evidence, candidate_item_ids, status
             FROM content_identity_conflicts`,
        );
        expect(conflictRows).toHaveLength(1);
        expect(conflictRows[0].issue_id).toBe(issueId);
        expect(conflictRows[0].status).toBe("open");
        expect(asTextArray(conflictRows[0].candidate_item_ids).sort()).toEqual(
            [itemA, itemB].sort(),
        );
        const evidence = asJson(conflictRows[0].candidate_evidence) as Record<string, unknown>;
        expect(evidence.identityKey).toBe(identityKey);
        expect(evidence.headline).toBe("Duplicate Headline Story");

        // Atomicity: no content rows were written.
        const after = await newTableCounts(db.pg);
        expect(after).toEqual({ ...before, content_identity_conflicts: 1 });
    });
});
