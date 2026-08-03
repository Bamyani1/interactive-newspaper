/** @vitest-environment node */
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    applyRegistry,
    buildRegistry,
    classifyObjectKey,
    collectDbReferences,
    listR2Objects,
    parseImageReference,
    registrySha256,
    verifyRegistry,
    writeRegistryArtifact,
} from "../../scripts/db/bootstrap-asset-registry.mjs";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const H1 = "a1".repeat(32);
const H2 = "b2".repeat(32);
const H3 = "c3".repeat(32);

describe("parseImageReference", () => {
    it("parses bare legacy paths and normalizes raster extensions to .webp", () => {
        expect(parseImageReference("1955-03-09/images/photo_1.webp")).toEqual({
            namespace: "legacy",
            key: "1955-03-09/images/photo_1.webp",
            editionDate: "1955-03-09",
            basename: "photo_1.webp",
            raw: "1955-03-09/images/photo_1.webp",
        });
        expect(parseImageReference("1955-03-09/images/photo_1.jpg").key).toBe(
            "1955-03-09/images/photo_1.webp",
        );
        expect(parseImageReference("1955-03-09/images/photo_1.PNG").key).toBe(
            "1955-03-09/images/photo_1.webp",
        );
    });

    it("parses IMAGE_BASE_URL-prefixed legacy URLs, including extra path prefixes", () => {
        const parsed = parseImageReference(
            "https://images.example.com/1955-03-09/images/photo_1.webp",
        );
        expect(parsed.namespace).toBe("legacy");
        expect(parsed.key).toBe("1955-03-09/images/photo_1.webp");

        const nested = parseImageReference(
            "https://cdn.example.com/bucket/1955-03-09/images/photo_2.jpeg",
        );
        expect(nested.namespace).toBe("legacy");
        expect(nested.key).toBe("1955-03-09/images/photo_2.webp");
    });

    it("parses dev proxy paths and decodes percent-encoding", () => {
        const parsed = parseImageReference("/api/editions/1955-03-09/images/photo%201.jpg");
        expect(parsed).toEqual({
            namespace: "legacy",
            key: "1955-03-09/images/photo 1.webp",
            editionDate: "1955-03-09",
            basename: "photo 1.webp",
            raw: "/api/editions/1955-03-09/images/photo%201.jpg",
        });
    });

    it("parses every content-addressed form to the ocr-assets key", () => {
        const expectedKey = `ocr-assets/${H1}.webp`;
        for (const raw of [
            `ocr-assets/${H1}.webp`,
            `https://images.example.com/ocr-assets/${H1}.webp`,
            `${H1}.webp`,
            H1,
            `images/${H1}.webp`,
        ]) {
            const parsed = parseImageReference(raw);
            expect(parsed.namespace, raw).toBe("content");
            expect(parsed.key, raw).toBe(expectedKey);
            expect(parsed.basename, raw).toBe(`${H1}.webp`);
        }
    });

    it("classifies a hex-64 basename under a date path as content-addressed", () => {
        const parsed = parseImageReference(`/api/editions/1955-03-09/images/${H1}.webp`);
        expect(parsed.namespace).toBe("content");
        expect(parsed.key).toBe(`ocr-assets/${H1}.webp`);
        expect(parsed.editionDate).toBe("1955-03-09");
    });

    it("keeps unparseable values as unknown with a null key", () => {
        for (const raw of [
            "photo.jpg",
            "/images/photo.jpg",
            "ftp://example.com/photo.jpg",
            "a/b/c/photo.jpg",
            "",
        ]) {
            const parsed = parseImageReference(raw);
            expect(parsed.namespace, JSON.stringify(raw)).toBe("unknown");
            expect(parsed.key, JSON.stringify(raw)).toBeNull();
            expect(parsed.raw, JSON.stringify(raw)).toBe(raw);
        }
        // 63 hex chars is not a content hash; without a date it is unknown.
        expect(parseImageReference(H1.slice(0, 63)).namespace).toBe("unknown");
    });
});

describe("listR2Objects", () => {
    it("paginates fully across both prefixes and dedupes overlapping keys", async () => {
        const pages = new Map<string, { objects: Array<{ key: string; size: number }>; next?: string }>([
            [
                "|",
                {
                    objects: [
                        { key: "1955-03-09/images/photo_1.webp", size: 10 },
                        { key: "1955-03-09/images/photo_2.webp", size: 20 },
                    ],
                    next: "t1",
                },
            ],
            [
                "|t1",
                {
                    objects: [
                        { key: "1956-01-01/images/stray.webp", size: 30 },
                        { key: "ocr-assets-gc/unreferenced.json", size: 5 },
                    ],
                    next: "t2",
                },
            ],
            ["|t2", { objects: [{ key: `ocr-assets/${H1}.webp`, size: 40 }] }],
            [
                "ocr-assets/|",
                {
                    objects: [
                        { key: `ocr-assets/${H1}.webp`, size: 40 },
                        { key: `ocr-assets/${H2}.webp`, size: 50 },
                    ],
                },
            ],
        ]);
        const calls: string[] = [];
        const listFn = async (prefix: string, token?: string) => {
            const id = `${prefix}|${token ?? ""}`;
            calls.push(id);
            const page = pages.get(id);
            if (!page) throw new Error(`Unexpected list call: ${id}`);
            return page;
        };

        const objects = await listR2Objects(listFn);
        expect(calls).toEqual(["|", "|t1", "|t2", "ocr-assets/|"]);
        expect(objects.map((object: { key: string }) => object.key)).toEqual([
            "1955-03-09/images/photo_1.webp",
            "1955-03-09/images/photo_2.webp",
            "1956-01-01/images/stray.webp",
            "ocr-assets-gc/unreferenced.json",
            `ocr-assets/${H1}.webp`,
            `ocr-assets/${H2}.webp`,
        ]);
        expect(objects.filter((object: { key: string }) => object.key === `ocr-assets/${H1}.webp`)).toHaveLength(1);
        expect(classifyObjectKey("ocr-assets-gc/unreferenced.json")).toBe("other");
    });
});

function ref(raw: string, table = "articles", id = "a1") {
    return { ...parseImageReference(raw), sources: [{ table, id }] };
}

describe("buildRegistry", () => {
    const references = [
        ref("1955-03-09/images/photo_1.webp"),
        ref(`ocr-assets/${H1}.webp`),
        ref(`${H2}.webp`, "article_images", "img-1"),
        ref("mystery.jpg", "ads", "1"),
    ];
    const objects = [
        { key: "1955-03-09/images/photo_1.webp", size: 10 },
        { key: `ocr-assets/${H1}.webp`, size: 40 },
        { key: `ocr-assets/${H3}.webp`, size: 60 },
        { key: "1956-01-01/images/stray.webp", size: 30 },
        { key: "ocr-assets-gc/unreferenced.json", size: 5 },
    ];

    it("joins references and objects into matched/orphan/missing/unknown", () => {
        const registry = buildRegistry({ references, objects });
        expect(registry.schemaVersion).toBe(1);
        expect(registry.matchedCount).toBe(2);
        expect(registry.orphanObjects).toEqual([
            "1956-01-01/images/stray.webp",
            `ocr-assets/${H3}.webp`,
        ]);
        expect(registry.missingObjects).toEqual([`ocr-assets/${H2}.webp`]);
        expect(registry.unknownReferences).toEqual(["mystery.jpg"]);
        expect(registry.references).toHaveLength(4);
        expect(registry.objects).toHaveLength(5);
        expect(verifyRegistry(registry).ok).toBe(true);
    });

    it("hashes deterministically regardless of input order and generatedAt", () => {
        const first = buildRegistry({ references, objects });
        const second = buildRegistry({
            references: [...references].reverse(),
            objects: [...objects].reverse(),
        });
        expect(second.sha256).toBe(first.sha256);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));

        // generatedAt is stamped by the caller and excluded from the hash.
        const stamped = { ...first, generatedAt: "2026-08-02T00:00:00.000Z" };
        expect(registrySha256(stamped)).toBe(first.sha256);
        expect(verifyRegistry(stamped).ok).toBe(true);
    });
});

describe("writeRegistryArtifact", () => {
    it("writes immutable artifacts and refuses divergent overwrites", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "asset-registry-"));
        const registry = buildRegistry({
            references: [ref(`ocr-assets/${H1}.webp`)],
            objects: [{ key: `ocr-assets/${H1}.webp`, size: 40 }],
        });
        registry.generatedAt = "2026-08-02T00:00:00.000Z";

        const first = writeRegistryArtifact(registry, dir);
        expect(first.created).toBe(true);
        expect(path.basename(first.jsonPath)).toBe(
            `registry-${registry.sha256!.slice(0, 16)}.json`,
        );
        expect(existsSync(first.jsonPath)).toBe(true);
        expect(existsSync(first.mdPath)).toBe(true);
        expect(readFileSync(first.mdPath, "utf8")).toContain(registry.sha256);

        // Identical canonical content (different generatedAt) is a no-op.
        const restamped = { ...registry, generatedAt: "2026-08-03T00:00:00.000Z" };
        const second = writeRegistryArtifact(restamped, dir);
        expect(second.created).toBe(false);
        expect(second.jsonPath).toBe(first.jsonPath);
        expect(JSON.parse(readFileSync(first.jsonPath, "utf8")).generatedAt).toBe(
            "2026-08-02T00:00:00.000Z",
        );

        // A file at the artifact path whose content diverges is never overwritten.
        const tampered = JSON.parse(readFileSync(first.jsonPath, "utf8"));
        tampered.matchedCount += 1;
        writeFileSync(first.jsonPath, JSON.stringify(tampered, null, 2));
        expect(() => writeRegistryArtifact(registry, dir)).toThrow(/Refusing to overwrite/);
    });
});

describe("collectDbReferences + applyRegistry (PGlite)", () => {
    let db: TestDb;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
        await db.executor.query({
            text: "INSERT INTO editions (date) VALUES ('1955-03-09')",
        });
        await db.executor.query({
            text: `INSERT INTO articles (id, edition_date, position, image_urls)
                   VALUES ('art-1', '1955-03-09', 1, $1)`,
            params: [JSON.stringify(["1955-03-09/images/photo_1.jpg", `ocr-assets/${H1}.webp`])],
        });
        await db.executor.query({
            text: `INSERT INTO ads (edition_date, position, image_urls)
                   VALUES ('1955-03-09', 1, $1)`,
            params: [
                JSON.stringify(["/api/editions/1955-03-09/images/photo_1.jpg", "mystery-blob"]),
            ],
        });
        await db.executor.query({
            text: `INSERT INTO article_images (id, article_id, image_index, image_url)
                   VALUES ('img-1', 'art-1', 0, $1)`,
            params: [`${H2}.webp`],
        });
    });

    afterAll(async () => {
        await db.close();
    });

    it("collects deduped references with their source rows", async () => {
        const references = await collectDbReferences(db.executor);
        expect(
            references.map((r: { namespace: string; key: string | null }) => [r.namespace, r.key]),
        ).toEqual([
            ["content", `ocr-assets/${H1}.webp`],
            ["content", `ocr-assets/${H2}.webp`],
            ["legacy", "1955-03-09/images/photo_1.webp"],
            ["unknown", null],
        ]);
        const legacy = references.find((r: { namespace: string }) => r.namespace === "legacy");
        expect(legacy.sources).toEqual([
            { table: "ads", id: "1" },
            { table: "articles", id: "art-1" },
        ]);
        const unknown = references.find((r: { namespace: string }) => r.namespace === "unknown");
        expect(unknown.raw).toBe("mystery-blob");
        expect(unknown.sources).toEqual([{ table: "ads", id: "1" }]);
    });

    it("applies assets rows for content-addressed objects only, idempotently", async () => {
        const references = await collectDbReferences(db.executor);
        const registry = buildRegistry({
            references,
            objects: [
                { key: `ocr-assets/${H1}.webp`, size: 1234 },
                { key: `ocr-assets/${H2}.webp`, size: 2048 },
                { key: "1955-03-09/images/photo_1.webp", size: 10 },
            ],
        });

        const first = await applyRegistry(db.executor, registry);
        expect(first).toEqual({
            inserted: 2,
            alreadyPresent: 0,
            skippedLegacy: 1,
            skippedOther: 0,
        });

        const rows = await db.executor.query({
            text: "SELECT sha256, byte_count::int AS byte_count, mime_type, storage_key, legacy_key FROM assets ORDER BY sha256",
        });
        expect(rows).toEqual([
            {
                sha256: H1,
                byte_count: 1234,
                mime_type: "image/webp",
                storage_key: `ocr-assets/${H1}.webp`,
                legacy_key: null,
            },
            {
                sha256: H2,
                byte_count: 2048,
                mime_type: "image/webp",
                storage_key: `ocr-assets/${H2}.webp`,
                legacy_key: null,
            },
        ]);

        const again = await applyRegistry(db.executor, registry);
        expect(again).toEqual({
            inserted: 0,
            alreadyPresent: 2,
            skippedLegacy: 1,
            skippedOther: 0,
        });
        const count = await db.executor.query({ text: "SELECT count(*)::int AS n FROM assets" });
        expect(count[0].n).toBe(2);
    });

    it("refuses to apply a registry whose self-hash does not verify", async () => {
        const registry = buildRegistry({
            references: [ref(`ocr-assets/${H1}.webp`)],
            objects: [{ key: `ocr-assets/${H1}.webp`, size: 40 }],
        });
        registry.sha256 = "0".repeat(64);
        await expect(applyRegistry(db.executor, registry)).rejects.toThrow(/self-hash mismatch/);
    });
});
