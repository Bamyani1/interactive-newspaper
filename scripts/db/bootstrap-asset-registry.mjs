#!/usr/bin/env node

/**
 * Authoritative asset-registry bootstrap (Phase 5 data script).
 *
 * Builds an immutable registry artifact from (a) database image references
 * (articles.image_urls, ads.image_urls, article_images.image_url) and (b) R2
 * listings over BOTH namespaces (legacy `<date>/images/<name>.webp` and
 * content-addressed `ocr-assets/<sha256>.webp`), then optionally applies the
 * registry to the `assets` table of a LOCAL/TEST database.
 *
 * Every command except --apply is READ-ONLY against its target: --collect
 * issues SELECTs only, --list issues R2 List requests only, --build does both
 * and writes a local artifact file. Production use is approval-gated and
 * happens in a later rollout step, never from this phase.
 *
 * Legacy-namespace objects lack source content hashes until they are
 * re-uploaded through the content-addressed pipeline, so they are recorded in
 * the artifact (and protected by GC through their references) but only
 * content-addressed objects receive `assets` rows from --apply.
 *
 * Usage (DATABASE_URL commands additionally require --yes):
 *   node --import tsx scripts/db/bootstrap-asset-registry.mjs --collect --yes
 *   node --import tsx scripts/db/bootstrap-asset-registry.mjs --list
 *   node --import tsx scripts/db/bootstrap-asset-registry.mjs --build --yes [--dir evaluation/assets]
 *   node --import tsx scripts/db/bootstrap-asset-registry.mjs --apply <artifact.json> --yes --i-understand-this-writes
 *
 * Module top level imports Node builtins only, so plain `node` consumers
 * (scripts/db/gc-r2-assets.mjs) can import the pure functions; the .ts
 * interop imports happen lazily inside main().
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HEX64_BASENAME_PATTERN = /^([a-f0-9]{64})(\.webp)?$/;
const CONTENT_KEY_PATTERN = /^ocr-assets\/([a-f0-9]{64})\.webp$/;
const LEGACY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}\/images\/[^/]+$/;
const DATE_SEGMENT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RASTER_EXTENSION_PATTERN = /\.(jpe?g|png|gif|tiff?)$/i;
const DEV_PROXY_PREFIX = "/api/editions/";

export function sha256Hex(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

function unknownReference(raw) {
    return { namespace: "unknown", key: null, editionDate: null, basename: null, raw };
}

function contentReference(raw, hash, editionDate = null) {
    return {
        namespace: "content",
        key: `ocr-assets/${hash}.webp`,
        editionDate,
        basename: `${hash}.webp`,
        raw,
    };
}

/**
 * Parses one stored image URL/path into its R2 identity.
 *
 * Accepted legacy forms (all normalize to key `<date>/images/<name>.webp`):
 *   `<date>/images/<name>`, full IMAGE_BASE_URL-prefixed URLs whose path ends
 *   in `<date>/images/<name>`, and the dev proxy form
 *   `/api/editions/<date>/images/<name>`. Raster extensions are normalized to
 *   .webp exactly as the upload pipeline does.
 *
 * Accepted content-addressed forms (all normalize to key
 * `ocr-assets/<sha256>.webp`): `ocr-assets/<64hex>.webp`, URL-prefixed
 * variants, bare `<64hex>[.webp]`, `images/<64hex>[.webp]`, and any legacy
 * form whose basename is a bare 64-hex hash.
 *
 * Anything unparseable returns namespace "unknown" with key null — kept and
 * reported, never dropped.
 */
export function parseImageReference(raw) {
    if (typeof raw !== "string" || raw.trim() === "") {
        return unknownReference(typeof raw === "string" ? raw : String(raw ?? ""));
    }
    const value = raw.trim();

    let refPath;
    if (/^https?:\/\//i.test(value)) {
        try {
            refPath = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "");
        } catch {
            return unknownReference(value);
        }
    } else if (value.startsWith(DEV_PROXY_PREFIX)) {
        try {
            refPath = decodeURIComponent(value.slice(DEV_PROXY_PREFIX.length));
        } catch {
            return unknownReference(value);
        }
    } else if (value.includes("://") || value.startsWith("/")) {
        return unknownReference(value);
    } else {
        refPath = value;
    }

    const contentMatch = CONTENT_KEY_PATTERN.exec(refPath);
    if (contentMatch) return contentReference(value, contentMatch[1]);

    const segments = refPath.split("/").filter((segment) => segment !== "");
    let editionDate = null;
    let basename = null;
    if (
        segments.length >= 3 &&
        DATE_SEGMENT_PATTERN.test(segments[segments.length - 3]) &&
        segments[segments.length - 2] === "images"
    ) {
        editionDate = segments[segments.length - 3];
        basename = segments[segments.length - 1];
    } else if (segments.length === 2 && segments[0] === "images") {
        basename = segments[1];
    } else if (segments.length === 1) {
        basename = segments[0];
    } else {
        return unknownReference(value);
    }

    const hashMatch = HEX64_BASENAME_PATTERN.exec(basename);
    if (hashMatch) return contentReference(value, hashMatch[1], editionDate);

    if (editionDate) {
        const normalized = basename.replace(RASTER_EXTENSION_PATTERN, ".webp");
        return {
            namespace: "legacy",
            key: `${editionDate}/images/${normalized}`,
            editionDate,
            basename: normalized,
            raw: value,
        };
    }
    return unknownReference(value);
}

function toUrlArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function compareReferences(a, b) {
    if (a.namespace !== b.namespace) return a.namespace < b.namespace ? -1 : 1;
    const aKey = a.key ?? "";
    const bKey = b.key ?? "";
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;
    if (a.raw !== b.raw) return a.raw < b.raw ? -1 : 1;
    return 0;
}

/**
 * Reads every image reference from the database (articles.image_urls,
 * ads.image_urls JSONB arrays; article_images.image_url). Returns a deduped,
 * deterministically sorted list keyed by parsed identity; each entry carries
 * every {table, id} source row that references it. Read-only (SELECTs only).
 */
export async function collectDbReferences(executor) {
    const rawRows = [];
    const articles = await executor.query({
        text: "SELECT id, image_urls FROM articles ORDER BY id",
    });
    for (const row of articles) {
        for (const url of toUrlArray(row.image_urls)) {
            rawRows.push({ raw: url, table: "articles", id: String(row.id) });
        }
    }
    const ads = await executor.query({ text: "SELECT id, image_urls FROM ads ORDER BY id" });
    for (const row of ads) {
        for (const url of toUrlArray(row.image_urls)) {
            rawRows.push({ raw: url, table: "ads", id: String(row.id) });
        }
    }
    const articleImages = await executor.query({
        text: "SELECT id, image_url FROM article_images ORDER BY id",
    });
    for (const row of articleImages) {
        rawRows.push({ raw: row.image_url, table: "article_images", id: String(row.id) });
    }

    const byIdentity = new Map();
    for (const { raw, table, id } of rawRows) {
        const parsed = parseImageReference(raw);
        const identity = parsed.key ?? `unknown:${parsed.raw}`;
        let entry = byIdentity.get(identity);
        if (!entry) {
            entry = { ...parsed, sources: [] };
            byIdentity.set(identity, entry);
        }
        if (!entry.sources.some((source) => source.table === table && source.id === id)) {
            entry.sources.push({ table, id });
        }
    }
    const references = [...byIdentity.values()];
    for (const reference of references) {
        reference.sources.sort(
            (a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id),
        );
    }
    references.sort(compareReferences);
    return references;
}

/** Classifies a raw R2 object key into its namespace. */
export function classifyObjectKey(key) {
    if (CONTENT_KEY_PATTERN.test(key)) return "content";
    if (LEGACY_KEY_PATTERN.test(key)) return "legacy";
    return "other";
}

/**
 * Lists every R2 object across BOTH namespaces via the injected
 * listFn(prefix, continuationToken) -> {objects: [{key, size}], next}.
 *
 * The "" prefix walk returns the legacy `<date>/images/` keys (an
 * implementation that scopes "" with a delimiter yields the date prefixes but
 * not their objects, which is why the explicit "ocr-assets/" pass exists as
 * well); the two passes are deduped by key. Pagination follows `next` until
 * exhausted on each prefix.
 */
export async function listR2Objects(listFn) {
    const byKey = new Map();
    for (const prefix of ["", "ocr-assets/"]) {
        let continuationToken;
        do {
            const page = await listFn(prefix, continuationToken);
            for (const object of page?.objects ?? []) {
                if (!object || typeof object.key !== "string") continue;
                if (!byKey.has(object.key)) {
                    byKey.set(object.key, {
                        key: object.key,
                        size: typeof object.size === "number" ? object.size : null,
                        namespace: classifyObjectKey(object.key),
                    });
                }
            }
            continuationToken = page?.next || undefined;
        } while (continuationToken);
    }
    return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export const REGISTRY_HASH_RECIPE =
    "sha256 hex digest of JSON.stringify(canonical, null, 2) where canonical is the registry " +
    "with fields in the fixed order {schemaVersion, hashRecipe, generatedAt, matchedCount, " +
    "references, objects, orphanObjects, missingObjects, unknownReferences, sha256}, " +
    "generatedAt and sha256 both replaced by null, references sorted by (namespace, key, raw) " +
    "with sources sorted by (table, id), objects sorted by key, and the derived key lists " +
    "sorted lexicographically";

/**
 * Canonical JSON for self-hashing. `generatedAt` and `sha256` are normalized
 * to null so the hash is stable across regeneration times, and the field
 * order is fixed regardless of how the input object was constructed.
 */
export function canonicalRegistryJson(registry) {
    return JSON.stringify(
        {
            schemaVersion: registry.schemaVersion,
            hashRecipe: registry.hashRecipe,
            generatedAt: null,
            matchedCount: registry.matchedCount,
            references: registry.references,
            objects: registry.objects,
            orphanObjects: registry.orphanObjects,
            missingObjects: registry.missingObjects,
            unknownReferences: registry.unknownReferences,
            sha256: null,
        },
        null,
        2,
    );
}

export function registrySha256(registry) {
    return sha256Hex(canonicalRegistryJson(registry));
}

export function verifyRegistry(registry) {
    const actual = registrySha256(registry);
    const expected = registry?.sha256 ?? null;
    return { ok: actual === expected, expected, actual };
}

/**
 * Joins DB references and R2 objects into the registry document.
 * `generatedAt` is left null (the CLI stamps it before writing; the self-hash
 * deliberately excludes it, see REGISTRY_HASH_RECIPE).
 *
 * orphanObjects covers legacy/content-namespace R2 keys with zero references
 * ("other" keys such as the GC state object are listed in `objects` but are
 * infrastructure, not orphaned assets); missingObjects covers referenced keys
 * absent from R2; unknownReferences carries every unparseable raw reference.
 */
export function buildRegistry({ references, objects }) {
    const sortedReferences = [...references]
        .map((reference) => ({
            namespace: reference.namespace,
            key: reference.key ?? null,
            editionDate: reference.editionDate ?? null,
            basename: reference.basename ?? null,
            raw: reference.raw,
            sources: [...(reference.sources ?? [])]
                .map((source) => ({ table: source.table, id: source.id }))
                .sort((a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id)),
        }))
        .sort(compareReferences);
    const sortedObjects = [...objects]
        .map((object) => ({
            key: object.key,
            size: typeof object.size === "number" ? object.size : null,
            namespace: object.namespace ?? classifyObjectKey(object.key),
        }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const objectKeys = new Set(sortedObjects.map((object) => object.key));
    const referencedKeys = new Set(
        sortedReferences.filter((reference) => reference.key !== null).map((r) => r.key),
    );
    const matchedCount = [...referencedKeys].filter((key) => objectKeys.has(key)).length;
    const orphanObjects = sortedObjects
        .filter((object) => object.namespace !== "other" && !referencedKeys.has(object.key))
        .map((object) => object.key);
    const missingObjects = [...referencedKeys].filter((key) => !objectKeys.has(key)).sort();
    const unknownReferences = sortedReferences
        .filter((reference) => reference.namespace === "unknown")
        .map((reference) => reference.raw)
        .sort();

    const registry = {
        schemaVersion: 1,
        hashRecipe: REGISTRY_HASH_RECIPE,
        generatedAt: /** @type {string | null} */ (null),
        matchedCount,
        references: sortedReferences,
        objects: sortedObjects,
        orphanObjects,
        missingObjects,
        unknownReferences,
        sha256: /** @type {string | null} */ (null),
    };
    registry.sha256 = registrySha256(registry);
    return registry;
}

function registrySummaryMarkdown(registry, jsonFileName) {
    const count = (namespace) =>
        registry.objects.filter((object) => object.namespace === namespace).length;
    return [
        `# Asset registry ${registry.sha256.slice(0, 16)}`,
        "",
        `Artifact: \`${jsonFileName}\` (schema v${registry.schemaVersion}); canonical sha256 \`${registry.sha256}\`.`,
        "",
        `- References: ${registry.references.length} (unknown: ${registry.unknownReferences.length})`,
        `- R2 objects: ${registry.objects.length} (content: ${count("content")}, legacy: ${count("legacy")}, other: ${count("other")})`,
        `- Matched referenced keys: ${registry.matchedCount}`,
        `- Orphan objects (in R2, zero references): ${registry.orphanObjects.length}`,
        `- Missing objects (referenced, absent from R2): ${registry.missingObjects.length}`,
        "",
        "Legacy-namespace objects lack source content hashes until re-uploaded through the",
        "content-addressed pipeline; they are recorded here but only content-addressed",
        "objects receive `assets` rows on apply.",
        "",
    ].join("\n");
}

/**
 * Writes `registry-<first16-of-sha256>.json` plus a `.md` summary into `dir`.
 * Artifacts are immutable: an existing file whose canonical content differs
 * from what would be written causes a refusal; identical content is a no-op.
 */
export function writeRegistryArtifact(registry, dir = "evaluation/assets") {
    const verdict = verifyRegistry(registry);
    if (!verdict.ok) {
        throw new Error(
            `Refusing to write artifact: registry self-hash mismatch (expected ${verdict.expected}, computed ${verdict.actual})`,
        );
    }
    mkdirSync(dir, { recursive: true });
    const short = registry.sha256.slice(0, 16);
    const jsonFileName = `registry-${short}.json`;
    const jsonPath = path.join(dir, jsonFileName);
    const mdPath = path.join(dir, `registry-${short}.md`);
    const jsonBody = `${JSON.stringify(registry, null, 2)}\n`;
    const mdBody = registrySummaryMarkdown(registry, jsonFileName);

    if (existsSync(jsonPath)) {
        let existing = null;
        try {
            existing = JSON.parse(readFileSync(jsonPath, "utf8"));
        } catch {
            existing = null;
        }
        if (
            existing === null ||
            existing.sha256 !== registry.sha256 ||
            registrySha256(existing) !== registry.sha256
        ) {
            throw new Error(
                `Refusing to overwrite existing artifact with different content: ${jsonPath}`,
            );
        }
        return { jsonPath, mdPath, created: false };
    }
    writeFileSync(jsonPath, jsonBody);
    writeFileSync(mdPath, mdBody);
    return { jsonPath, mdPath, created: true };
}

/**
 * Inserts `assets` rows for every content-addressed object in the registry
 * (sha256 taken from the content-addressed basename). Legacy-namespace
 * objects are skipped: they lack source hashes until re-uploaded, so they
 * live only in the artifact. Idempotent via ON CONFLICT DO NOTHING.
 */
export async function applyRegistry(executor, registry) {
    const verdict = verifyRegistry(registry);
    if (!verdict.ok) {
        throw new Error(
            `Refusing to apply registry: self-hash mismatch (expected ${verdict.expected}, computed ${verdict.actual})`,
        );
    }
    let inserted = 0;
    let alreadyPresent = 0;
    let skippedLegacy = 0;
    let skippedOther = 0;
    for (const object of registry.objects) {
        if (object.namespace === "legacy") {
            skippedLegacy += 1;
            continue;
        }
        if (object.namespace !== "content") {
            skippedOther += 1;
            continue;
        }
        const hash = CONTENT_KEY_PATTERN.exec(object.key)[1];
        const rows = await executor.query({
            text: `INSERT INTO assets (sha256, byte_count, mime_type, storage_key, legacy_key)
                   VALUES ($1, $2, 'image/webp', $3, NULL)
                   ON CONFLICT (sha256) DO NOTHING
                   RETURNING sha256`,
            params: [hash, object.size ?? 0, object.key],
        });
        if (rows.length > 0) inserted += 1;
        else alreadyPresent += 1;
    }
    return { inserted, alreadyPresent, skippedLegacy, skippedOther };
}

function fail(message) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

const R2_ENV_VARS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];

async function createR2ListFn() {
    const missing = R2_ENV_VARS.filter((name) => !process.env[name]);
    if (missing.length) fail(`Missing R2 configuration: ${missing.join(", ")}`);
    const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
    return async (prefix, continuationToken) => {
        const page = await s3.send(
            new ListObjectsV2Command({
                Bucket: process.env.R2_BUCKET_NAME,
                Prefix: prefix || undefined,
                ContinuationToken: continuationToken,
            }),
        );
        return {
            objects: (page.Contents ?? []).map((object) => ({
                key: object.Key,
                size: object.Size ?? null,
            })),
            next: page.IsTruncated ? page.NextContinuationToken : undefined,
        };
    };
}

async function createDbExecutor() {
    if (!process.env.DATABASE_URL) fail("DATABASE_URL is required for this command.");
    if (!process.argv.includes("--yes")) {
        fail(
            "This phase authorizes local/test databases only. Re-run with --yes to confirm the target database is not production.",
        );
    }
    const runnerModule = await import("./lib/migration-runner.ts");
    const { assertMigrationsCurrent } = runnerModule.default ?? runnerModule;
    const executorModule = await import("./lib/neon-executor.ts");
    const { createNeonExecutor } = executorModule.default ?? executorModule;
    const executor = createNeonExecutor(process.env.DATABASE_URL);
    await assertMigrationsCurrent(executor);
    return executor;
}

async function main() {
    const { values } = parseArgs({
        options: {
            collect: { type: "boolean", default: false },
            list: { type: "boolean", default: false },
            build: { type: "boolean", default: false },
            apply: { type: "string" },
            dir: { type: "string", default: "evaluation/assets" },
            yes: { type: "boolean", default: false },
            "i-understand-this-writes": { type: "boolean", default: false },
        },
        strict: true,
    });

    const localEnvModule = await import("../lib/local-env.ts");
    const { loadLocalEnv } = localEnvModule.default ?? localEnvModule;
    loadLocalEnv();

    console.log(
        "bootstrap-asset-registry: READ-ONLY against the target (database SELECTs and R2 List requests only; --apply is the sole writing command and writes only `assets` rows).",
    );
    console.log(
        "Production use is approval-gated and happens in a later rollout step; this phase authorizes local/test targets only.",
    );

    if (values.collect) {
        const executor = await createDbExecutor();
        const references = await collectDbReferences(executor);
        console.log(JSON.stringify({ references }, null, 2));
        return;
    }

    if (values.list) {
        const listFn = await createR2ListFn();
        const objects = await listR2Objects(listFn);
        console.log(JSON.stringify({ objects }, null, 2));
        return;
    }

    if (values.build) {
        const executor = await createDbExecutor();
        const listFn = await createR2ListFn();
        const references = await collectDbReferences(executor);
        const objects = await listR2Objects(listFn);
        const registry = buildRegistry({ references, objects });
        registry.generatedAt = new Date().toISOString();
        const result = writeRegistryArtifact(registry, values.dir);
        console.log(
            JSON.stringify(
                {
                    created: result.created,
                    jsonPath: result.jsonPath,
                    mdPath: result.mdPath,
                    sha256: registry.sha256,
                    references: registry.references.length,
                    objects: registry.objects.length,
                    matchedCount: registry.matchedCount,
                    orphanObjects: registry.orphanObjects.length,
                    missingObjects: registry.missingObjects.length,
                    unknownReferences: registry.unknownReferences.length,
                },
                null,
                2,
            ),
        );
        return;
    }

    if (values.apply) {
        if (!values["i-understand-this-writes"]) {
            fail("--apply writes assets rows; re-run with --i-understand-this-writes to confirm.");
        }
        const registry = JSON.parse(readFileSync(values.apply, "utf8"));
        const executor = await createDbExecutor();
        const result = await applyRegistry(executor, registry);
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    fail("One of --collect, --list, --build, --apply <artifact.json> is required.");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
