/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import { backfillIdentities } from "../../scripts/db/backfill-identities.mjs";
import { registerCorpusVersion } from "../../scripts/db/register-corpus-version.mjs";
import {
    AmbiguousIdentityMatchError,
    contentRevisionHash,
    deriveIdentityKey,
    hydrateArticleFromRevision,
    matchRevisionToItems,
    normalizeIdentityText,
    type ContentRevisionRow,
    type LegacyContentAliasRow,
    type RevisionPayload,
} from "../../src/server/identity/content-identity";
import { ULID_PATTERN, ulid } from "../../src/server/identity/ulid";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

interface FixtureArticle {
    id: string;
    edition_date: string;
    position: number;
    category: string;
    headline: string;
    summary: string;
    full_text: string;
    body_plain: string;
    byline: string | null;
    writer_position: string | null;
    page: number;
    is_hero: boolean;
    is_featured: boolean;
    image_urls: string[];
    image_captions: (string | null)[];
}

const FIXTURE_EDITIONS = [
    {
        date: "1950-01-11",
        publication_info: "Ohio Wesleyan Transcript, Volume 82, Number 13",
        page_count: 4,
        article_count: 2,
    },
    {
        date: "1950-02-15",
        publication_info: "Ohio Wesleyan Transcript, Volume 82, Number 18",
        page_count: 4,
        article_count: 1,
    },
];

const FIXTURE_ARTICLES: FixtureArticle[] = [
    {
        id: "1950-01-11-0",
        edition_date: "1950-01-11",
        position: 0,
        category: "Sports",
        headline: "Bishops Defeat Denison In Overtime Thriller",
        summary: "The basketball squad edged Denison 68-66 after a frantic final minute.",
        full_text:
            "<p>The Bishops outlasted Denison in an overtime thriller Tuesday night, " +
            "winning 68-66 before a packed Edwards Gymnasium crowd.</p>",
        body_plain:
            "The Bishops outlasted Denison in an overtime thriller Tuesday night, " +
            "winning 68-66 before a packed Edwards Gymnasium crowd.",
        byline: "By Jack Morris",
        writer_position: "Sports Editor",
        page: 1,
        is_hero: true,
        is_featured: true,
        image_urls: ["https://cdn.example.org/images/1950-01-11/basketball.jpg"],
        image_captions: ["The Bishops celebrate their overtime win"],
    },
    {
        id: "1950-01-11-1",
        edition_date: "1950-01-11",
        position: 1,
        category: "Campus",
        headline: "Spring Concert Series Announced",
        summary: "Four guest orchestras will visit Gray Chapel this spring.",
        full_text: "<p>The music department announced a four-concert spring series.</p>",
        body_plain: "The music department announced a four-concert spring series.",
        byline: null,
        writer_position: null,
        page: 2,
        is_hero: false,
        is_featured: false,
        image_urls: [],
        image_captions: [],
    },
    {
        id: "1950-02-15-0",
        edition_date: "1950-02-15",
        position: 0,
        category: "News",
        headline: "New Library Wing Opens",
        summary: "Slocum Hall's new wing adds 40,000 volumes of shelf space.",
        full_text: "<p>Trustees cut the ribbon on the new library wing Monday morning.</p>",
        body_plain: "Trustees cut the ribbon on the new library wing Monday morning.",
        byline: "By Ruth Adams",
        writer_position: null,
        page: 1,
        is_hero: false,
        is_featured: true,
        image_urls: [
            "https://cdn.example.org/images/1950-02-15/library-a.jpg",
            "https://cdn.example.org/images/1950-02-15/library-b.jpg",
        ],
        image_captions: [null, "Students explore the new stacks"],
    },
];

async function insertFixture(pg: PGlite): Promise<void> {
    for (const edition of FIXTURE_EDITIONS) {
        await pg.query(
            `INSERT INTO editions (date, publication_info, page_count, article_count)
             VALUES ($1, $2, $3, $4)`,
            [edition.date, edition.publication_info, edition.page_count, edition.article_count],
        );
    }
    for (const article of FIXTURE_ARTICLES) {
        await pg.query(
            `INSERT INTO articles
                 (id, edition_date, position, category, headline, summary, full_text,
                  body_plain, byline, writer_position, page, is_hero, is_featured,
                  image_urls, image_captions)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
                article.id,
                article.edition_date,
                article.position,
                article.category,
                article.headline,
                article.summary,
                article.full_text,
                article.body_plain,
                article.byline,
                article.writer_position,
                article.page,
                article.is_hero,
                article.is_featured,
                JSON.stringify(article.image_urls),
                JSON.stringify(article.image_captions),
            ],
        );
    }
}

interface TableCounts {
    issues: number;
    editionAliases: number;
    items: number;
    revisions: number;
    contentAliases: number;
}

async function tableCounts(pg: PGlite): Promise<TableCounts> {
    const { rows } = await pg.query<{
        issues: number;
        edition_aliases: number;
        items: number;
        revisions: number;
        content_aliases: number;
    }>(
        `SELECT (SELECT count(*)::int FROM issues) AS issues,
                (SELECT count(*)::int FROM legacy_edition_aliases) AS edition_aliases,
                (SELECT count(*)::int FROM content_items) AS items,
                (SELECT count(*)::int FROM content_revisions) AS revisions,
                (SELECT count(*)::int FROM legacy_content_aliases) AS content_aliases`,
    );
    return {
        issues: rows[0].issues,
        editionAliases: rows[0].edition_aliases,
        items: rows[0].items,
        revisions: rows[0].revisions,
        contentAliases: rows[0].content_aliases,
    };
}

describe("identity primitives (pure)", () => {
    it("mints well-formed ULIDs with a deterministic time prefix", () => {
        const a = ulid(1234567890123);
        const b = ulid(1234567890123);
        expect(a).toMatch(ULID_PATTERN);
        expect(b).toMatch(ULID_PATTERN);
        expect(a.slice(0, 10)).toBe(b.slice(0, 10));
        expect(a).not.toBe(b);
        expect(ulid(0).startsWith("0000000000")).toBe(true);
    });

    it("keeps the identity key stable across positional index and body changes", () => {
        // The same physical article, seen at two different positional indices
        // after a re-OCR that also perturbed casing/punctuation and the body.
        const firstScan = {
            id: "1950-01-11-0",
            position: 0,
            headline: "Bishops Defeat Denison In Overtime Thriller",
            byline: "By Jack Morris",
            page: 1,
            bodyPlain: "The Bishops outlasted Denison in an overtime thriller.",
        };
        const rescan = {
            id: "1950-01-11-7",
            position: 7,
            headline: "BISHOPS Defeat, Denison in Overtime Thriller!",
            byline: "By Jack  Morris",
            page: 1,
            bodyPlain: "The Bishops outlasted Denison in a dramatic overtime thriller.",
        };
        const keyFirst = deriveIdentityKey({
            contentType: "article",
            sourcePages: [firstScan.page],
            headline: firstScan.headline,
            byline: firstScan.byline,
        });
        const keyRescan = deriveIdentityKey({
            contentType: "article",
            sourcePages: [rescan.page],
            headline: rescan.headline,
            byline: rescan.byline,
        });
        expect(keyFirst).toBe(keyRescan);

        const payload = (bodyPlain: string): RevisionPayload => ({
            category: "Sports",
            headline: firstScan.headline,
            summary: "The basketball squad edged Denison.",
            byline: firstScan.byline,
            bodyPlain,
            imageUrls: [],
            imageCaptions: [],
        });
        const hashFirst = contentRevisionHash(payload(firstScan.bodyPlain));
        const hashRescan = contentRevisionHash(payload(rescan.bodyPlain));
        expect(hashFirst).toMatch(/^crev-sha256:[0-9a-f]{64}$/);
        expect(hashRescan).not.toBe(hashFirst);
        expect(contentRevisionHash(payload(firstScan.bodyPlain))).toBe(hashFirst);

        // A genuinely different article gets a different identity key.
        expect(
            deriveIdentityKey({
                contentType: "article",
                sourcePages: [1],
                headline: "New Library Wing Opens",
                byline: null,
            }),
        ).not.toBe(keyFirst);
    });

    it("normalizes text for identity matching only", () => {
        expect(normalizeIdentityText("  BISHOPS   Defeat, Denison—In\tOvertime!! ")).toBe(
            "bishops defeat denison in overtime",
        );
    });

    it("reports ambiguity when several items share the identity key", () => {
        const key = deriveIdentityKey({
            contentType: "article",
            sourcePages: [2],
            headline: "Campus Notes",
            byline: null,
        });
        const items = [
            { id: "01ITEMAAAAAAAAAAAAAAAAAAAA", identityKey: key },
            { id: "01ITEMBBBBBBBBBBBBBBBBBBBB", identityKey: key },
        ];

        expect(matchRevisionToItems({ identityKey: key }, [])).toEqual({ kind: "new" });
        expect(matchRevisionToItems({ identityKey: key }, [items[0]])).toEqual({
            kind: "matched",
            itemId: items[0].id,
        });

        const result = matchRevisionToItems({ identityKey: key }, items);
        expect(result).toEqual({ kind: "ambiguous", itemIds: [items[0].id, items[1].id] });

        if (result.kind !== "ambiguous") throw new Error("expected ambiguous match");
        const error = new AmbiguousIdentityMatchError(result.itemIds);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe("AmbiguousIdentityMatchError");
        expect(error.itemIds).toEqual([items[0].id, items[1].id]);
        expect(error.message).toContain(items[0].id);
        expect(error.message).toContain(items[1].id);
    });
});

describe("identity backfill and compat against PGlite", () => {
    let db: TestDb;
    let firstRun: Awaited<ReturnType<typeof backfillIdentities>>;
    let secondRun: Awaited<ReturnType<typeof backfillIdentities>>;
    let countsAfterFirst: TableCounts;
    let countsAfterSecond: TableCounts;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
        await insertFixture(db.pg);
        firstRun = await backfillIdentities(db.executor);
        countsAfterFirst = await tableCounts(db.pg);
        secondRun = await backfillIdentities(db.executor);
        countsAfterSecond = await tableCounts(db.pg);
    }, 120_000);

    afterAll(async () => {
        await db.close();
    });

    it("backfills every edition and article exactly once", () => {
        expect(firstRun).toEqual({ issues: 2, items: 3, revisions: 3, aliases: 3, skipped: 0 });
        expect(countsAfterFirst).toEqual({
            issues: 2,
            editionAliases: 2,
            items: 3,
            revisions: 3,
            contentAliases: 3,
        });
    });

    it("is idempotent: a second run creates nothing and only skips", () => {
        expect(secondRun).toEqual({ issues: 0, items: 0, revisions: 0, aliases: 0, skipped: 3 });
        expect(countsAfterSecond).toEqual(countsAfterFirst);
    });

    it("gives every legacy article an alias pointing at an item and revision", async () => {
        for (const article of FIXTURE_ARTICLES) {
            const { rows } = await db.pg.query<{
                legacy_id: string;
                content_item_id: string;
                content_revision_id: string;
                alias_kind: string;
                issue_id: string;
                content_type: string;
                active_revision_id: string;
                canonical_date: string;
            }>(
                `SELECT a.legacy_id, a.content_item_id, a.content_revision_id, a.alias_kind,
                        ci.issue_id, ci.content_type, ci.active_revision_id, i.canonical_date
                 FROM legacy_content_aliases a
                 JOIN content_items ci ON ci.id = a.content_item_id
                 JOIN issues i ON i.id = ci.issue_id
                 WHERE a.legacy_id = $1`,
                [article.id],
            );
            expect(rows).toHaveLength(1);
            const row = rows[0];
            expect(row.alias_kind).toBe("article");
            expect(row.content_type).toBe("article");
            expect(row.content_item_id).toMatch(ULID_PATTERN);
            expect(row.content_revision_id).toBeTruthy();
            expect(row.active_revision_id).toBe(row.content_revision_id);
            expect(row.canonical_date).toBe(article.edition_date);

            const { rows: aliasRows } = await db.pg.query<{ issue_id: string }>(
                "SELECT issue_id FROM legacy_edition_aliases WHERE date = $1",
                [article.edition_date],
            );
            expect(aliasRows[0].issue_id).toBe(row.issue_id);
        }
    });

    it("rejects UPDATEs on content_revisions (immutability trigger)", async () => {
        const { rows } = await db.pg.query<{ id: string }>(
            "SELECT id FROM content_revisions LIMIT 1",
        );
        expect(rows).toHaveLength(1);
        await expect(
            db.pg.query("UPDATE content_revisions SET headline = 'tampered' WHERE id = $1", [
                rows[0].id,
            ]),
        ).rejects.toThrow(/immutable/);
    });

    it("hydrates the exact legacy article projection from revision + alias", async () => {
        for (const article of FIXTURE_ARTICLES) {
            const { rows: legacyRows } = await db.pg.query<Record<string, unknown>>(
                `SELECT id, category, headline, summary, full_text, body_plain,
                        byline, writer_position, page
                 FROM articles WHERE id = $1`,
                [article.id],
            );
            expect(legacyRows).toHaveLength(1);

            const { rows: aliasRows } = await db.pg.query<
                LegacyContentAliasRow & { content_revision_id: string }
            >(
                `SELECT legacy_id, content_revision_id
                 FROM legacy_content_aliases WHERE legacy_id = $1`,
                [article.id],
            );
            const { rows: revisionRows } = await db.pg.query<ContentRevisionRow>(
                `SELECT category, headline, summary, full_text, body_plain,
                        byline, writer_position, page
                 FROM content_revisions WHERE id = $1`,
                [aliasRows[0].content_revision_id],
            );

            const hydrated = hydrateArticleFromRevision(revisionRows[0], aliasRows[0]);
            expect(hydrated).toEqual(legacyRows[0]);
        }
    });

    it("populated search_vector on fixture articles via the FTS trigger", async () => {
        const { rows: missing } = await db.pg.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM articles WHERE search_vector IS NULL",
        );
        expect(missing[0].n).toBe(0);

        const { rows: hits } = await db.pg.query<{ id: string }>(
            `SELECT id FROM articles
             WHERE search_vector @@ plainto_tsquery('english', 'overtime thriller')`,
        );
        expect(hits.map((row) => row.id)).toEqual(["1950-01-11-0"]);
    });

    it("registers a corpus version idempotently from a snapshot file", async () => {
        // The frozen production corpus JSON was removed from the repo, so this
        // drives registerCorpusVersion against a synthetic snapshot — it still
        // exercises the idempotent insert and the hash/count propagation.
        const corpusPath = join(mkdtempSync(join(tmpdir(), "corpus-")), "corpus.json");
        writeFileSync(
            corpusPath,
            JSON.stringify({
                corpusVersion: "test-corpus-abc123",
                corpusSha256: "a".repeat(64),
                retrievalMode: "legacy",
                generatedAt: "2026-01-01T00:00:00Z",
                counts: { editions: 3, articles: 42, ads: 7, images: 0 },
            }),
        );

        const first = await registerCorpusVersion(db.executor, corpusPath);
        const second = await registerCorpusVersion(db.executor, corpusPath);
        expect(first.inserted).toBe(true);
        expect(second).toEqual({ id: first.id, inserted: false });

        const { rows } = await db.pg.query<{
            id: string;
            manifest_hash: string;
            edition_count: number;
            article_count: number;
            ad_count: number;
            image_count: number;
        }>(
            `SELECT id, manifest_hash, edition_count, article_count, ad_count, image_count
             FROM corpus_versions`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe("test-corpus-abc123");
        expect(rows[0].manifest_hash).toBe("a".repeat(64));
        expect(rows[0].edition_count).toBe(3);
        expect(rows[0].article_count).toBe(42);
        expect(rows[0].ad_count).toBe(7);
        expect(rows[0].image_count).toBe(0);
    });
});
