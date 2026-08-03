/** @vitest-environment node */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import { writeEditionRevision } from "../../src/server/publisher/revision-writer";
import { validateRevision } from "../../src/server/publisher/validate-revision";
import { createTestDb, MIGRATIONS_DIR, type TestDb } from "./helpers/pglite";

const FIXTURE_EDITION = {
    edition_date: "1961-03-02",
    publication_info: "The Transcript",
    articles: [
        {
            headline: "Council Approves Budget",
            author: "By R. Ames",
            writer_position: "",
            category: "News",
            body: "The council approved the annual budget after a long and contentious debate on Tuesday evening. Funding for road repairs and the municipal library will rise substantially next year, while several discretionary programs were trimmed to balance the ledger. Council members praised the compromise as workable for all parties involved.",
            images: [],
            image_files: [],
            source_pages: ["1961-03-02_page_1.jpg"],
            continues_on: "",
            continued_from: "",
        },
        {
            headline: "Track Team Wins Meet",
            author: "",
            writer_position: "",
            category: "Sports",
            body: "The track team won its opening meet of the season by a wide margin on Saturday afternoon, sweeping the sprint events and taking first place in both relays. Coach Miller credited the winter conditioning program and said the squad's depth should carry it through the conference schedule ahead this spring.",
            images: [],
            image_files: [],
            source_pages: ["1961-03-02_page_2.jpg"],
            continues_on: "",
            continued_from: "",
        },
    ],
    ads: [],
    other_content: [],
};

describe("validateRevision", () => {
    let db: TestDb;
    let revisionId: string;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
        const staged = await writeEditionRevision(db.executor, {
            editionDate: "1961-03-02",
            edition: FIXTURE_EDITION as never,
            expectedPages: 2,
        });
        revisionId = staged.editionRevisionId;
    });

    afterAll(async () => {
        await db.close();
    });

    it("passes a well-formed staged revision", async () => {
        const result = await validateRevision(db.executor, revisionId);
        expect(result.issues).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.counts.pages).toBe(2);
        expect(result.counts.items).toBe(2);
        expect(result.counts.articleAliases).toBe(2);
        expect(result.embeddingReadiness).toBe("not_applicable_no_index_build");
    });

    it("fails closed for an unknown revision id", async () => {
        const result = await validateRevision(db.executor, "erev-does-not-exist");
        expect(result.ok).toBe(false);
        expect(result.issues[0].check).toBe("revision-exists");
    });

    it("flags a content item whose active revision pointer is missing", async () => {
        await db.pg.query(
            `UPDATE content_items SET active_revision_id = NULL
             WHERE id = (SELECT content_item_id FROM legacy_content_aliases LIMIT 1)`,
        );
        const result = await validateRevision(db.executor, revisionId);
        expect(result.ok).toBe(false);
        expect(result.issues.map((issue) => issue.check)).toContain("active-revision-pointers");
    });
});
