#!/usr/bin/env node
/**
 * Versioned RAG index builder — the build-scoped successor to embed.mjs.
 *
 * FIRST writer of rag_index_builds: no other code anywhere inserts rows into
 * that table (migration 0004 created it empty by design). Every evidence row
 * this tool writes carries index_build_id, so it can never collide with the
 * legacy NULL-build rows embed.mjs maintains (partial uniques
 * uq_article_chunks_build / uq_article_images_build vs uq_*_legacy).
 *
 * Build lifecycle (no --force anywhere — a changed input, model, or version
 * means a NEW build id; builds are immutable once out of 'building'):
 *   --create --corpus <id>       mint a 'building' build, print its id
 *   --populate <buildId>         deterministic chunk/image records (no model calls)
 *   --embed-text <buildId>       batch text embeddings (resumable by exact hash)
 *   --embed-images <buildId>     one-at-a-time image embeddings from R2
 *   --finalize <buildId>         coverage check -> 'validated' or 'failed'
 *   --dry-run [--corpus <id>]    read-only cost/plan report, no writes
 *   --status <buildId>           build row + pending counts
 *
 * All commands require DATABASE_URL and an explicit --yes (this phase
 * authorizes LOCAL/TEST databases only; production access is a later,
 * separately approved step). Exported functions are executor-injectable and
 * take embedFn/fetchObject params so tests drive them against PGlite with
 * fakes; main() wires the real embedDocuments and an R2 GetObject client.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // refuse absurd objects; images are <500KiB by policy
const FALLBACK_IMAGE_CAPTION = "Untitled archival newspaper image";

// Neon HTTP responses cap at 64 MiB and each round-trip costs ~150-300ms, so
// large table reads use keyset pagination and inserts use multi-row VALUES
// statements grouped into transactionBatch calls (one HTTP request each).
const ARTICLE_PAGE_SIZE = 500; // article rows carry full bodies
const ALIAS_PAGE_SIZE = 5000; // legacy_content_aliases rows are tiny
const PENDING_CHUNK_PAGE_SIZE = 1000; // chunk rows are <= ~3.2KB of text each
const CHUNK_INSERT_ROWS = 150; // article_chunks rows carry chunk text
const IMAGE_INSERT_ROWS = 500; // article_images rows are small
const STATEMENTS_PER_BATCH = 12;

function chunkArray(items, size) {
    const chunks = [];
    for (let offset = 0; offset < items.length; offset += size) {
        chunks.push(items.slice(offset, offset + size));
    }
    return chunks;
}

/** Builds one multi-row `INSERT ... VALUES (...), (...) <suffix>` statement. */
function multiRowInsert(prefix, rows, suffix) {
    const params = [];
    const tuples = rows.map((row) => {
        const placeholders = row.map((value) => {
            params.push(value);
            return `$${params.length}`;
        });
        return `(${placeholders.join(", ")})`;
    });
    return { text: `${prefix} VALUES ${tuples.join(", ")} ${suffix}`, params };
}

/** Keyset-paginated read of the article columns the chunk/image plans need. */
async function readArticlesPaged(executor, columns, pageSize, onPage) {
    let lastId = null;
    for (;;) {
        const pageRows = await executor.query({
            text: `SELECT ${columns}
                   FROM articles
                   ${lastId === null ? "" : "WHERE id > $1"}
                   ORDER BY id
                   LIMIT ${pageSize}`,
            params: lastId === null ? [] : [lastId],
        });
        await onPage(pageRows);
        if (pageRows.length < pageSize) return;
        lastId = String(pageRows[pageRows.length - 1].id);
    }
}

/**
 * @typedef {{ text: string, params?: unknown[] }} SqlStatementLike
 * @typedef {{
 *     query: (stmt: SqlStatementLike) => Promise<Record<string, unknown>[]>,
 *     transactionBatch: (stmts: SqlStatementLike[]) => Promise<void>,
 * }} QueryExecutorLike
 * @typedef {{ text: string, imageBase64?: string, imageMimeType?: string }} EmbedInputLike
 * @typedef {(inputs: EmbedInputLike[], opts?: { op?: string }) => Promise<number[][]>} EmbedFnLike
 * @typedef {(key: string) => Promise<unknown>} FetchObjectLike
 */

// This package compiles .ts to CJS (no "type":"module"), so .ts modules must
// be loaded dynamically and unwrapped via `mod.default ?? mod`; static named
// imports from .mjs fail at runtime.
let _deps = null;
async function loadDeps() {
    if (_deps) return _deps;
    const chunkingMod = await import("../../src/lib/article-chunking.ts");
    const { buildArticleChunkRecords } = chunkingMod.default ?? chunkingMod;
    const embeddingsMod = await import("../../src/lib/embeddings.ts");
    const { buildEmbeddingInput, embeddingInputFingerprint } =
        embeddingsMod.default ?? embeddingsMod;
    const costMod = await import("../../src/lib/cost-tracker.ts");
    const { computeEmbeddingCostUsd } = costMod.default ?? costMod;
    const configMod = await import("../../src/lib/rag-model-config.ts");
    const {
        RAG_EMBEDDING_MODEL,
        RAG_PIPELINE_VERSION,
        RAG_TEXT_EMBEDDING_INPUT_VERSION,
        RAG_IMAGE_EMBEDDING_INPUT_VERSION,
    } = configMod.default ?? configMod;
    const ulidMod = await import("../../src/server/identity/ulid.ts");
    const { ulid } = ulidMod.default ?? ulidMod;
    _deps = {
        buildArticleChunkRecords,
        buildEmbeddingInput,
        embeddingInputFingerprint,
        computeEmbeddingCostUsd,
        RAG_EMBEDDING_MODEL,
        RAG_PIPELINE_VERSION,
        RAG_TEXT_EMBEDDING_INPUT_VERSION,
        RAG_IMAGE_EMBEDDING_INPUT_VERSION,
        ulid,
    };
    return _deps;
}

function jsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function vectorLiteral(values) {
    if (!Array.isArray(values)) throw new Error("embedFn must return numeric vectors");
    return `[${values.map(Number).join(",")}]`;
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/** Synthetic EmbedContentResponse so pricing always flows through the cost tracker. */
function syntheticEmbeddingResponse(tokenCount) {
    return { embeddings: [{ statistics: { tokenCount } }] };
}

export async function getBuild(executor, buildId) {
    const rows = await executor.query({
        text: "SELECT * FROM rag_index_builds WHERE id = $1",
        params: [buildId],
    });
    return rows[0] ?? null;
}

async function requireBuildingBuild(executor, buildId) {
    const build = await getBuild(executor, buildId);
    if (!build) throw new Error(`Unknown index build ${buildId}.`);
    if (build.status !== "building") {
        throw new Error(
            `Index build ${buildId} is '${build.status}'; builds are immutable once out of ` +
                `'building'. There is no --force — create a new build instead.`,
        );
    }
    return build;
}

/**
 * Mint a new immutable index-build identity in status 'building'.
 * Default id is `build-<ULID>`. Duplicate ids throw (no upsert): identity
 * rows are immutable, so re-creating means minting a NEW id.
 */
export async function createIndexBuild(executor, options = {}) {
    const {
        buildId,
        corpusVersion,
        pipelineVersion,
        embeddingModel,
        textInputVersion,
        imageInputVersion,
    } = options;
    for (const [name, value] of [
        ["corpusVersion", corpusVersion],
        ["pipelineVersion", pipelineVersion],
        ["embeddingModel", embeddingModel],
        ["textInputVersion", textInputVersion],
        ["imageInputVersion", imageInputVersion],
    ]) {
        if (!value) throw new Error(`createIndexBuild requires ${name}.`);
    }
    const deps = await loadDeps();
    const id = buildId ?? `build-${deps.ulid()}`;
    await executor.query({
        text: `INSERT INTO rag_index_builds
                   (id, corpus_version, status, pipeline_version, embedding_model,
                    text_embedding_input_version, image_embedding_input_version)
               VALUES ($1, $2, 'building', $3, $4, $5, $6)`,
        params: [id, corpusVersion, pipelineVersion, embeddingModel, textInputVersion, imageInputVersion],
    });
    return id;
}

/**
 * Deterministic, resumable record population for one build (no model calls).
 *
 * Chunk rows: id `{buildId}:{articleId}:{paddedChunkIndex}` with the exact
 * embedding_input_hash from buildArticleChunkRecords. Image rows: id
 * `{buildId}:{articleId}:image:{padded3}`; embedding_input_hash stays NULL
 * until embed time because the image hash covers the object BYTES, which are
 * not available here. content_revision_id comes from legacy_content_aliases
 * (legacy_id = article id); articles without an alias get NULL — documented:
 * legacy-only articles are still indexable, they simply have no revision key.
 *
 * Every INSERT is ON CONFLICT (id) DO NOTHING, so re-running after a crash
 * converges without rewriting existing rows. Returned counts are the planned
 * record totals for the build (equal to inserted rows on a clean first run).
 *
 * batchSize is the keyset page of articles read (and written) per iteration;
 * inserts are multi-row VALUES statements grouped into transactionBatch calls.
 */
export async function populateBuildRecords(executor, buildId, { batchSize = ARTICLE_PAGE_SIZE } = {}) {
    const deps = await loadDeps();
    await requireBuildingBuild(executor, buildId);

    // Alias map in one keyset-paginated pass (rows are tiny but unbounded).
    const revisionByLegacyId = new Map();
    let lastAliasId = null;
    for (;;) {
        const aliasRows = await executor.query({
            text: `SELECT legacy_id, content_revision_id FROM legacy_content_aliases
                   ${lastAliasId === null ? "" : "WHERE legacy_id > $1"}
                   ORDER BY legacy_id
                   LIMIT ${ALIAS_PAGE_SIZE}`,
            params: lastAliasId === null ? [] : [lastAliasId],
        });
        for (const row of aliasRows) {
            revisionByLegacyId.set(String(row.legacy_id), row.content_revision_id ?? null);
        }
        if (aliasRows.length < ALIAS_PAGE_SIZE) break;
        lastAliasId = String(aliasRows[aliasRows.length - 1].legacy_id);
    }

    let articleCount = 0;
    let chunkCount = 0;
    let imageCount = 0;

    await readArticlesPaged(
        executor,
        `id, headline, byline, body_plain, edition_date, category, summary,
                          image_urls, image_caption, image_captions`,
        batchSize,
        async (articles) => {
            articleCount += articles.length;
            const chunkRows = [];
            const imageRows = [];

            for (const article of articles) {
                const articleId = String(article.id);
                const contentRevisionId = revisionByLegacyId.get(articleId) ?? null;

                const chunkRecords = deps.buildArticleChunkRecords({
                    id: articleId,
                    headline: article.headline,
                    byline: article.byline,
                    body_plain: article.body_plain,
                    edition_date: article.edition_date,
                    category: article.category,
                    summary: article.summary,
                });
                for (const record of chunkRecords) {
                    chunkRows.push([
                        `${buildId}:${record.id}`,
                        buildId,
                        articleId,
                        record.chunkIndex,
                        record.chunkText,
                        record.embeddingInputHash,
                        contentRevisionId,
                    ]);
                }
                chunkCount += chunkRecords.length;

                const imageUrls = jsonArray(article.image_urls);
                const imageCaptions = jsonArray(article.image_captions);
                imageUrls.forEach((imageUrl, imageIndex) => {
                    const caption =
                        imageCaptions[imageIndex] ??
                        (imageIndex === 0 ? article.image_caption : null);
                    imageRows.push([
                        `${buildId}:${articleId}:image:${String(imageIndex).padStart(3, "0")}`,
                        buildId,
                        articleId,
                        imageIndex,
                        imageUrl,
                        caption ?? null,
                        contentRevisionId,
                    ]);
                });
                imageCount += imageUrls.length;
            }

            const statements = [];
            for (const rows of chunkArray(chunkRows, CHUNK_INSERT_ROWS)) {
                statements.push(
                    multiRowInsert(
                        `INSERT INTO article_chunks
                             (id, index_build_id, article_id, chunk_index, chunk_text,
                              embedding_input_hash, content_revision_id)`,
                        rows,
                        "ON CONFLICT (id) DO NOTHING",
                    ),
                );
            }
            for (const rows of chunkArray(imageRows, IMAGE_INSERT_ROWS)) {
                statements.push(
                    multiRowInsert(
                        `INSERT INTO article_images
                             (id, index_build_id, article_id, image_index, image_url,
                              caption, content_revision_id)`,
                        rows,
                        "ON CONFLICT (id) DO NOTHING",
                    ),
                );
            }
            for (const group of chunkArray(statements, STATEMENTS_PER_BATCH)) {
                await executor.transactionBatch(group);
            }
        },
    );

    return { articles: articleCount, chunks: chunkCount, images: imageCount };
}

function chunkTextInput(deps, row) {
    return deps.buildEmbeddingInput({
        headline: row.headline,
        byline: row.byline,
        body_plain: row.chunk_text,
        edition_date: row.edition_date,
        category: row.category,
        summary: Number(row.chunk_index) === 0 ? row.summary : null,
    });
}

/**
 * Text embedding for one build, resumable by exact hash.
 *
 * The pending SELECT is the resumability proof: rows whose
 * (embedding, embedding_model, embedding_input_version) already match the
 * build's expected identity are never re-selected, so they are never
 * re-embedded. Each UPDATE is additionally keyed by embedding_input_hash so a
 * vector can only land on the exact input it was computed for; the stored
 * hash was minted by populateBuildRecords at RAG_TEXT_EMBEDDING_INPUT_VERSION,
 * so a build created with a divergent text input version surfaces as loud
 * per-row hash-mismatch failures instead of silently mixing versions.
 *
 * A failed batch records {id, reason} per row and CONTINUES with the next
 * batch — one bad batch never aborts the run.
 *
 * @param {QueryExecutorLike} executor
 * @param {string} buildId
 * @param {{ embedFn?: EmbedFnLike, batchSize?: number }} [options]
 */
export async function embedBuildText(executor, buildId, { embedFn, batchSize = 50 } = {}) {
    if (typeof embedFn !== "function") throw new Error("embedBuildText requires an embedFn.");
    const deps = await loadDeps();
    const build = await requireBuildingBuild(executor, buildId);
    const expectedModel = String(build.embedding_model);
    const expectedVersion = String(build.text_embedding_input_version);

    const totalRows = await executor.query({
        text: "SELECT count(*)::int AS n FROM article_chunks WHERE index_build_id = $1",
        params: [buildId],
    });
    const total = Number(totalRows[0].n);

    // Keyset-paginated pending read (chunk text over a whole build can exceed
    // the 64 MiB HTTP response cap); collected fully before embedding so the
    // embed batches are cut exactly as before.
    const pending = [];
    let lastPendingId = null;
    for (;;) {
        const pageRows = await executor.query({
            text: `SELECT c.id, c.chunk_index, c.chunk_text, c.embedding_input_hash,
                          a.headline, a.byline, a.edition_date, a.category, a.summary
                   FROM article_chunks c JOIN articles a ON a.id = c.article_id
                   WHERE c.index_build_id = $1
                     AND (c.embedding IS NULL
                          OR c.embedding_model IS DISTINCT FROM $2
                          OR c.embedding_input_version IS DISTINCT FROM $3)
                     ${lastPendingId === null ? "" : "AND c.id > $4"}
                   ORDER BY c.id
                   LIMIT ${PENDING_CHUNK_PAGE_SIZE}`,
            params:
                lastPendingId === null
                    ? [buildId, expectedModel, expectedVersion]
                    : [buildId, expectedModel, expectedVersion, lastPendingId],
        });
        pending.push(...pageRows);
        if (pageRows.length < PENDING_CHUNK_PAGE_SIZE) break;
        lastPendingId = String(pageRows[pageRows.length - 1].id);
    }

    const planned = pending.length;
    const skipped = total - planned;
    const failed = [];
    let embedded = 0;
    let textTokens = 0;

    for (let offset = 0; offset < pending.length; offset += batchSize) {
        const batch = pending.slice(offset, offset + batchSize);
        const inputs = batch.map((row) => chunkTextInput(deps, row));

        let vectors;
        try {
            vectors = await embedFn(inputs, { op: "rag-index-build.embed-text" });
            if (!Array.isArray(vectors) || vectors.length !== batch.length) {
                throw new Error(
                    `embedFn returned ${vectors?.length ?? 0} vectors for ${batch.length} inputs`,
                );
            }
        } catch (error) {
            for (const row of batch) {
                failed.push({ id: String(row.id), reason: errorMessage(error) });
            }
            continue; // isolate the failed batch; keep going
        }

        const updates = [];
        const updateIds = [];
        let batchTokens = 0;
        for (let index = 0; index < batch.length; index += 1) {
            const row = batch[index];
            const input = inputs[index];
            const inputHash = deps.embeddingInputFingerprint(input, expectedVersion);
            if (inputHash !== String(row.embedding_input_hash)) {
                failed.push({
                    id: String(row.id),
                    reason:
                        "embedding_input_hash mismatch — inputs changed since populate; " +
                        "create a new build",
                });
                continue;
            }
            updates.push({
                text: `UPDATE article_chunks
                       SET embedding = $1::vector,
                           embedding_model = $2,
                           embedding_input_version = $3
                       WHERE id = $4 AND index_build_id = $5 AND embedding_input_hash = $6`,
                params: [
                    vectorLiteral(vectors[index]),
                    expectedModel,
                    expectedVersion,
                    row.id,
                    buildId,
                    inputHash,
                ],
            });
            updateIds.push(String(row.id));
            batchTokens += Math.ceil(input.text.length / 4);
        }
        // The model was already called for this batch, so its tokens count
        // toward cost even if persisting the vectors fails below.
        textTokens += batchTokens;
        if (updates.length === 0) continue;
        try {
            // ONE transactionBatch per embed batch: all vector UPDATEs land in
            // a single HTTP request instead of one request per row.
            await executor.transactionBatch(updates);
            embedded += updates.length;
        } catch (error) {
            // Isolate the failed UPDATE batch: record its ids and keep going.
            for (const id of updateIds) {
                failed.push({
                    id,
                    reason: `vector UPDATE batch failed: ${errorMessage(error)}`,
                });
            }
        }
    }

    const costUsd = deps.computeEmbeddingCostUsd(
        expectedModel,
        syntheticEmbeddingResponse(textTokens),
    );
    return { planned, embedded, skipped, failed, textTokens, costUsd };
}

/**
 * Resolve the R2 object key for an evidence image_url.
 *   - content-addressed basename `<64-hex>[.webp]` -> `ocr-assets/<64-hex>.webp`
 *   - legacy `<date>/images/<name>` path            -> that path verbatim
 * Returns null when neither shape matches (recorded as a per-item failure).
 */
export function resolveImageObjectKey(imageUrl) {
    let pathname = String(imageUrl ?? "");
    try {
        pathname = new URL(pathname, "http://local.invalid").pathname;
    } catch {
        // keep the raw value
    }
    const decoded = decodeURIComponent(pathname);
    const baseName = decoded.split("/").filter(Boolean).pop() ?? "";
    const hashed = baseName.match(/^([a-f0-9]{64})(\.webp)?$/i);
    if (hashed) return `ocr-assets/${hashed[1].toLowerCase()}.webp`;
    const legacy = decoded.match(/(\d{4}-\d{2}-\d{2})\/images\/([^/]+)$/);
    if (legacy) return `${legacy[1]}/images/${legacy[2]}`;
    return null;
}

/**
 * Consume an R2 object body (Buffer, Uint8Array, async iterable, or web
 * ReadableStream) into ONE Buffer, enforcing a byte cap while streaming.
 */
export async function collectObjectBytes(body, maxBytes = MAX_IMAGE_BYTES) {
    if (body == null) throw new Error("object body is empty");
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        const buffer = Buffer.from(body);
        if (buffer.length > maxBytes) throw new Error(`object exceeds ${maxBytes} bytes`);
        return buffer;
    }
    let iterable = body;
    if (typeof body.getReader === "function") {
        // Web ReadableStream -> async iterable
        const reader = body.getReader();
        iterable = {
            async *[Symbol.asyncIterator]() {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) return;
                    yield value;
                }
            },
        };
    }
    if (typeof iterable[Symbol.asyncIterator] !== "function") {
        throw new Error("object body is not a buffer, stream, or async iterable");
    }
    const parts = [];
    let totalBytes = 0;
    for await (const part of iterable) {
        const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
        totalBytes += buffer.length;
        if (totalBytes > maxBytes) throw new Error(`object exceeds ${maxBytes} bytes`);
        parts.push(buffer);
    }
    return Buffer.concat(parts, totalBytes);
}

/** Magic-byte sniff limited to the formats the archive stores. */
export function sniffImageMime(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
    if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        return "image/webp";
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return "image/png";
    }
    return null;
}

/**
 * Image embedding for one build. STREAMS one image at a time: fetch -> single
 * Buffer (validated magic + <=10MiB) -> embed -> UPDATE -> references released
 * before the next item (no accumulated buffer array, so memory stays flat).
 *
 * The stored embedding_input_hash is the exact model input identity —
 * embeddingInputFingerprint over model + image input version + caption text +
 * mime + bytes — written only at embed time because it needs the bytes.
 * Resumability: rows already embedded at the build's (model, version) are
 * skipped without refetching (R2 objects are content-addressed/immutable and
 * caption/image_url are frozen on the build's rows at populate time); when
 * bytes ARE fetched, a stored-hash match still short-circuits the model call.
 *
 * EVERY per-item failure (unresolvable key, missing object, corrupt MIME,
 * oversized body, embed error) records {id, reason} and continues — the loop
 * never aborts, and image work never blocks text indexing (separate function;
 * finalizeBuild only requires text coverage).
 *
 * @param {QueryExecutorLike} executor
 * @param {string} buildId
 * @param {{ embedFn?: EmbedFnLike, fetchObject?: FetchObjectLike, maxItems?: number }} [options]
 */
export async function embedBuildImages(
    executor,
    buildId,
    { embedFn, fetchObject, maxItems = Infinity } = {},
) {
    if (typeof embedFn !== "function") throw new Error("embedBuildImages requires an embedFn.");
    if (typeof fetchObject !== "function") {
        throw new Error("embedBuildImages requires a fetchObject.");
    }
    const deps = await loadDeps();
    const build = await requireBuildingBuild(executor, buildId);
    const expectedModel = String(build.embedding_model);
    const expectedVersion = String(build.image_embedding_input_version);

    const rows = await executor.query({
        text: `SELECT i.id, i.image_url, i.caption, i.embedding_input_hash,
                      i.embedding_model, i.embedding_input_version,
                      (i.embedding IS NOT NULL) AS has_embedding,
                      a.headline, a.byline, a.edition_date, a.category, a.summary
               FROM article_images i JOIN articles a ON a.id = i.article_id
               WHERE i.index_build_id = $1
               ORDER BY i.id`,
        params: [buildId],
    });

    const images = rows.length;
    const failed = [];
    let planned = 0;
    let embedded = 0;
    let skipped = 0;
    let textTokens = 0;

    for (const row of rows) {
        if (
            row.has_embedding &&
            row.embedding_model === expectedModel &&
            row.embedding_input_version === expectedVersion &&
            row.embedding_input_hash
        ) {
            skipped += 1;
            continue;
        }
        if (planned >= maxItems) break;
        planned += 1;

        try {
            const key = resolveImageObjectKey(row.image_url);
            if (!key) throw new Error(`unresolvable R2 key for image_url ${row.image_url}`);
            const bytes = await collectObjectBytes(await fetchObject(key), MAX_IMAGE_BYTES);
            if (bytes.length === 0) throw new Error(`empty object at ${key}`);
            const mimeType = sniffImageMime(bytes);
            if (!mimeType) throw new Error(`object at ${key} is not webp/jpeg/png`);

            const caption =
                (typeof row.caption === "string" && row.caption.trim()) ||
                FALLBACK_IMAGE_CAPTION;
            const input = deps.buildEmbeddingInput({
                headline: row.headline,
                byline: row.byline,
                body_plain: `Image caption: ${caption}`,
                edition_date: row.edition_date,
                category: row.category,
                summary: row.summary,
                image_caption: caption,
                imageBase64: bytes.toString("base64"),
                imageMimeType: mimeType,
            });
            const inputHash = deps.embeddingInputFingerprint(input, expectedVersion);
            if (row.embedding_input_hash === inputHash && row.has_embedding) {
                skipped += 1;
                continue;
            }

            const vectors = await embedFn([input], { op: "rag-index-build.embed-image" });
            if (!Array.isArray(vectors) || vectors.length !== 1) {
                throw new Error("embedFn returned no vector for the image input");
            }
            await executor.query({
                text: `UPDATE article_images
                       SET embedding = $1::vector,
                           embedding_model = $2,
                           embedding_input_version = $3,
                           embedding_input_hash = $4
                       WHERE id = $5 AND index_build_id = $6`,
                params: [vectorLiteral(vectors[0]), expectedModel, expectedVersion, inputHash, row.id, buildId],
            });
            embedded += 1;
            textTokens += Math.ceil(input.text.length / 4);
        } catch (error) {
            failed.push({ id: String(row.id), reason: errorMessage(error) });
        }
        // `bytes`/`input` are block-scoped per iteration, so the previous
        // image's buffer and base64 are unreachable before the next fetch.
    }

    const costUsd = deps.computeEmbeddingCostUsd(
        expectedModel,
        syntheticEmbeddingResponse(textTokens),
        { imageCount: embedded },
    );
    return { planned, embedded, skipped, failed, images, costUsd };
}

/**
 * Coverage check and terminal transition. TEXT coverage is the requirement:
 * zero build chunks with NULL embedding -> 'validated'. Pending IMAGE vectors
 * alone never fail a build (retrieval degrades gracefully without a vector for
 * an image, but a missing text vector is a retrieval hole) — they are only
 * reported in the failure_reason when text coverage is also incomplete.
 * Throws unless the build is in 'building'; both UPDATEs re-check
 * status='building' so a concurrent finalize cannot double-transition.
 */
export async function finalizeBuild(executor, buildId) {
    const build = await getBuild(executor, buildId);
    if (!build) throw new Error(`Unknown index build ${buildId}.`);
    if (build.status !== "building") {
        throw new Error(
            `Index build ${buildId} is '${build.status}'; builds are immutable once out of ` +
                `'building'. There is no --force — create a new build instead.`,
        );
    }

    const counts = await executor.query({
        text: `SELECT
                   (SELECT count(*)::int FROM article_chunks
                    WHERE index_build_id = $1 AND embedding IS NULL) AS pending_chunks,
                   (SELECT count(*)::int FROM article_images
                    WHERE index_build_id = $1 AND embedding IS NULL) AS pending_images`,
        params: [buildId],
    });
    const pendingChunks = Number(counts[0].pending_chunks);
    const pendingImages = Number(counts[0].pending_images);

    if (pendingChunks === 0) {
        await executor.query({
            text: `UPDATE rag_index_builds
                   SET status = 'validated', validated_at = now()
                   WHERE id = $1 AND status = 'building'`,
            params: [buildId],
        });
        return { buildId, status: "validated", pendingChunks, pendingImages };
    }

    const failureReason =
        `coverage incomplete: ${pendingChunks} text chunk(s) without embeddings` +
        (pendingImages > 0
            ? `; ${pendingImages} image(s) also pending (image gaps alone never fail a build)`
            : "");
    await executor.query({
        text: `UPDATE rag_index_builds
               SET status = 'failed', failure_reason = $2
               WHERE id = $1 AND status = 'building'`,
        params: [buildId, failureReason],
    });
    return { buildId, status: "failed", pendingChunks, pendingImages, failureReason };
}

/**
 * Promote a validated build to 'active'. Single-active-per-corpus is
 * enforced twice: this guard produces a clear error, and migration 0004's
 * partial unique index makes any concurrent race lose at the database.
 * Serving only switches when RAG_RETRIEVAL_MODE selects the build — this
 * transition alone never changes what production serves.
 */
export async function activateBuild(executor, buildId) {
    const build = await getBuild(executor, buildId);
    if (!build) throw new Error(`Unknown index build ${buildId}.`);
    if (build.status !== "validated") {
        throw new Error(
            `Index build ${buildId} is '${build.status}'; only 'validated' builds can be activated.`,
        );
    }
    const active = await executor.query({
        text: `SELECT id FROM rag_index_builds
               WHERE corpus_version = $1 AND status = 'active' AND id <> $2`,
        params: [build.corpus_version, buildId],
    });
    if (active.length > 0) {
        throw new Error(
            `Corpus ${build.corpus_version} already has active build ${active[0].id}; ` +
                `run --rollback-activation ${active[0].id} first.`,
        );
    }
    await executor.query({
        text: `UPDATE rag_index_builds SET status = 'active', activated_at = now()
               WHERE id = $1 AND status = 'validated'`,
        params: [buildId],
    });
    return { buildId, status: "active", corpusVersion: String(build.corpus_version) };
}

/**
 * Demote an active build back to 'validated'. Order matters during an
 * incident: flip RAG_RETRIEVAL_MODE to legacy FIRST (instant,
 * serving-safe), then demote — a versioned-mode config pointing at a
 * non-active build fails its readiness check by design.
 */
export async function rollbackActivation(executor, buildId) {
    const build = await getBuild(executor, buildId);
    if (!build) throw new Error(`Unknown index build ${buildId}.`);
    if (build.status !== "active") {
        throw new Error(
            `Index build ${buildId} is '${build.status}'; only 'active' builds can be rolled back.`,
        );
    }
    await executor.query({
        text: `UPDATE rag_index_builds SET status = 'validated'
               WHERE id = $1 AND status = 'active'`,
        params: [buildId],
    });
    return { buildId, status: "validated" };
}

/**
 * Read-only build plan and cost estimate: NO writes, NO model calls.
 * chunkChars sums the exact embedding-input text per chunk (chunk characters
 * plus the title/context header overhead buildEmbeddingInput adds).
 * estTextTokens = ceil(chars / 4), the cost tracker's own documented fallback
 * (embeddingTokenCount's billableCharacterCount / 4). Prices flow through
 * computeEmbeddingCostUsd so this report can never drift from the tracker's
 * constants. estImageUsd is the flat per-image fee only; the (small) caption
 * text tokens of multimodal inputs are priced at embed time, not estimated.
 */
export async function dryRunReport(executor, { corpusVersion } = {}) {
    const deps = await loadDeps();

    let articleCount = 0;
    let chunks = 0;
    let chunkChars = 0;
    let images = 0;
    await readArticlesPaged(
        executor,
        "id, headline, byline, body_plain, edition_date, category, summary, image_urls",
        ARTICLE_PAGE_SIZE,
        async (articles) => {
            articleCount += articles.length;
            for (const article of articles) {
                const records = deps.buildArticleChunkRecords({
                    id: String(article.id),
                    headline: article.headline,
                    byline: article.byline,
                    body_plain: article.body_plain,
                    edition_date: article.edition_date,
                    category: article.category,
                    summary: article.summary,
                });
                chunks += records.length;
                chunkChars += records.reduce(
                    (sum, record) => sum + record.embeddingInput.text.length,
                    0,
                );
                images += jsonArray(article.image_urls).length;
            }
        },
    );

    const estTextTokens = Math.ceil(chunkChars / 4);
    const estTextUsd = deps.computeEmbeddingCostUsd(
        deps.RAG_EMBEDDING_MODEL,
        syntheticEmbeddingResponse(estTextTokens),
    );
    const estImageUsd = deps.computeEmbeddingCostUsd(deps.RAG_EMBEDDING_MODEL, {}, { imageCount: images });
    return {
        corpusVersion: corpusVersion ?? null,
        articles: articleCount,
        chunks,
        chunkChars,
        estTextTokens,
        estTextUsd,
        images,
        estImageUsd,
        totalUsd: estTextUsd + estImageUsd,
    };
}

function argValue(flag) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

async function main() {
    const localEnvModule = await import("../lib/local-env.ts");
    const { loadLocalEnv } = localEnvModule.default ?? localEnvModule;
    loadLocalEnv();
    if (!process.env.DATABASE_URL) fail("DATABASE_URL is required.");
    if (!process.argv.includes("--yes")) {
        fail(
            "This phase authorizes local/test databases only. Re-run with --yes to confirm " +
                "the target database is not production.",
        );
    }

    const executorModule = await import("./lib/neon-executor.ts");
    const { createNeonExecutor } = executorModule.default ?? executorModule;
    const executor = createNeonExecutor(process.env.DATABASE_URL);

    // --dry-run reads only legacy tables (articles) and performs zero writes,
    // so it may target an unmigrated database (e.g. approved read-only
    // production estimation). Every writing command still requires a fully
    // migrated target.
    if (!process.argv.includes("--dry-run")) {
        const runnerModule = await import("./lib/migration-runner.ts");
        const { assertMigrationsCurrent } = runnerModule.default ?? runnerModule;
        await assertMigrationsCurrent(executor);
    }

    const deps = await loadDeps();

    if (process.argv.includes("--create")) {
        const corpusVersion = argValue("--corpus");
        if (!corpusVersion) fail("--create requires --corpus <corpusVersion>.");
        const buildId = await createIndexBuild(executor, {
            corpusVersion,
            pipelineVersion: deps.RAG_PIPELINE_VERSION,
            embeddingModel: deps.RAG_EMBEDDING_MODEL,
            textInputVersion: deps.RAG_TEXT_EMBEDDING_INPUT_VERSION,
            imageInputVersion: deps.RAG_IMAGE_EMBEDDING_INPUT_VERSION,
        });
        console.log(buildId);
        return;
    }

    const populateId = argValue("--populate");
    if (populateId) {
        console.log(JSON.stringify(await populateBuildRecords(executor, populateId), null, 2));
        return;
    }

    const embedTextId = argValue("--embed-text");
    const embedImagesId = argValue("--embed-images");
    if (embedTextId || embedImagesId) {
        const embeddingsMod = await import("../../src/lib/embeddings.ts");
        const { embedDocuments, hasGoogleCredentials } = embeddingsMod.default ?? embeddingsMod;
        if (!hasGoogleCredentials()) fail("GOOGLE_CLOUD_PROJECT is required for Vertex AI ADC.");

        // Vertex embedContent for gemini-embedding-2 accepts exactly ONE
        // content per request (verified live: multi-content batches are
        // rejected wholesale). Adapt to per-item calls with bounded
        // concurrency; the embedFn contract (N inputs -> N vectors, ordered)
        // and all failure-isolation semantics upstream are unchanged.
        const EMBED_CONCURRENCY = 6;
        const perItemEmbedFn = async (inputs, opts) => {
            const vectors = new Array(inputs.length);
            let next = 0;
            const workers = Array.from(
                { length: Math.min(EMBED_CONCURRENCY, inputs.length) },
                async () => {
                    for (;;) {
                        const index = next;
                        next += 1;
                        if (index >= inputs.length) return;
                        const [vector] = await embedDocuments([inputs[index]], opts);
                        vectors[index] = vector;
                    }
                },
            );
            await Promise.all(workers);
            return vectors;
        };

        if (embedTextId) {
            const result = await embedBuildText(executor, embedTextId, {
                embedFn: perItemEmbedFn,
            });
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
        const missing = required.filter((name) => !process.env[name]);
        if (missing.length > 0) fail(`Missing R2 configuration: ${missing.join(", ")}`);
        const sdk = await import("@aws-sdk/client-s3");
        const s3 = new sdk.S3Client({
            region: "auto",
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
            },
        });
        const fetchObject = async (key) => {
            const response = await s3.send(
                new sdk.GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }),
            );
            return response.Body;
        };
        const limitArg = argValue("--limit");
        const result = await embedBuildImages(executor, embedImagesId, {
            embedFn: perItemEmbedFn,
            fetchObject,
            maxItems: limitArg ? Number(limitArg) : Infinity,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    const finalizeId = argValue("--finalize");
    if (finalizeId) {
        console.log(JSON.stringify(await finalizeBuild(executor, finalizeId), null, 2));
        return;
    }

    const activateId = argValue("--activate");
    if (activateId) {
        console.log(JSON.stringify(await activateBuild(executor, activateId), null, 2));
        return;
    }

    const rollbackActivationId = argValue("--rollback-activation");
    if (rollbackActivationId) {
        console.log(
            JSON.stringify(await rollbackActivation(executor, rollbackActivationId), null, 2),
        );
        return;
    }

    if (process.argv.includes("--dry-run")) {
        const report = await dryRunReport(executor, { corpusVersion: argValue("--corpus") });
        console.log(JSON.stringify(report, null, 2));
        return;
    }

    const statusId = argValue("--status");
    if (statusId) {
        const build = await getBuild(executor, statusId);
        if (!build) fail(`Unknown index build ${statusId}.`);
        const counts = await executor.query({
            text: `SELECT
                       (SELECT count(*)::int FROM article_chunks
                        WHERE index_build_id = $1 AND embedding IS NULL) AS pending_chunks,
                       (SELECT count(*)::int FROM article_images
                        WHERE index_build_id = $1 AND embedding IS NULL) AS pending_images`,
            params: [statusId],
        });
        console.log(
            JSON.stringify(
                {
                    ...build,
                    pendingChunks: Number(counts[0].pending_chunks),
                    pendingImages: Number(counts[0].pending_images),
                },
                null,
                2,
            ),
        );
        return;
    }

    fail(
        "One of --create, --populate, --embed-text, --embed-images, --finalize, --activate, " +
            "--rollback-activation, --dry-run, --status is required.",
    );
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
