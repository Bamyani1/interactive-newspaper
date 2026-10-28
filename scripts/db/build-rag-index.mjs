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
 *   --contextualize <buildId>    Claude-written keyword-search context per chunk
 *                                (Batch API; --batch <id> collects a submitted batch)
 *   --embed-text <buildId>       voyage-context-4 chunk embeddings, one list per
 *                                article (resumable by exact hash)
 *   --embed-images <buildId>     one-at-a-time voyage-multimodal-3.5 photo embeddings from R2
 *   --finalize <buildId>         coverage check -> 'validated' or 'failed'
 *   --register-corpus <id>       add a corpus version to corpus_versions (idempotent);
 *                                imports require it on the target
 *   --switch <buildId>           serve this build: activate it and move the
 *                                rag_serving_pointer row (0014), in one transaction
 *   --switch-back                serve the pointer's previous build again
 *   --pointer                    print the serving pointer
 *   --dry-run [--corpus <id>]    read-only cost/plan report, no writes
 *   --status <buildId>           build row + pending counts
 *
 * All commands require DATABASE_URL and an explicit --yes (this phase
 * authorizes LOCAL/TEST databases only; production access is a later,
 * separately approved step). Exported functions are executor-injectable and
 * take embedFn/fetchObject/runBatch params so tests drive them against PGlite
 * with fakes; main() wires the real Voyage and Claude calls and an R2
 * GetObject client. Vectors land in the 1024-dimension columns (0013);
 * builds made before them cannot be continued by this tool.
 */

import { createHash } from "node:crypto";
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
 * @typedef {{ header: string, chunks: string[] }} ChunkedDocumentLike
 * @typedef {(documents: ChunkedDocumentLike[], opts?: { op?: string }) => Promise<number[][][]>} EmbedChunksFnLike
 * @typedef {{ custom_id: string, params: Record<string, unknown> }} BatchRequestLike
 * @typedef {{ custom_id: string, text: string | null, usage?: Record<string, number> }} BatchResultLike
 * @typedef {(requests: BatchRequestLike[]) => Promise<BatchResultLike[]>} RunBatchLike
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
  const { buildChunkHeader, buildEmbeddingInput, embeddingInputFingerprint } =
    embeddingsMod.default ?? embeddingsMod;
  const costMod = await import("../../src/lib/cost-tracker.ts");
  const { computeCostUsd, computeEmbeddingCostUsd } = costMod.default ?? costMod;
  const configMod = await import("../../src/lib/rag-model-config.ts");
  const {
    RAG_EMBEDDING_DIMS,
    RAG_EMBEDDING_MODEL,
    RAG_GENERATION_MODEL,
    RAG_IMAGE_EMBEDDING_MODEL,
    RAG_PIPELINE_VERSION,
    RAG_TEXT_EMBEDDING_INPUT_VERSION,
    RAG_IMAGE_EMBEDDING_INPUT_VERSION,
  } = configMod.default ?? configMod;
  const ulidMod = await import("../../src/server/identity/ulid.ts");
  const { ulid } = ulidMod.default ?? ulidMod;
  _deps = {
    buildArticleChunkRecords,
    buildChunkHeader,
    buildEmbeddingInput,
    embeddingInputFingerprint,
    computeCostUsd,
    computeEmbeddingCostUsd,
    RAG_EMBEDDING_DIMS,
    RAG_EMBEDDING_MODEL,
    RAG_GENERATION_MODEL,
    RAG_IMAGE_EMBEDDING_MODEL,
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

/** Synthetic Voyage usage so pricing always flows through the cost tracker. */
function syntheticUsage(tokenCount, imagePixels) {
  return imagePixels === undefined
    ? { total_tokens: tokenCount }
    : { total_tokens: tokenCount, text_tokens: tokenCount, image_pixels: imagePixels };
}

/**
 * Photo sizes are not known before the bytes are read, so estimates assume
 * this many pixels a photo (about 1000 x 1500). Real calls are priced from
 * Voyage's usage block by the cost tracker.
 */
const ESTIMATED_PIXELS_PER_IMAGE = 1_500_000;

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
        `'building'. There is no --force — create a new build instead.`
    );
  }
  return build;
}

/** Embedding steps write the 1024-dimension columns, so they need a build made for them. */
async function requireEmbeddableBuild(executor, buildId) {
  const deps = await loadDeps();
  const build = await requireBuildingBuild(executor, buildId);
  if (Number(build.embedding_dims) !== deps.RAG_EMBEDDING_DIMS) {
    throw new Error(
      `Index build ${buildId} was created for ${build.embedding_dims ?? 768}-dimension ` +
        `vectors; this tool writes ${deps.RAG_EMBEDDING_DIMS}. Create a new build.`
    );
  }
  return build;
}

/**
 * Mint a new immutable index-build identity in status 'building'.
 * Default id is `build-<ULID>`. Duplicate ids throw (no upsert): identity
 * rows are immutable, so re-creating means minting a NEW id.
 */
/**
 * Register a corpus version so builds for it can be imported elsewhere.
 * Idempotent: an existing row is left as it is.
 *
 * @param {QueryExecutorLike} executor
 * @param {string} corpusVersion
 * @returns {Promise<{ id: string, inserted: boolean }>}
 */
export async function registerCorpus(executor, corpusVersion) {
  if (!corpusVersion) throw new Error("registerCorpus requires a corpus version.");
  const inserted = await executor.query({
    text: `INSERT INTO corpus_versions (id, description)
               VALUES ($1, 'Registered by build-rag-index')
               ON CONFLICT (id) DO NOTHING RETURNING id`,
    params: [corpusVersion],
  });
  return { id: corpusVersion, inserted: inserted.length > 0 };
}

export async function createIndexBuild(executor, options = {}) {
  const {
    buildId,
    corpusVersion,
    pipelineVersion,
    embeddingModel,
    imageEmbeddingModel,
    embeddingDims,
    textInputVersion,
    imageInputVersion,
  } = options;
  for (const [name, value] of [
    ["corpusVersion", corpusVersion],
    ["pipelineVersion", pipelineVersion],
    ["embeddingModel", embeddingModel],
    ["imageEmbeddingModel", imageEmbeddingModel],
    ["embeddingDims", embeddingDims],
    ["textInputVersion", textInputVersion],
    ["imageInputVersion", imageInputVersion],
  ]) {
    if (!value) throw new Error(`createIndexBuild requires ${name}.`);
  }
  const deps = await loadDeps();
  const id = buildId ?? `build-${deps.ulid()}`;
  await registerCorpus(executor, corpusVersion);
  await executor.query({
    text: `INSERT INTO rag_index_builds
                   (id, corpus_version, status, pipeline_version, embedding_model,
                    image_embedding_model, embedding_dims,
                    text_embedding_input_version, image_embedding_input_version)
               VALUES ($1, $2, 'building', $3, $4, $5, $6, $7, $8)`,
    params: [
      id,
      corpusVersion,
      pipelineVersion,
      embeddingModel,
      imageEmbeddingModel,
      embeddingDims,
      textInputVersion,
      imageInputVersion,
    ],
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
export async function populateBuildRecords(
  executor,
  buildId,
  { batchSize = ARTICLE_PAGE_SIZE } = {}
) {
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
            imageCaptions[imageIndex] ?? (imageIndex === 0 ? article.image_caption : null);
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
            "ON CONFLICT (id) DO NOTHING"
          )
        );
      }
      for (const rows of chunkArray(imageRows, IMAGE_INSERT_ROWS)) {
        statements.push(
          multiRowInsert(
            `INSERT INTO article_images
                             (id, index_build_id, article_id, image_index, image_url,
                              caption, content_revision_id)`,
            rows,
            "ON CONFLICT (id) DO NOTHING"
          )
        );
      }
      for (const group of chunkArray(statements, STATEMENTS_PER_BATCH)) {
        await executor.transactionBatch(group);
      }
    }
  );

  return { articles: articleCount, chunks: chunkCount, images: imageCount };
}

const CONTEXT_MAX_ARTICLE_CHARS = 12_000;
const CONTEXT_MAX_TOKENS = 200;
const CONTEXT_UPDATE_ROWS = 100;
// The Batch API bills half the online rate.
const BATCH_PRICE_FACTOR = 0.5;

const CONTEXT_SYSTEM_PROMPT = `You write search context for chunks of articles from The Transcript, Ohio Wesleyan University's student newspaper (1950-2006). Your line is indexed for keyword search together with the chunk, so a reader's search finds the chunk even when it never uses the reader's words.`;

/** Batch custom_ids allow only [A-Za-z0-9_-]{1,64}; chunk ids contain colons. */
export function contextCustomId(chunkId) {
  return createHash("sha256").update(String(chunkId)).digest("hex").slice(0, 48);
}

/** One Batch API request asking Claude to place a chunk in its article. */
export function contextRequest(deps, row) {
  const article = String(row.body_plain ?? "").slice(0, CONTEXT_MAX_ARTICLE_CHARS);
  return {
    custom_id: contextCustomId(row.id),
    params: {
      model: deps.RAG_GENERATION_MODEL,
      max_tokens: CONTEXT_MAX_TOKENS,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system: CONTEXT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `<article>\nEdition: ${row.edition_date}\nSection: ${row.category}\n` +
            `Headline: ${row.headline}\n\n${article}\n</article>\n\n` +
            `<chunk>\n${row.chunk_text}\n</chunk>\n\n` +
            "In one or two sentences, under 50 words, situate this chunk in the article: " +
            "what it is about, the people and places involved, and the year. Add the plain " +
            "present-day words a searcher would use for period terms in the chunk. Answer " +
            "with the context only.",
        },
      ],
    },
  };
}

/**
 * Claude-written context lines for one build's chunks, for keyword search
 * (migration 0013 indexes context_text with chunk_text). Resumable: only
 * chunks still without a line are sent, and each UPDATE re-checks that.
 * runBatch submits the requests and returns each one's text (null when it
 * failed); a chunk left without a line is reported, never fatal, and a
 * re-run picks it up.
 *
 * @param {QueryExecutorLike} executor
 * @param {string} buildId
 * @param {{ runBatch?: RunBatchLike }} [options]
 */
export async function contextualizeBuildChunks(executor, buildId, { runBatch } = {}) {
  if (typeof runBatch !== "function") {
    throw new Error("contextualizeBuildChunks requires a runBatch.");
  }
  const deps = await loadDeps();
  await requireBuildingBuild(executor, buildId);

  const pending = [];
  let lastPendingId = null;
  for (;;) {
    const pageRows = await executor.query({
      text: `SELECT c.id, c.chunk_text, a.headline, a.edition_date, a.category, a.body_plain
                   FROM article_chunks c JOIN articles a ON a.id = c.article_id
                   WHERE c.index_build_id = $1 AND c.context_text IS NULL
                     ${lastPendingId === null ? "" : "AND c.id > $2"}
                   ORDER BY c.id
                   LIMIT ${PENDING_CHUNK_PAGE_SIZE}`,
      params: lastPendingId === null ? [buildId] : [buildId, lastPendingId],
    });
    pending.push(...pageRows);
    if (pageRows.length < PENDING_CHUNK_PAGE_SIZE) break;
    lastPendingId = String(pageRows[pageRows.length - 1].id);
  }
  if (pending.length === 0) return { planned: 0, written: 0, failed: [], costUsd: 0 };

  const chunkIdByCustomId = new Map(pending.map((row) => [contextCustomId(row.id), row.id]));
  const results = await runBatch(pending.map((row) => contextRequest(deps, row)));

  const failed = [];
  const updates = [];
  let costUsd = 0;
  for (const result of results) {
    const chunkId = chunkIdByCustomId.get(result.custom_id);
    if (!chunkId) continue; // a request from another run of the same batch
    if (result.usage) {
      costUsd += deps.computeCostUsd(deps.RAG_GENERATION_MODEL, result.usage) * BATCH_PRICE_FACTOR;
    }
    const text = result.text?.trim();
    if (!text) {
      failed.push({ id: String(chunkId), reason: "no context returned" });
      continue;
    }
    updates.push({
      text: `UPDATE article_chunks SET context_text = $1
                   WHERE id = $2 AND index_build_id = $3 AND context_text IS NULL`,
      params: [text, chunkId, buildId],
    });
  }
  let written = 0;
  for (const group of chunkArray(updates, CONTEXT_UPDATE_ROWS)) {
    await executor.transactionBatch(group);
    written += group.length;
  }
  return { planned: pending.length, written, failed, costUsd };
}

function chunkTextInput(deps, row) {
  return { header: deps.buildChunkHeader(row), text: row.chunk_text };
}

/**
 * Text embedding for one build, resumable by exact hash.
 *
 * The pending SELECT is the resumability proof: rows whose
 * (embedding_1024, embedding_model, embedding_input_version) already match
 * the build's expected identity are never re-selected, so they are never
 * re-embedded. Each UPDATE is additionally keyed by embedding_input_hash so a
 * vector can only land on the exact input it was computed for; the stored
 * hash was minted by populateBuildRecords at RAG_TEXT_EMBEDDING_INPUT_VERSION,
 * so a build created with a divergent text input version surfaces as loud
 * per-row hash-mismatch failures instead of silently mixing versions.
 *
 * voyage-context-4 embeds each chunk in the context of its article, so the
 * pending chunks of one article always go in together, as one document led
 * by the article header. `batchSize` counts articles per embed call.
 *
 * A failed batch records {id, reason} per row and CONTINUES with the next
 * batch — one bad batch never aborts the run.
 *
 * @param {QueryExecutorLike} executor
 * @param {string} buildId
 * @param {{ embedChunksFn?: EmbedChunksFnLike, batchSize?: number }} [options]
 */
export async function embedBuildText(executor, buildId, { embedChunksFn, batchSize = 50 } = {}) {
  if (typeof embedChunksFn !== "function") {
    throw new Error("embedBuildText requires an embedChunksFn.");
  }
  const deps = await loadDeps();
  const build = await requireEmbeddableBuild(executor, buildId);
  const expectedModel = String(build.embedding_model);
  const expectedVersion = String(build.text_embedding_input_version);

  const totalRows = await executor.query({
    text: "SELECT count(*)::int AS n FROM article_chunks WHERE index_build_id = $1",
    params: [buildId],
  });
  const total = Number(totalRows[0].n);

  // Keyset-paginated pending read (chunk text over a whole build can exceed
  // the 64 MiB HTTP response cap); collected fully before embedding. Row ids
  // are {buildId}:{articleId}:{chunkIndex}, so an article's chunks arrive
  // together and in order.
  const pending = [];
  let lastPendingId = null;
  for (;;) {
    const pageRows = await executor.query({
      text: `SELECT c.id, c.article_id, c.chunk_index, c.chunk_text, c.embedding_input_hash,
                          a.headline, a.byline, a.edition_date, a.category
                   FROM article_chunks c JOIN articles a ON a.id = c.article_id
                   WHERE c.index_build_id = $1
                     AND (c.embedding_1024 IS NULL
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

  const articles = [];
  for (const row of pending) {
    const last = articles[articles.length - 1];
    if (last && last[0].article_id === row.article_id) last.push(row);
    else articles.push([row]);
  }

  const planned = pending.length;
  const skipped = total - planned;
  const failed = [];
  let embedded = 0;
  let textTokens = 0;

  for (let offset = 0; offset < articles.length; offset += batchSize) {
    const batchArticles = articles.slice(offset, offset + batchSize);
    const batch = batchArticles.flat();
    const inputs = batch.map((row) => chunkTextInput(deps, row));
    const documents = batchArticles.map((rows) => ({
      header: deps.buildChunkHeader(rows[0]),
      chunks: rows.map((row) => String(row.chunk_text)),
    }));

    let vectors;
    try {
      const grouped = await embedChunksFn(documents, { op: "rag-index-build.embed-text" });
      vectors = Array.isArray(grouped) ? grouped.flat() : [];
      if (vectors.length !== batch.length) {
        throw new Error(
          `embedChunksFn returned ${vectors.length} vectors for ${batch.length} chunks`
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
    // Every header was sent once per article.
    let batchTokens = documents.reduce((sum, doc) => sum + Math.ceil(doc.header.length / 4), 0);
    for (let index = 0; index < batch.length; index += 1) {
      const row = batch[index];
      const input = inputs[index];
      batchTokens += Math.ceil(input.text.length / 4);
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
                       SET embedding_1024 = $1::vector,
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

  const costUsd = deps.computeEmbeddingCostUsd(expectedModel, syntheticUsage(textTokens));
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

/** Voyage rejects images over 16 million pixels (multimodal API limits). */
export const VOYAGE_MAX_IMAGE_PIXELS = 16_000_000;

/**
 * Shrink an image that is over Voyage's pixel limit, keeping its shape, and
 * re-encode it as JPEG. Images within the limit come back unchanged.
 *
 * @param {Buffer} bytes
 * @param {string} mimeType
 * @param {number} [maxPixels]
 * @returns {Promise<{ bytes: Buffer, mimeType: string, resized: boolean }>}
 */
export async function fitImageForVoyage(bytes, mimeType, maxPixels = VOYAGE_MAX_IMAGE_PIXELS) {
  const sharp = (await import("sharp")).default;
  const { width = 0, height = 0 } = await sharp(bytes).metadata();
  const pixels = width * height;
  if (pixels <= maxPixels) return { bytes, mimeType, resized: false };
  const scale = Math.sqrt(maxPixels / pixels) * 0.99;
  const resizedBytes = await sharp(bytes)
    .resize({
      width: Math.floor(width * scale),
      height: Math.floor(height * scale),
      fit: "inside",
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { bytes: resizedBytes, mimeType: "image/jpeg", resized: true };
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
  { embedFn, fetchObject, maxItems = Infinity } = {}
) {
  if (typeof embedFn !== "function") throw new Error("embedBuildImages requires an embedFn.");
  if (typeof fetchObject !== "function") {
    throw new Error("embedBuildImages requires a fetchObject.");
  }
  const deps = await loadDeps();
  const build = await requireEmbeddableBuild(executor, buildId);
  const expectedModel = String(build.image_embedding_model);
  const expectedVersion = String(build.image_embedding_input_version);

  const rows = await executor.query({
    text: `SELECT i.id, i.image_url, i.caption, i.embedding_input_hash,
                      i.embedding_model, i.embedding_input_version,
                      (i.embedding_1024 IS NOT NULL) AS has_embedding,
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
      const stored = await collectObjectBytes(await fetchObject(key), MAX_IMAGE_BYTES);
      if (stored.length === 0) throw new Error(`empty object at ${key}`);
      const storedMime = sniffImageMime(stored);
      if (!storedMime) throw new Error(`object at ${key} is not webp/jpeg/png`);
      const { bytes, mimeType } = await fitImageForVoyage(stored, storedMime);

      const caption =
        (typeof row.caption === "string" && row.caption.trim()) || FALLBACK_IMAGE_CAPTION;
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
                       SET embedding_1024 = $1::vector,
                           embedding_model = $2,
                           embedding_input_version = $3,
                           embedding_input_hash = $4
                       WHERE id = $5 AND index_build_id = $6`,
        params: [
          vectorLiteral(vectors[0]),
          expectedModel,
          expectedVersion,
          inputHash,
          row.id,
          buildId,
        ],
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
    syntheticUsage(textTokens, embedded * ESTIMATED_PIXELS_PER_IMAGE)
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
        `'building'. There is no --force — create a new build instead.`
    );
  }

  const counts = await executor.query({
    text: `SELECT
                   (SELECT count(*)::int FROM article_chunks
                    WHERE index_build_id = $1 AND embedding_1024 IS NULL) AS pending_chunks,
                   (SELECT count(*)::int FROM article_images
                    WHERE index_build_id = $1 AND embedding_1024 IS NULL) AS pending_images`,
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
      `Index build ${buildId} is '${build.status}'; only 'validated' builds can be activated.`
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
        `run --rollback-activation ${active[0].id} first.`
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
      `Index build ${buildId} is '${build.status}'; only 'active' builds can be rolled back.`
    );
  }
  await executor.query({
    text: `UPDATE rag_index_builds SET status = 'validated'
               WHERE id = $1 AND status = 'active'`,
    params: [buildId],
  });
  return { buildId, status: "validated" };
}

export async function getServingPointer(executor) {
  const [row] = await executor.query({
    text: `SELECT index_build_id, corpus_version, previous_build_id, previous_corpus_version,
                  switched_at
           FROM rag_serving_pointer WHERE id = 1`,
  });
  if (!row) return null;
  return {
    indexBuildId: String(row.index_build_id),
    corpusVersion: String(row.corpus_version),
    previousBuildId: row.previous_build_id ? String(row.previous_build_id) : null,
    previousCorpusVersion: row.previous_corpus_version ? String(row.previous_corpus_version) : null,
    switchedAt: row.switched_at,
  };
}

/**
 * Point Ask at a build. One transaction demotes the corpus's other active
 * build, activates this one and moves the pointer, keeping the old pair as
 * `previous_*` for --switch-back. A build whose chunks are not all embedded
 * (a half-finished import, say) is refused: Ask would serve a partial index.
 */
export async function switchServingBuild(executor, buildId) {
  const build = await getBuild(executor, buildId);
  if (!build) throw new Error(`Unknown index build ${buildId}.`);
  if (build.status !== "validated" && build.status !== "active") {
    throw new Error(
      `Index build ${buildId} is '${build.status}'; only 'validated' or 'active' builds can serve.`
    );
  }
  const [counts] = await executor.query({
    text: `SELECT count(*)::int AS chunks,
                  count(*) FILTER (WHERE embedding_1024 IS NULL)::int AS missing
           FROM article_chunks WHERE index_build_id = $1`,
    params: [buildId],
  });
  if (Number(counts.chunks) === 0) throw new Error(`Index build ${buildId} has no chunks.`);
  if (Number(counts.missing) > 0) {
    throw new Error(
      `Index build ${buildId} has ${counts.missing} chunk(s) without vectors; ` +
        `finish embedding or importing it first.`
    );
  }

  const current = await getServingPointer(executor);
  const unchanged = current?.indexBuildId === buildId;
  const previousBuildId = unchanged ? current.previousBuildId : (current?.indexBuildId ?? null);
  const previousCorpus = unchanged
    ? current.previousCorpusVersion
    : (current?.corpusVersion ?? null);
  await executor.transactionBatch([
    {
      text: `UPDATE rag_index_builds SET status = 'validated'
             WHERE corpus_version = $1 AND status = 'active' AND id <> $2`,
      params: [build.corpus_version, buildId],
    },
    {
      text: `UPDATE rag_index_builds SET status = 'active', activated_at = now()
             WHERE id = $1 AND status = 'validated'`,
      params: [buildId],
    },
    {
      text: `INSERT INTO rag_serving_pointer
               (id, index_build_id, corpus_version, previous_build_id, previous_corpus_version)
             VALUES (1, $1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               index_build_id = EXCLUDED.index_build_id,
               corpus_version = EXCLUDED.corpus_version,
               previous_build_id = EXCLUDED.previous_build_id,
               previous_corpus_version = EXCLUDED.previous_corpus_version,
               switched_at = now()`,
      params: [buildId, build.corpus_version, previousBuildId, previousCorpus],
    },
  ]);
  return { buildId, corpusVersion: String(build.corpus_version), previousBuildId };
}

/** Point Ask back at the previous build; running it again flips forward. */
export async function switchBack(executor) {
  const current = await getServingPointer(executor);
  if (!current?.previousBuildId) {
    throw new Error("The serving pointer has no previous build to switch back to.");
  }
  return switchServingBuild(executor, current.previousBuildId);
}

/**
 * Read-only build plan and cost estimate: NO writes, NO model calls.
 * chunkChars sums the exact embedding input per article: the header once,
 * plus every chunk. estTextTokens = ceil(chars / 4). Prices flow through
 * computeEmbeddingCostUsd so this report can never drift from the tracker's
 * constants. estImageUsd prices ESTIMATED_PIXELS_PER_IMAGE a photo; the
 * (small) caption text tokens of multimodal inputs are priced at embed
 * time, not estimated.
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
        chunkChars +=
          (records[0]?.embeddingInput.header.length ?? 0) +
          records.reduce((sum, record) => sum + record.embeddingInput.text.length, 0);
        images += jsonArray(article.image_urls).length;
      }
    }
  );

  const estTextTokens = Math.ceil(chunkChars / 4);
  const estTextUsd = deps.computeEmbeddingCostUsd(
    deps.RAG_EMBEDDING_MODEL,
    syntheticUsage(estTextTokens)
  );
  const estImageUsd = deps.computeEmbeddingCostUsd(
    deps.RAG_IMAGE_EMBEDDING_MODEL,
    syntheticUsage(0, images * ESTIMATED_PIXELS_PER_IMAGE)
  );
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
        "the target database is not production."
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
      imageEmbeddingModel: deps.RAG_IMAGE_EMBEDDING_MODEL,
      embeddingDims: deps.RAG_EMBEDDING_DIMS,
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

  const contextualizeId = argValue("--contextualize");
  if (contextualizeId) {
    if (!process.env.ANTHROPIC_API_KEY) fail("ANTHROPIC_API_KEY is required.");
    const anthropicModule = await import("@anthropic-ai/sdk");
    const Anthropic = anthropicModule.default ?? anthropicModule;
    const client = new Anthropic({ maxRetries: 4 });
    // Batches stay well under the API's 256 MB cap.
    const BATCH_REQUESTS = 5_000;
    const runBatch = async (requests) => {
      let batchIds = argValue("--batch")?.split(",").filter(Boolean) ?? [];
      if (batchIds.length === 0) {
        for (const group of chunkArray(requests, BATCH_REQUESTS)) {
          const batch = await client.messages.batches.create({ requests: group });
          batchIds.push(batch.id);
        }
        console.error(
          `Submitted ${requests.length} requests. If this run stops, collect them with ` +
            `--batch ${batchIds.join(",")}`
        );
      }
      for (const batchId of batchIds) {
        for (;;) {
          const batch = await client.messages.batches.retrieve(batchId);
          if (batch.processing_status === "ended") break;
          console.error(`${batchId}: ${batch.request_counts.processing} still processing`);
          await new Promise((resolve) => setTimeout(resolve, 30_000));
        }
      }
      const results = [];
      for (const batchId of batchIds) {
        for await (const entry of await client.messages.batches.results(batchId)) {
          const message = entry.result.type === "succeeded" ? entry.result.message : null;
          results.push({
            custom_id: entry.custom_id,
            text: message
              ? message.content
                  .filter((block) => block.type === "text")
                  .map((block) => block.text)
                  .join("")
              : null,
            usage: message?.usage,
          });
        }
      }
      return results;
    };
    const result = await contextualizeBuildChunks(executor, contextualizeId, { runBatch });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const embedTextId = argValue("--embed-text");
  const embedImagesId = argValue("--embed-images");
  if (embedTextId || embedImagesId) {
    const embeddingsMod = await import("../../src/lib/embeddings.ts");
    const { embedArticleChunks, embedDocuments, hasVoyageCredentials } =
      embeddingsMod.default ?? embeddingsMod;
    if (!hasVoyageCredentials()) fail("VOYAGE_API_KEY is required.");

    if (embedTextId) {
      const result = await embedBuildText(executor, embedTextId, {
        embedChunksFn: embedArticleChunks,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const required = [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
    ];
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
        new sdk.GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key })
      );
      return response.Body;
    };
    const limitArg = argValue("--limit");
    const result = await embedBuildImages(executor, embedImagesId, {
      embedFn: embedDocuments,
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

  const registerCorpusId = argValue("--register-corpus");
  if (registerCorpusId) {
    console.log(JSON.stringify(await registerCorpus(executor, registerCorpusId), null, 2));
    return;
  }

  const activateId = argValue("--activate");
  if (activateId) {
    console.log(JSON.stringify(await activateBuild(executor, activateId), null, 2));
    return;
  }

  const rollbackActivationId = argValue("--rollback-activation");
  if (rollbackActivationId) {
    console.log(JSON.stringify(await rollbackActivation(executor, rollbackActivationId), null, 2));
    return;
  }

  const switchId = argValue("--switch");
  if (switchId) {
    console.log(JSON.stringify(await switchServingBuild(executor, switchId), null, 2));
    return;
  }

  if (process.argv.includes("--switch-back")) {
    console.log(JSON.stringify(await switchBack(executor), null, 2));
    return;
  }

  if (process.argv.includes("--pointer")) {
    console.log(JSON.stringify(await getServingPointer(executor), null, 2));
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
                        WHERE index_build_id = $1 AND embedding_1024 IS NULL) AS pending_chunks,
                       (SELECT count(*)::int FROM article_images
                        WHERE index_build_id = $1 AND embedding_1024 IS NULL) AS pending_images`,
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
        2
      )
    );
    return;
  }

  fail(
    "One of --create, --populate, --contextualize, --embed-text, --embed-images, --finalize, " +
      "--register-corpus, --activate, --rollback-activation, --switch, --switch-back, --pointer, " +
      "--dry-run, --status is required."
  );
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
