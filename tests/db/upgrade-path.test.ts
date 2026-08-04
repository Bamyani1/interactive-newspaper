/** @vitest-environment node */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import {
    applyFixture,
    createTestDb,
    introspectSchema,
    type SchemaSnapshot,
    type TestDb,
} from "./helpers/pglite";

const DB_TIMEOUT = 120_000;
const SNAPSHOT_PATH = path.resolve(__dirname, "../../scripts/db/schema-snapshot.json");

function columnNames(snapshot: SchemaSnapshot, table: string): string[] {
    const entry = snapshot.tables[table];
    expect(entry).toBeDefined();
    return entry.columns.map((column) => column.name);
}

let fresh: TestDb;
let snapshotFresh: SchemaSnapshot;

beforeAll(async () => {
    fresh = await createTestDb();
    await runMigrations(fresh.executor);
    snapshotFresh = await introspectSchema(fresh.pg);
}, DB_TIMEOUT);

afterAll(async () => {
    await fresh.close();
});

describe("production-baseline upgrade path", () => {
    let db: TestDb;
    let snapshotUpgraded: SchemaSnapshot;

    beforeAll(async () => {
        db = await createTestDb();
        await applyFixture(db.pg, "legacy-baseline-prod.sql");
        await runMigrations(db.executor);
        snapshotUpgraded = await introspectSchema(db.pg);
    }, DB_TIMEOUT);

    afterAll(async () => {
        await db.close();
    });

    it("migrated prod baseline introspects identically to a fresh apply", () => {
        expect(snapshotUpgraded).toEqual(snapshotFresh);
    });

    it("citation_snapshots exists after both fresh and prod-upgrade paths", () => {
        expect(columnNames(snapshotFresh, "ask_session_turns")).toContain("citation_snapshots");
        expect(columnNames(snapshotUpgraded, "ask_session_turns")).toContain("citation_snapshots");
    });
});

describe("migrate-rag-v2-era upgrade path", () => {
    let db: TestDb;
    let snapshotUpgraded: SchemaSnapshot;
    const chunkId = "1990-05-01-0:chunk:000";
    const imageId = "1990-05-01-0:image:000";

    beforeAll(async () => {
        db = await createTestDb();
        await applyFixture(db.pg, "legacy-v2-tables.sql");
        await db.pg.query("INSERT INTO editions (date) VALUES ('1990-05-01')");
        await db.pg.query(
            "INSERT INTO articles (id, edition_date, position, headline) VALUES ('1990-05-01-0', '1990-05-01', 0, 'Hello')",
        );
        await db.pg.query(
            `INSERT INTO article_chunks (id, article_id, chunk_index, chunk_text, embedding_input_hash)
             VALUES ($1, '1990-05-01-0', 0, 'legacy chunk text', 'hash-v2-0')`,
            [chunkId],
        );
        await db.pg.query(
            `INSERT INTO article_images (id, article_id, image_index, image_url, caption)
             VALUES ($1, '1990-05-01-0', 0, 'https://assets.example/img-0.png', 'a caption')`,
            [imageId],
        );
        await runMigrations(db.executor);
        snapshotUpgraded = await introspectSchema(db.pg);
    }, DB_TIMEOUT);

    afterAll(async () => {
        await db.close();
    });

    it("migrated v2 schema introspects identically to a fresh apply", () => {
        expect(snapshotUpgraded).toEqual(snapshotFresh);
    });

    it("pre-existing chunk and image rows survive with NULL index_build_id", async () => {
        const chunks = await db.pg.query<{ index_build_id: string | null; chunk_text: string }>(
            "SELECT index_build_id, chunk_text FROM article_chunks WHERE id = $1",
            [chunkId],
        );
        expect(chunks.rows).toHaveLength(1);
        expect(chunks.rows[0].index_build_id).toBeNull();
        expect(chunks.rows[0].chunk_text).toBe("legacy chunk text");

        const images = await db.pg.query<{ index_build_id: string | null; image_url: string }>(
            "SELECT index_build_id, image_url FROM article_images WHERE id = $1",
            [imageId],
        );
        expect(images.rows).toHaveLength(1);
        expect(images.rows[0].index_build_id).toBeNull();
        expect(images.rows[0].image_url).toBe("https://assets.example/img-0.png");
    });

    it("ON CONFLICT (id) DO UPDATE upserts still work on article_chunks", async () => {
        await db.pg.query(
            `INSERT INTO article_chunks (id, article_id, chunk_index, chunk_text, embedding_input_hash)
             VALUES ($1, '1990-05-01-0', 0, 'updated chunk text', 'hash-v2-1')
             ON CONFLICT (id) DO UPDATE SET
               chunk_text = EXCLUDED.chunk_text,
               embedding_input_hash = EXCLUDED.embedding_input_hash`,
            [chunkId],
        );
        const rows = await db.pg.query<{ chunk_text: string; embedding_input_hash: string }>(
            "SELECT chunk_text, embedding_input_hash FROM article_chunks WHERE id = $1",
            [chunkId],
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].chunk_text).toBe("updated chunk text");
        expect(rows.rows[0].embedding_input_hash).toBe("hash-v2-1");
    });
});

describe("branch-draft upgrade path", () => {
    let db: TestDb;
    let snapshotUpgraded: SchemaSnapshot;
    const buildId = "build-1990-05-01";
    const chunkId = "1990-05-01-0:chunk:000";
    const embeddingLiteral = `[${Array(768).fill("0.1").join(",")}]`;

    beforeAll(async () => {
        db = await createTestDb();
        await applyFixture(db.pg, "legacy-draft-schema.sql");
        await db.pg.query(
            `INSERT INTO rag_index_builds
               (id, corpus_version, status, pipeline_version, embedding_model,
                text_embedding_input_version, image_embedding_input_version)
             VALUES ($1, 'corpus-1', 'active', 'pipeline-1', 'model-1', 'text-v1', 'image-v1')`,
            [buildId],
        );
        await db.pg.query("INSERT INTO editions (date) VALUES ('1990-05-01')");
        await db.pg.query(
            "INSERT INTO articles (id, edition_date, position, headline) VALUES ('1990-05-01-0', '1990-05-01', 0, 'Hello')",
        );
        await db.pg.query(
            `INSERT INTO article_chunks
               (id, index_build_id, article_id, chunk_index, chunk_text, embedding_input_hash, embedding)
             VALUES ($1, $2, '1990-05-01-0', 0, 'draft chunk text', 'hash-draft-0', $3::vector)`,
            [chunkId, buildId, embeddingLiteral],
        );
        await runMigrations(db.executor);
        snapshotUpgraded = await introspectSchema(db.pg);
    }, DB_TIMEOUT);

    afterAll(async () => {
        await db.close();
    });

    it("migrated draft schema introspects identically to a fresh apply", () => {
        expect(snapshotUpgraded).toEqual(snapshotFresh);
    });

    it("build-scoped chunk row, its build id, and its embedding survive (expand-only)", async () => {
        const rows = await db.pg.query<{
            index_build_id: string;
            chunk_text: string;
            dims: number;
        }>(
            `SELECT index_build_id, chunk_text, vector_dims(embedding) AS dims
             FROM article_chunks WHERE id = $1`,
            [chunkId],
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].index_build_id).toBe(buildId);
        expect(rows.rows[0].chunk_text).toBe("draft chunk text");
        expect(Number(rows.rows[0].dims)).toBe(768);

        const builds = await db.pg.query<{ id: string }>(
            "SELECT id FROM rag_index_builds WHERE id = $1",
            [buildId],
        );
        expect(builds.rows).toHaveLength(1);
    });

    it("index_build_id is nullable after migration", async () => {
        const rows = await db.pg.query<{ is_nullable: string }>(
            `SELECT is_nullable FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'article_chunks'
               AND column_name = 'index_build_id'`,
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].is_nullable).toBe("YES");
    });
});

describe("committed schema snapshot", () => {
    it.skipIf(!existsSync(SNAPSHOT_PATH))(
        "scripts/db/schema-snapshot.json deep-equals the fresh-apply snapshot",
        () => {
            const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as SchemaSnapshot;
            expect(committed).toEqual(snapshotFresh);
        },
    );
});
