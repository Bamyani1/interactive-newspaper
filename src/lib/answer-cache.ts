/**
 * Answer Cache — two tiers.
 *
 * Tier 1: in-memory LRU keyed by exact normalized question. Free and
 * instant, but per-instance on Vercel and gone on redeploy.
 *
 * Tier 2: pgvector semantic cache (answer_cache table) matching
 * paraphrases by question-embedding similarity. Survives instances and
 * deploys; costs one query embedding (~$0.000004) per lookup. Threshold
 * 0.94 = the 0.92 "balanced" production threshold plus a 0.02 confidence
 * buffer, so near-boundary matches are not served.
 *
 * Both tiers are scoped by a cache identity string (pipeline version +
 * models + corpus + retrieval identity): any serving change invalidates by
 * scoping. Skipped for agent-path (complexity=complex) and low-confidence
 * answers, and entirely in evaluation mode.
 */

import { createHash } from "crypto";
import { neon } from "@neondatabase/serverless";
import type { AskResponse } from "@/src/types";
import {
    RAG_ANSWER_MODEL,
    RAG_EMBEDDING_MODEL,
    RAG_GENERATION_MODEL,
    RAG_PIPELINE_VERSION,
} from "@/src/lib/rag-model-config";
import { getRagRetrievalConfig } from "@/src/lib/rag-index-config";
import { isRagEvaluationMode } from "@/src/lib/rag-evaluation";
import { embedQuery } from "@/src/lib/embeddings";

const MAX_ENTRIES = 200;
const TTL_MS = 60 * 60 * 1000; // tier-1: 1 hour
const SEMANTIC_SIM_THRESHOLD = 0.94;
const SEMANTIC_TTL = "7 days"; // static-ish corpus; identity scoping handles change
const SEMANTIC_PRUNE_AFTER = "30 days";

interface CacheEntry {
    response: AskResponse;
    ts: number;
}

const cache = new Map<string, CacheEntry>();

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
    if (_sql !== null) return _sql;
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    _sql = neon(url);
    return _sql;
}

function cacheIdentity(): string {
    const corpusVersion = process.env.RAG_CORPUS_VERSION ?? "default";
    return [
        RAG_PIPELINE_VERSION,
        RAG_GENERATION_MODEL,
        RAG_ANSWER_MODEL,
        RAG_EMBEDDING_MODEL,
        corpusVersion,
        getRagRetrievalConfig().cacheIdentity,
    ].join("|");
}

function filtersHash(filters?: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(filters ?? {}))
        .digest("hex");
}

function makeKey(question: string, filters?: unknown): string {
    const normalized = question.trim().toLowerCase();
    return createHash("sha256")
        .update(`${cacheIdentity()}|${normalized}|${filtersHash(filters)}`)
        .digest("hex");
}

function warnCache(op: string, err: unknown, requestId?: string): void {
    console.warn(
        JSON.stringify({
            level: "warn",
            module: "answer-cache",
            op,
            requestId,
            msg: "semantic cache unavailable, continuing without it",
            err: err instanceof Error ? err.message : String(err),
        }),
    );
}

async function semanticLookup(
    question: string,
    filters: unknown,
    opts: { requestId?: string; signal?: AbortSignal },
): Promise<AskResponse | null> {
    const sql = getSql();
    if (!sql) return null;
    const embedding = await embedQuery(question, {
        requestId: opts.requestId,
        signal: opts.signal,
    });
    const vec = `[${embedding.join(",")}]`;
    const rows = (await sql.query(
        `SELECT response, 1 - (question_embedding <=> $1::vector) AS similarity
           FROM answer_cache
          WHERE cache_identity = $2
            AND filters_hash = $3
            AND created_at > now() - interval '${SEMANTIC_TTL}'
          ORDER BY question_embedding <=> $1::vector
          LIMIT 1`,
        [vec, cacheIdentity(), filtersHash(filters)],
    )) as Array<{ response: AskResponse; similarity: number }>;
    const hit = rows[0];
    if (!hit || Number(hit.similarity) < SEMANTIC_SIM_THRESHOLD) return null;
    console.warn(
        JSON.stringify({
            level: "info",
            module: "answer-cache",
            op: "semantic-hit",
            requestId: opts.requestId,
            similarity: Number(Number(hit.similarity).toFixed(4)),
        }),
    );
    // Populate tier 1 for this exact phrasing.
    cache.set(makeKey(question, filters), {
        response: hit.response,
        ts: Date.now(),
    });
    return hit.response;
}

async function semanticStore(
    question: string,
    filters: unknown,
    response: AskResponse,
): Promise<void> {
    const sql = getSql();
    if (!sql) return;
    const embedding = await embedQuery(question, {
        requestId: response.requestId,
    });
    const vec = `[${embedding.join(",")}]`;
    const identity = cacheIdentity();
    const fh = filtersHash(filters);
    await sql.query(
        `DELETE FROM answer_cache
          WHERE cache_identity = $1 AND filters_hash = $2 AND question = $3`,
        [identity, fh, question],
    );
    await sql.query(
        `INSERT INTO answer_cache
            (cache_identity, filters_hash, question, question_embedding, response)
         VALUES ($1, $2, $3, $4::vector, $5::jsonb)`,
        [identity, fh, question, vec, JSON.stringify(response)],
    );
    // Opportunistic prune; row counts are tiny at this traffic.
    await sql.query(
        `DELETE FROM answer_cache
          WHERE created_at < now() - interval '${SEMANTIC_PRUNE_AFTER}'`,
        [],
    );
}

export async function getCachedAnswer(
    question: string,
    filters?: unknown,
    opts: { requestId?: string; signal?: AbortSignal } = {},
): Promise<AskResponse | null> {
    if (isRagEvaluationMode()) return null;
    const key = makeKey(question, filters);
    const entry = cache.get(key);
    if (entry) {
        if (Date.now() - entry.ts <= TTL_MS) {
            // Promote to MRU
            cache.delete(key);
            cache.set(key, entry);
            return entry.response;
        }
        cache.delete(key);
    }
    try {
        return await semanticLookup(question, filters ?? {}, opts);
    } catch (err) {
        warnCache("semanticLookup", err, opts.requestId);
        return null;
    }
}

/**
 * Both tiers are shared across every visitor, so anything identifying the
 * original asker must not survive into a cache entry — a paraphrase by a
 * later visitor would otherwise be answered with the first asker's own
 * question text, session, and request id. Callers re-attach their own.
 */
function withoutRequesterIdentity(response: AskResponse): AskResponse {
    return { ...response, question: "", sessionId: "", requestId: "" };
}

export function setCachedAnswer(
    question: string,
    filters: unknown,
    response: AskResponse,
): void {
    if (isRagEvaluationMode()) return;
    if (response.confidence === "low") return;
    if (response.meta?.complexity === "complex") return;

    const shareable = withoutRequesterIdentity(response);
    const key = makeKey(question, filters);
    if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { response: shareable, ts: Date.now() });

    void semanticStore(question, filters ?? {}, shareable).catch((err) =>
        warnCache("semanticStore", err, response.requestId),
    );
}

export function clearAnswerCache(): void {
    cache.clear();
}

/** Test hook: reset the lazily-initialized SQL client. */
export function _resetAnswerCacheSqlForTests(): void {
    _sql = null;
}
