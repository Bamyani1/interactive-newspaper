#!/usr/bin/env node

/**
 * Registry-driven R2 lifecycle GC. Dry-run unless --apply is supplied.
 *
 * GC NEVER runs in the Phase 9 rollout: --apply additionally requires
 * --approval-token <value> matching env GC_APPROVAL_TOKEN, and no token is
 * issued during this rollout. Dry-run remains the default and the
 * mark-then-delete two-phase design with a --grace-days floor of 30 is
 * unchanged.
 *
 * Reference set (belt and braces): a registry artifact produced by
 * scripts/db/bootstrap-asset-registry.mjs is REQUIRED (--registry <path>,
 * self-hash verified) and, when DATABASE_URL is present, live database
 * SELECTs are cross-checked via collectDbReferences; the protected set is the
 * UNION of both. The run refuses when the artifact's self-hash does not
 * verify, when it contains zero references, or when its missingObjects list
 * is non-empty (a registry that already knows of missing referenced objects
 * means the world changed after it was generated — regenerate first).
 *
 * Both namespaces are protected AND collected: candidate listing covers the
 * content-addressed `ocr-assets/<sha256>.webp` keys and the legacy
 * `<date>/images/<name>` keys; a key matching a protected reference in either
 * layout is never marked.
 *
 * Grace-ledger CAS: R2 support for conditional PUT (IfMatch) is uncertain, so
 * the PRIMARY mechanism is a hash compare-and-swap — the state object is read
 * once up front, re-read immediately before any destructive step, and the run
 * refuses (no deletes, no state write) when the two reads differ; the new
 * state embeds the sha256 of the state it replaces. When the read exposed an
 * ETag the PUT additionally carries IfMatch as a best-effort extra guard; a
 * client that rejects IfMatch falls back to the unconditional PUT already
 * guarded by the hash check.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const registryModule = await import("./bootstrap-asset-registry.mjs");
const { collectDbReferences, verifyRegistry } = registryModule.default ?? registryModule;

export const GC_STATE_KEY = "ocr-assets-gc/unreferenced.json";
const CONTENT_KEY_PATTERN = /^ocr-assets\/[a-f0-9]{64}\.webp$/;
const LEGACY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}\/images\/[^/]+$/;

function sha256Hex(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Refuses any registry that is unusable as a GC reference source. */
export function assertRegistryUsable(registry) {
    if (!registry || typeof registry !== "object") {
        throw new Error("Refusing R2 GC: a registry artifact is required (--registry <path>)");
    }
    const verdict = verifyRegistry(registry);
    if (!verdict.ok) {
        throw new Error(
            `Refusing R2 GC: registry self-hash does not verify (expected ${verdict.expected}, computed ${verdict.actual})`,
        );
    }
    if (!Array.isArray(registry.references) || registry.references.length === 0) {
        throw new Error("Refusing R2 GC: registry contains zero references");
    }
    if (Array.isArray(registry.missingObjects) && registry.missingObjects.length > 0) {
        throw new Error(
            `Refusing R2 GC: registry records ${registry.missingObjects.length} referenced object(s) missing from R2; the world changed since it was generated — regenerate the registry first`,
        );
    }
}

export function loadRegistryArtifact(artifactPath) {
    let registry;
    try {
        registry = JSON.parse(readFileSync(artifactPath, "utf8"));
    } catch (error) {
        throw new Error(
            `Refusing R2 GC: could not read registry artifact ${artifactPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    assertRegistryUsable(registry);
    return registry;
}

/** UNION of artifact reference keys and live-DB reference keys. */
export function protectedKeySet(registry, liveReferences = []) {
    const keys = new Set();
    for (const reference of registry.references ?? []) {
        if (reference.key) keys.add(reference.key);
    }
    for (const reference of liveReferences) {
        if (reference.key) keys.add(reference.key);
    }
    return keys;
}

async function readGcState(client) {
    let object = null;
    try {
        object = await client.get(GC_STATE_KEY);
    } catch (error) {
        if (
            error?.name !== "NoSuchKey" &&
            error?.name !== "NotFound" &&
            error?.$metadata?.httpStatusCode !== 404
        ) {
            throw error;
        }
    }
    if (!object || typeof object.body !== "string") {
        return { state: { schema_version: 1, unreferenced_since: {} }, sha: null, etag: null };
    }
    let state = { schema_version: 1, unreferenced_since: {} };
    const parsed = JSON.parse(object.body);
    if (parsed && typeof parsed.unreferenced_since === "object") state = parsed;
    return { state, sha: sha256Hex(object.body), etag: object.etag ?? null };
}

async function putGcState(client, body, etag) {
    const options = {
        contentType: "application/json",
        cacheControl: "no-store",
        ifMatch: etag ?? undefined,
    };
    try {
        await client.put(GC_STATE_KEY, body, options);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Fallback (documented in the header): the hash CAS above is the
        // primary guard; IfMatch is best-effort only, so a client that
        // rejects the conditional header gets an unconditional PUT.
        if (options.ifMatch && (error?.name === "NotImplemented" || /IfMatch|precondition/i.test(message))) {
            await client.put(GC_STATE_KEY, body, {
                contentType: options.contentType,
                cacheControl: options.cacheControl,
            });
            return;
        }
        throw error;
    }
}

/**
 * Core GC pass with an injectable client:
 *   client.list(prefix, token) -> { objects: [{key, size}], next }
 *   client.get(key)            -> { body, etag } | null
 *   client.put(key, body, { contentType, cacheControl, ifMatch }) -> void
 *   client.deleteObjects(keys) -> { errors: [{key, message}] }
 */
export async function runGc({
    registry,
    client,
    apply = false,
    graceDays = 30,
    approvalToken = /** @type {string | null} */ (null),
    liveExecutor = /** @type {*} */ (null),
    now = () => Date.now(),
    log = console.log,
}) {
    if (!Number.isFinite(graceDays) || graceDays < 30) {
        throw new Error("--grace-days must be an integer of at least 30");
    }
    assertRegistryUsable(registry);
    if (apply) {
        const expected = process.env.GC_APPROVAL_TOKEN;
        if (!expected || approvalToken !== expected) {
            throw new Error(
                "Refusing R2 GC --apply: --approval-token must match env GC_APPROVAL_TOKEN. GC never runs in the Phase 9 rollout.",
            );
        }
    }

    const liveReferences = liveExecutor ? await collectDbReferences(liveExecutor) : [];
    const protectedKeys = protectedKeySet(registry, liveReferences);
    if (protectedKeys.size === 0) {
        throw new Error("Refusing R2 GC: the protected reference set is empty");
    }

    const initial = await readGcState(client);
    const previousState = initial.state;

    // Candidate listing over BOTH namespaces. The "" walk covers the legacy
    // `<date>/images/` keys; the explicit "ocr-assets/" pass is belt and
    // braces for clients that scope "" listings; results are deduped by key.
    const seen = new Set();
    const candidates = [];
    let ignoredObjectCount = 0;
    for (const prefix of ["", "ocr-assets/"]) {
        let continuationToken;
        do {
            const page = await client.list(prefix, continuationToken);
            for (const object of page?.objects ?? []) {
                const key = object?.key;
                if (typeof key !== "string" || seen.has(key)) continue;
                seen.add(key);
                if (key === GC_STATE_KEY) continue;
                if (!CONTENT_KEY_PATTERN.test(key) && !LEGACY_KEY_PATTERN.test(key)) {
                    ignoredObjectCount += 1;
                    continue;
                }
                candidates.push(key);
            }
            continuationToken = page?.next || undefined;
        } while (continuationToken);
    }

    const cutoff = now() - graceDays * 24 * 60 * 60 * 1000;
    const stale = [];
    const newlyUnreferenced = [];
    const nextUnreferenced = {};
    for (const key of candidates) {
        if (protectedKeys.has(key)) continue;
        const prior = Number(previousState.unreferenced_since?.[key]);
        const hasPrior = Number.isFinite(prior) && prior > 0;
        const unreferencedSince = hasPrior ? prior : now();
        nextUnreferenced[key] = unreferencedSince;
        if (!hasPrior) newlyUnreferenced.push(key);
        if (unreferencedSince <= cutoff) stale.push(key);
    }

    for (const key of newlyUnreferenced) log(`${apply ? "MARK" : "WOULD_MARK"} ${key}`);
    for (const key of stale) log(`${apply ? "DELETE" : "STALE"} ${key}`);

    let deletedCount = 0;
    if (apply) {
        // Hash CAS: refuse BEFORE any delete when the ledger changed between
        // the initial read and now (another writer raced this run).
        const recheck = await readGcState(client);
        if (recheck.sha !== initial.sha) {
            throw new Error(
                "Refusing R2 GC: grace-ledger state object changed between read and write (CAS mismatch); no objects were deleted — re-run",
            );
        }

        for (let index = 0; index < stale.length; index += 1000) {
            const batch = stale.slice(index, index + 1000);
            const result = await client.deleteObjects(batch);
            const failed = new Set(
                (result?.errors ?? []).map((item) => item.key).filter(Boolean),
            );
            for (const key of batch) {
                if (!failed.has(key)) {
                    delete nextUnreferenced[key];
                    deletedCount += 1;
                }
            }
            if (failed.size) {
                throw new Error(`R2 refused to delete ${failed.size} stale object(s)`);
            }
        }

        const body = `${JSON.stringify(
            {
                schema_version: 2,
                updated_at: new Date(now()).toISOString(),
                previous_state_sha256: recheck.sha,
                unreferenced_since: nextUnreferenced,
            },
            null,
            2,
        )}\n`;
        await putGcState(client, body, recheck.etag);
    }

    log(
        `${apply ? "Deleted" : "Would delete"} ${stale.length} globally unreferenced object(s); ${protectedKeys.size} referenced key(s) protected; ${ignoredObjectCount} non-asset key(s) ignored.`,
    );
    return {
        marked: newlyUnreferenced,
        stale,
        deletedCount,
        protectedCount: protectedKeys.size,
        ignoredObjectCount,
        liveReferenceCount: liveReferences.length,
    };
}

async function createS3GcClient() {
    const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) throw new Error(`Missing R2 configuration: ${missing.join(", ")}`);
    const {
        S3Client,
        DeleteObjectsCommand,
        GetObjectCommand,
        ListObjectsV2Command,
        PutObjectCommand,
    } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    });
    const bucket = process.env.R2_BUCKET_NAME;
    return {
        async list(prefix, continuationToken) {
            const page = await s3.send(
                new ListObjectsV2Command({
                    Bucket: bucket,
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
        },
        async get(key) {
            const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            return { body: await response.Body.transformToString(), etag: response.ETag ?? null };
        },
        async put(key, body, options = {}) {
            await s3.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: body,
                    ContentType: options.contentType,
                    CacheControl: options.cacheControl,
                    ...(options.ifMatch ? { IfMatch: options.ifMatch } : {}),
                }),
            );
        },
        async deleteObjects(keys) {
            const response = await s3.send(
                new DeleteObjectsCommand({
                    Bucket: bucket,
                    Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
                }),
            );
            return {
                errors: (response.Errors ?? []).map((item) => ({
                    key: item.Key,
                    message: item.Message,
                })),
            };
        },
    };
}

async function main() {
    const { values } = parseArgs({
        options: {
            apply: { type: "boolean", default: false },
            registry: { type: "string" },
            "approval-token": { type: "string" },
            "grace-days": { type: "string", default: "30" },
        },
        strict: true,
    });
    const graceDays = Number.parseInt(values["grace-days"], 10);
    if (!Number.isFinite(graceDays) || graceDays < 30) {
        throw new Error("--grace-days must be an integer of at least 30");
    }
    if (!values.registry) {
        throw new Error(
            "Refusing R2 GC: --registry <path> is required (generate one with npm run assets:bootstrap -- --build)",
        );
    }

    console.log("R2 GC — Phase 9 rollout: GC NEVER runs in this rollout.");
    console.log(
        "--apply requires --approval-token matching env GC_APPROVAL_TOKEN, and no token is issued during Phase 9; dry-run is the default.",
    );

    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const envPath = path.join(root, ".env.local");
    if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, "utf8").split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const at = trimmed.indexOf("=");
            if (at < 1) continue;
            const name = trimmed.slice(0, at);
            const value = trimmed.slice(at + 1).replace(/^["']|["']$/g, "");
            if (!process.env[name]) process.env[name] = value;
        }
    }

    const registry = loadRegistryArtifact(path.resolve(values.registry));

    let liveExecutor = null;
    if (process.env.DATABASE_URL) {
        let createNeonExecutor;
        try {
            const executorModule = await import("./lib/neon-executor.ts");
            ({ createNeonExecutor } = executorModule.default ?? executorModule);
        } catch (error) {
            throw new Error(
                "DATABASE_URL is set but the live reference cross-check could not load; run with: node --import tsx scripts/db/gc-r2-assets.mjs",
                { cause: error },
            );
        }
        liveExecutor = createNeonExecutor(process.env.DATABASE_URL);
    }

    const client = await createS3GcClient();

    const assetLockParent = path.join(root, "public/editions/.locks");
    const assetLockDir = path.join(assetLockParent, "assets.lock");
    mkdirSync(assetLockParent, { recursive: true });
    try {
        mkdirSync(assetLockDir);
    } catch (error) {
        if (error?.code === "EEXIST") {
            throw new Error("OCR asset publication or another R2 GC run is active");
        }
        throw error;
    }
    let assetLockHeld = true;
    const releaseAssetLock = () => {
        if (!assetLockHeld) return;
        assetLockHeld = false;
        try {
            rmdirSync(assetLockDir);
        } catch (error) {
            if (error?.code !== "ENOENT") throw error;
        }
    };
    process.on("exit", releaseAssetLock);

    try {
        await runGc({
            registry,
            client,
            apply: values.apply,
            graceDays,
            approvalToken: values["approval-token"] ?? null,
            liveExecutor,
        });
    } finally {
        releaseAssetLock();
    }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
