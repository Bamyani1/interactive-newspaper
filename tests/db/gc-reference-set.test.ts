/** @vitest-environment node */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    buildRegistry,
    parseImageReference,
} from "../../scripts/db/bootstrap-asset-registry.mjs";
import {
    GC_STATE_KEY,
    loadRegistryArtifact,
    protectedKeySet,
    runGc,
} from "../../scripts/db/gc-r2-assets.mjs";
import { runMigrations } from "../../scripts/db/lib/migration-runner";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const H1 = "a1".repeat(32);
const H2 = "b2".repeat(32);
const H9 = "e9".repeat(32);

const DAY_MS = 24 * 60 * 60 * 1000;

function ref(raw: string, table = "articles", id = "a1") {
    return { ...parseImageReference(raw), sources: [{ table, id }] };
}

function makeRegistry(raws: string[], objects: Array<{ key: string; size?: number }>) {
    return buildRegistry({ references: raws.map((raw) => ref(raw)), objects });
}

interface FakeCalls {
    list: Array<[string, string | undefined]>;
    gets: number;
    puts: Array<{ key: string; body: string; opts: Record<string, unknown> }>;
    deletes: string[][];
}

function createFakeClient(options: {
    objects: Array<{ key: string; size?: number }>;
    stateBodies?: Array<string | null>;
}) {
    const calls: FakeCalls = { list: [], gets: 0, puts: [], deletes: [] };
    return {
        calls,
        async list(prefix: string, token?: string) {
            calls.list.push([prefix, token]);
            return {
                objects: options.objects.filter((object) => object.key.startsWith(prefix)),
                next: undefined,
            };
        },
        async get(key: string) {
            if (key !== GC_STATE_KEY) throw new Error(`Unexpected get: ${key}`);
            calls.gets += 1;
            const bodies = options.stateBodies ?? [null];
            const body = bodies[Math.min(calls.gets - 1, bodies.length - 1)];
            return body === null ? null : { body, etag: `etag-${calls.gets}` };
        },
        async put(key: string, body: string, opts: Record<string, unknown> = {}) {
            calls.puts.push({ key, body, opts });
        },
        async deleteObjects(keys: string[]) {
            calls.deletes.push(keys);
            return { errors: [] };
        },
    };
}

/** A valid registry whose references and objects agree (no missingObjects). */
function validRegistry() {
    return makeRegistry(
        ["1955-03-09/images/photo_1.webp", `ocr-assets/${H1}.webp`],
        [
            { key: "1955-03-09/images/photo_1.webp", size: 10 },
            { key: `ocr-assets/${H1}.webp`, size: 40 },
        ],
    );
}

afterEach(() => {
    delete process.env.GC_APPROVAL_TOKEN;
});

describe("registry refusals", () => {
    it("refuses without a registry", async () => {
        const client = createFakeClient({ objects: [] });
        await expect(runGc({ registry: undefined, client })).rejects.toThrow(
            /registry artifact is required/,
        );
        expect(client.calls.list).toHaveLength(0);
    });

    it("refuses a registry whose self-hash does not verify", async () => {
        const client = createFakeClient({ objects: [] });
        const tamperedHash = validRegistry();
        tamperedHash.sha256 = "0".repeat(64);
        await expect(runGc({ registry: tamperedHash, client })).rejects.toThrow(
            /self-hash does not verify/,
        );

        const tamperedContent = validRegistry();
        tamperedContent.matchedCount += 1;
        await expect(runGc({ registry: tamperedContent, client })).rejects.toThrow(
            /self-hash does not verify/,
        );
    });

    it("refuses a registry with zero references", async () => {
        const client = createFakeClient({ objects: [] });
        const registry = buildRegistry({
            references: [],
            objects: [{ key: `ocr-assets/${H1}.webp`, size: 40 }],
        });
        await expect(runGc({ registry, client })).rejects.toThrow(/zero references/);
    });

    it("refuses a registry with non-empty missingObjects", async () => {
        const client = createFakeClient({ objects: [] });
        const registry = makeRegistry([`ocr-assets/${H1}.webp`], []);
        expect(registry.missingObjects).toEqual([`ocr-assets/${H1}.webp`]);
        await expect(runGc({ registry, client })).rejects.toThrow(/regenerate the registry/);
    });

    it("refuses grace periods below 30 days", async () => {
        const client = createFakeClient({ objects: [] });
        await expect(runGc({ registry: validRegistry(), client, graceDays: 7 })).rejects.toThrow(
            /at least 30/,
        );
    });

    it("loadRegistryArtifact verifies the artifact on disk", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "gc-registry-"));
        const registry = validRegistry();
        const artifactPath = path.join(dir, "registry.json");
        writeFileSync(artifactPath, JSON.stringify(registry, null, 2));
        expect(loadRegistryArtifact(artifactPath).sha256).toBe(registry.sha256);

        const tampered = { ...registry, matchedCount: registry.matchedCount + 1 };
        const tamperedPath = path.join(dir, "tampered.json");
        writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2));
        expect(() => loadRegistryArtifact(tamperedPath)).toThrow(/self-hash does not verify/);
    });
});

describe("protection", () => {
    it("marks only unreferenced editions when the registry knows a partial world", async () => {
        // Registry knows editions A (1955-03-09) and B (1955-03-16); the fake
        // R2 world also contains edition C (1957-01-01) plus an unreferenced
        // content object.
        const registry = makeRegistry(
            [
                "1955-03-09/images/photo_1.webp",
                "1955-03-16/images/photo_1.webp",
                `ocr-assets/${H1}.webp`,
            ],
            [
                { key: "1955-03-09/images/photo_1.webp", size: 10 },
                { key: "1955-03-16/images/photo_1.webp", size: 11 },
                { key: `ocr-assets/${H1}.webp`, size: 40 },
            ],
        );
        const client = createFakeClient({
            objects: [
                { key: "1955-03-09/images/photo_1.webp", size: 10 },
                { key: "1955-03-16/images/photo_1.webp", size: 11 },
                { key: `ocr-assets/${H1}.webp`, size: 40 },
                { key: "1957-01-01/images/stray_1.webp", size: 12 },
                { key: "1957-01-01/images/stray_2.webp", size: 13 },
                { key: `ocr-assets/${H9}.webp`, size: 44 },
                { key: GC_STATE_KEY, size: 5 },
                { key: "random/nonsense.txt", size: 1 },
            ],
        });
        const lines: string[] = [];
        const result = await runGc({ registry, client, log: (line: string) => lines.push(line) });

        expect(new Set(result.marked)).toEqual(
            new Set([
                "1957-01-01/images/stray_1.webp",
                "1957-01-01/images/stray_2.webp",
                `ocr-assets/${H9}.webp`,
            ]),
        );
        expect(result.stale).toEqual([]);
        expect(result.ignoredObjectCount).toBe(1);
        // Dry-run: nothing is deleted and the grace ledger is not written.
        expect(client.calls.deletes).toHaveLength(0);
        expect(client.calls.puts).toHaveLength(0);
        expect(lines.filter((line) => line.startsWith("WOULD_MARK "))).toHaveLength(3);
        // Candidate listing covered both namespaces.
        expect(client.calls.list.map(([prefix]) => prefix)).toEqual(["", "ocr-assets/"]);
    });

    it("protects legacy-namespace keys named by the registry", async () => {
        const registry = validRegistry();
        const client = createFakeClient({
            objects: [
                { key: "1955-03-09/images/photo_1.webp", size: 10 },
                { key: `ocr-assets/${H1}.webp`, size: 40 },
                { key: "1955-03-09/images/unlisted.webp", size: 15 },
            ],
        });
        const result = await runGc({ registry, client, log: () => {} });
        expect(result.marked).toEqual(["1955-03-09/images/unlisted.webp"]);
        expect(result.marked).not.toContain("1955-03-09/images/photo_1.webp");
        expect(protectedKeySet(registry).has("1955-03-09/images/photo_1.webp")).toBe(true);
    });
});

describe("live database cross-check (PGlite)", () => {
    let db: TestDb;

    beforeAll(async () => {
        db = await createTestDb();
        await runMigrations(db.executor, { dir: MIGRATIONS_DIR });
        await db.executor.query({ text: "INSERT INTO editions (date) VALUES ('1955-03-23')" });
        await db.executor.query({
            text: `INSERT INTO articles (id, edition_date, position, image_urls)
                   VALUES ('art-live', '1955-03-23', 1, $1)`,
            params: [JSON.stringify([`ocr-assets/${H2}.webp`])],
        });
    });

    afterAll(async () => {
        await db.close();
    });

    it("protects the UNION of artifact references and live SELECTs", async () => {
        // The artifact knows H1; only the live database knows H2.
        const registry = makeRegistry(
            [`ocr-assets/${H1}.webp`],
            [{ key: `ocr-assets/${H1}.webp`, size: 40 }],
        );
        const client = createFakeClient({
            objects: [
                { key: `ocr-assets/${H1}.webp`, size: 40 },
                { key: `ocr-assets/${H2}.webp`, size: 41 },
                { key: `ocr-assets/${H9}.webp`, size: 44 },
            ],
        });
        const result = await runGc({ registry, client, liveExecutor: db.executor, log: () => {} });
        expect(result.marked).toEqual([`ocr-assets/${H9}.webp`]);
        expect(result.liveReferenceCount).toBe(1);
        expect(result.protectedCount).toBe(2);
    });
});

describe("apply gating and grace-ledger CAS", () => {
    const OLD_TS = Date.now() - 40 * DAY_MS;

    function staleWorld() {
        const registry = validRegistry();
        const stateV1 = JSON.stringify({
            schema_version: 1,
            unreferenced_since: { [`ocr-assets/${H9}.webp`]: OLD_TS },
        });
        const objects = [
            { key: "1955-03-09/images/photo_1.webp", size: 10 },
            { key: `ocr-assets/${H1}.webp`, size: 40 },
            { key: `ocr-assets/${H9}.webp`, size: 44 },
        ];
        return { registry, stateV1, objects };
    }

    it("refuses --apply without a matching approval token, even in tests", async () => {
        const { registry, objects } = staleWorld();
        const client = createFakeClient({ objects });
        await expect(
            runGc({ registry, client, apply: true, approvalToken: null }),
        ).rejects.toThrow(/approval-token/);
        expect(client.calls.list).toHaveLength(0);
        expect(client.calls.deletes).toHaveLength(0);

        process.env.GC_APPROVAL_TOKEN = "sesame";
        await expect(
            runGc({ registry, client, apply: true, approvalToken: "wrong" }),
        ).rejects.toThrow(/approval-token/);
        expect(client.calls.deletes).toHaveLength(0);
    });

    it("refuses when the state object changes between read and write (no deletes)", async () => {
        process.env.GC_APPROVAL_TOKEN = "sesame";
        const { registry, stateV1, objects } = staleWorld();
        const stateV2 = JSON.stringify({
            schema_version: 1,
            unreferenced_since: {
                [`ocr-assets/${H9}.webp`]: OLD_TS,
                "1958-01-01/images/raced.webp": Date.now(),
            },
        });
        const client = createFakeClient({ objects, stateBodies: [stateV1, stateV2] });
        await expect(
            runGc({ registry, client, apply: true, approvalToken: "sesame", log: () => {} }),
        ).rejects.toThrow(/CAS mismatch/);
        expect(client.calls.deletes).toHaveLength(0);
        expect(client.calls.puts).toHaveLength(0);
    });

    it("deletes stale objects and writes the new state with the previous state's hash", async () => {
        process.env.GC_APPROVAL_TOKEN = "sesame";
        const { registry, stateV1, objects } = staleWorld();
        const client = createFakeClient({ objects, stateBodies: [stateV1] });
        const result = await runGc({
            registry,
            client,
            apply: true,
            approvalToken: "sesame",
            log: () => {},
        });

        expect(result.stale).toEqual([`ocr-assets/${H9}.webp`]);
        expect(result.deletedCount).toBe(1);
        expect(client.calls.deletes).toEqual([[`ocr-assets/${H9}.webp`]]);

        expect(client.calls.puts).toHaveLength(1);
        const put = client.calls.puts[0];
        expect(put.key).toBe(GC_STATE_KEY);
        expect(put.opts.ifMatch).toBe("etag-2");
        const nextState = JSON.parse(put.body);
        expect(nextState.schema_version).toBe(2);
        expect(typeof nextState.previous_state_sha256).toBe("string");
        expect(nextState.previous_state_sha256).toHaveLength(64);
        expect(nextState.unreferenced_since).not.toHaveProperty(`ocr-assets/${H9}.webp`);
    });
});
