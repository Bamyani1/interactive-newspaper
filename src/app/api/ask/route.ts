/**
 * POST /api/ask — "Ask the Archive" RAG endpoint
 *
 * Pipeline: question → embed → hybrid retrieve → LLM generate → response
 *
 * Body: { question: string, filters?: { category?, startDate?, endDate? } }
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { QuotaExhaustedError } from "@/src/lib/embeddings";
import { DbTimeoutError, fetchYearDigest, queryArchiveCoverage } from "@/src/lib/db";
// Imported from db-timeout, not db: db.ts is mocked wholesale in the route
// tests, and the race must be the real one wherever it bounds a real call.
import { runWithDbTimeout } from "@/src/lib/db-timeout";
import type { RetrievedArticle } from "@/src/lib/db";
import type { RetrievalMethod } from "@/src/lib/db";
import { generateAnswer, generateAnswerStream } from "@/src/lib/answer-generator";
import { reformulateQuery } from "@/src/lib/query-reformulator";
import { MAX_QUESTION_LENGTH } from "@/src/lib/ask-limits";
import {
  deleteLatestTurn,
  getConversationHistory,
  addConversationTurn,
  newSessionId,
  formatHistoryForPrompt,
} from "@/src/lib/conversation-store";
import { runAgentLoop } from "@/src/lib/agent-loop";
import type { AgentResult } from "@/src/lib/agent-loop";
import type { RankedArticle } from "@/src/lib/reranker";
import type {
  AnswerOutcome,
  AskResponse,
  AskErrorKind,
  Citation,
  CitationSnapshot,
} from "@/src/types";
import {
  encodeAskStreamEvent,
  type AskAnswerOutcome,
  type AskErrorStage,
  type AskStreamEvent,
} from "@/src/lib/ask-stream-events";
import { isQuotaError, kindForQuota, retryAfterSecFromQuotaError } from "@/src/lib/gemini-quota";
import { getClientIp } from "@/src/lib/rate-limit";
import {
  checkDailyBudget,
  DailyBudgetExceededError,
  secondsUntilBudgetReset,
} from "@/src/lib/cost-tracker";
import {
  DEDUP_TTL_MS,
  dedupKey,
  freshResponseFromCached,
  getOrExtract,
  inFlightAsk,
  type DedupEntry,
  _clearAskDedupForTests,
  _askDedupInternalsForTests,
} from "@/src/lib/ask-dedup";
import {
  computeRerankSignals,
  logRerankSignals,
  _computeRerankSignalsForTests,
} from "@/src/lib/rerank-signals";
import { isRagEvaluationMode } from "@/src/lib/rag-evaluation";
import {
  rerankWithCorrectiveRetry,
  retrieveCandidates,
  RetrievalSignalsUnavailableError,
  RetrievalStageError,
} from "@/src/lib/retrieval";
import type { CandidateRetrievalResult } from "@/src/lib/retrieval";
import { getRagRetrievalConfig } from "@/src/lib/rag-index-config";
import type { CoverageIntent } from "@/src/lib/query-reformulator";
import type { ArchiveCoverage } from "@/src/lib/rag-coverage";
import { buildCitationSnapshots, type CitationSnapshotSource } from "@/src/lib/citation-snapshot";
import { isValidSessionId } from "@/src/lib/session-id";

export { _clearAskDedupForTests, _askDedupInternalsForTests, _computeRerankSignalsForTests };

// Vercel function ceiling; must stay above GLOBAL_DEADLINE_MS so the
// platform never kills a request our own deadline machinery would have
// finished or failed gracefully.
export const maxDuration = 60;

const RETRIEVAL_TIMEOUT_MS = 10_000;
const GLOBAL_DEADLINE_MS = 55_000;
const CONVERSATION_HISTORY_TIMEOUT_MS = 2_000;
const YEAR_DIGEST_TIMEOUT_MS = 3_000;

/**
 * Thrown when the request exceeds the global deadline. The top-level catch
 * converts this to a 504. Distinct from the retrieval-specific timeout
 * which uses a local "Retrieval timeout" marker.
 */
class DeadlineExceededError extends Error {
  constructor(public readonly deadlineMs: number) {
    super(`Global deadline exceeded: ${deadlineMs}ms`);
    this.name = "DeadlineExceededError";
  }
}

/**
 * Wraps an error with the pipeline stage that produced it so the top-level
 * catch can return a structured error response with stage info instead of
 * an opaque 500. Operators can grep logs by requestId/stage to find the
 * culprit.
 */
class StageError extends Error {
  constructor(
    public readonly stage: AskErrorStage,
    public readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "StageError";
  }
}

function retrievalFailureParts(error: unknown): unknown[] {
  return error instanceof RetrievalSignalsUnavailableError
    ? [error.ftsError, error.vectorError]
    : [error];
}

function retrievalTimeout(error: unknown): DbTimeoutError | undefined {
  return retrievalFailureParts(error).find(
    (part): part is DbTimeoutError => part instanceof DbTimeoutError
  );
}

function retrievalQuota(error: unknown): QuotaExhaustedError | undefined {
  return retrievalFailureParts(error).find(
    (part): part is QuotaExhaustedError => part instanceof QuotaExhaustedError
  );
}

function retrievalIdentityMetadata(
  identity: CandidateRetrievalResult["identity"] = getRagRetrievalConfig()
) {
  return {
    corpusVersion: identity.corpusVersion,
    indexBuildId: identity.activeIndexBuildId,
    pipelineVersion: identity.pipelineVersion,
    embeddingModel: identity.embeddingModel,
    textEmbeddingInputVersion: identity.textEmbeddingInputVersion,
    imageEmbeddingInputVersion: identity.imageEmbeddingInputVersion,
    retrievalTarget: identity.mode === "versioned" ? ("versioned" as const) : ("legacy" as const),
  };
}

async function resolveArchiveCoverage(
  intent: CoverageIntent | undefined,
  filters: { category?: string; startDate?: string; endDate?: string },
  signal: AbortSignal,
  requestId: string
): Promise<ArchiveCoverage | undefined> {
  if (!intent || intent === "none") return undefined;
  const identity = getRagRetrievalConfig();
  const stats = await queryArchiveCoverage({ ...filters, signal });
  // Survey questions scoped to one calendar year get the pre-computed
  // digest as non-citable guidance. Absence (undigested year, table not
  // migrated yet) degrades silently.
  let yearDigest: string | undefined;
  if (intent === "exhaustive" && filters.startDate && filters.endDate) {
    const startYear = filters.startDate.slice(0, 4);
    if (startYear === filters.endDate.slice(0, 4)) {
      // Non-citable guidance, and the only DB read here without a budget of
      // its own: without the timer a hung digest read could spend the whole
      // 55s global deadline on something the answer can do without. The
      // request's own signal still goes to the driver, so an outer abort
      // cancels the fetch; the timer only stops the route waiting on it.
      yearDigest =
        (await runWithDbTimeout(
          "fetchYearDigest",
          () => fetchYearDigest(Number(startYear), signal),
          YEAR_DIGEST_TIMEOUT_MS
        ).catch((err) => {
          console.warn(
            JSON.stringify({
              level: "warn",
              route: "/api/ask",
              requestId,
              stage: "coverage",
              msg: "year digest unavailable, continuing without it",
              err: err instanceof Error ? err.message : String(err),
            })
          );
          return null;
        })) ?? undefined;
    }
  }
  const coverage: ArchiveCoverage = {
    intent,
    ...stats,
    requestedStartDate: filters.startDate,
    requestedEndDate: filters.endDate,
    category: filters.category,
    corpusVersion: identity.corpusVersion,
    yearDigest,
  };
  // eslint-disable-next-line no-console -- structured retrieval telemetry
  console.info(
    JSON.stringify({
      level: "info",
      route: "/api/ask",
      requestId,
      stage: "coverage",
      msg: "deterministic archive coverage loaded",
      ...coverage,
      yearDigest: yearDigest ? true : undefined,
    })
  );
  return coverage;
}

function coverageMetadata(coverage?: ArchiveCoverage) {
  return coverage
    ? {
        coverage: {
          intent: coverage.intent,
          editionCount: coverage.editionCount,
          articleCount: coverage.articleCount,
          earliestEditionDate: coverage.earliestEditionDate,
          latestEditionDate: coverage.latestEditionDate,
          requestedStartDate: coverage.requestedStartDate,
          requestedEndDate: coverage.requestedEndDate,
          category: coverage.category,
        },
      }
    : {};
}

function wrapStage<T>(stage: AskErrorStage, fn: () => Promise<T>): Promise<T> {
  return fn().catch((err) => {
    // Don't wrap errors that the route already handles specifically.
    if (
      err instanceof DeadlineExceededError ||
      err instanceof QuotaExhaustedError ||
      err instanceof StageError
    ) {
      throw err;
    }
    throw new StageError(stage, err);
  });
}

/**
 * Generate a log-greppable request identifier. A UUID, not a short slice of
 * Math.random(): this is the join key into ask_feedback, and 8 base-36
 * characters collide often enough at real traffic to misattribute a vote to
 * the wrong answer. request_id is TEXT, so the extra width is free.
 */
function newRequestId(): string {
  return randomUUID();
}

const PERSIST_TURN_TIMEOUT_MS = 1500;

/**
 * Sources for an agent turn, in `sourceArticleIds` order: every cited
 * article, then any article whose image the answer embedded without citing
 * it. An uncited image owner has no Citation to read a headline from, so it
 * falls back to the retrieval metadata and is skipped if neither has one.
 */
function buildAgentSourceArticles(result: AgentResult) {
  const citationById = new Map(result.citations.map((citation) => [citation.articleId, citation]));
  return result.sourceArticleIds.flatMap((id) => {
    const meta = result.articleMeta.get(id);
    const citation = citationById.get(id);
    const headline = citation?.headline ?? meta?.headline;
    const editionDate = citation?.editionDate ?? meta?.editionDate;
    if (!headline || !editionDate) return [];
    return [
      {
        id,
        contentRevisionId: meta?.contentRevisionId,
        headline,
        editionDate,
        category: meta?.category ?? "",
        summary: meta?.summary ?? "",
        byline: meta?.byline ?? null,
        bodySnippet: meta?.bodySnippet ?? "",
        distance: null,
        imageUrls: meta?.imageUrls ?? [],
        imageCaptions: meta?.imageCaptions ?? [],
      },
    ];
  });
}

/**
 * Await a conversation-turn write but cap total latency so a slow Neon
 * never blocks the user's `done` event. If the timer wins, the write
 * continues in the background — `addConversationTurn` swallows its own
 * errors, so no unhandled rejection. Emitting `done` after this closes
 * the race where a rapid follow-up could arrive before the prior turn
 * landed in history.
 */
async function persistTurnBounded(
  sessionId: string,
  question: string,
  answer: string,
  citedArticleIds: string[],
  citationSnapshots: CitationSnapshot[]
): Promise<void> {
  await Promise.race([
    addConversationTurn(sessionId, question, answer, citedArticleIds, citationSnapshots),
    new Promise<void>((resolve) => setTimeout(resolve, PERSIST_TURN_TIMEOUT_MS)),
  ]);
}

function agentSnapshotSources(
  articleMeta: Map<string, import("@/src/lib/agent-loop").ArticleMeta>
): CitationSnapshotSource[] {
  return [...articleMeta.entries()].map(([id, article]) => ({
    id,
    ...article,
  }));
}

/**
 * Build a typed error response body. The `kind` discriminator lets the
 * client render friendly per-kind UI copy (countdown for rate_limit /
 * budget; retry CTA for timeout; requestId for server) without
 * sniffing status codes. `error` is kept as a legacy alias for pre-
 * redesign consumers.
 */
function askErrorJson(params: {
  status: number;
  kind: AskErrorKind;
  message: string;
  retryAfterSec?: number;
  requestId?: string;
  stage?: string;
  cause?: string;
  extraHeaders?: Record<string, string>;
}): NextResponse {
  const body: Record<string, unknown> = {
    kind: params.kind,
    message: params.message,
    error: params.message,
  };
  if (params.retryAfterSec !== undefined) {
    body.retryAfterSec = params.retryAfterSec;
  }
  if (params.requestId) body.requestId = params.requestId;
  if (params.stage) body.stage = params.stage;
  if (params.cause) body.cause = params.cause;

  const headers: Record<string, string> = { ...(params.extraHeaders ?? {}) };
  if (params.retryAfterSec !== undefined) {
    headers["Retry-After"] = String(params.retryAfterSec);
  }

  return NextResponse.json(body, { status: params.status, headers });
}

/**
 * Rerank via the canonical retrieval service, translating its stage tags into
 * this route's StageError so error responses keep naming the step that failed
 * ("rerank", "reformulate-retry", "retrieve-retry", "rerank-retry").
 *
 * The retry itself — one broader reformulation, re-retrieval, and a re-rank at
 * a lower minScore, then the total-veto fallback to fused order — lives in
 * retrieval.ts, which the agent tools already share. This wrapper only maps
 * errors; it deliberately holds no pipeline logic of its own.
 */
async function rerankWithCragRetry(params: {
  question: string;
  articles: RetrievedArticle[];
  mode: "text" | "visual";
  keepTopK: number;
  conversationHistory: import("@/src/lib/conversation-store").ConversationTurn[];
  filters: { category?: string; startDate?: string; endDate?: string };
  retrievalLimit: number;
  vectorWeight: number;
  onlyWithImages: boolean;
  retrievalTimeoutMs: number;
  signal: AbortSignal;
  requestId: string;
}): Promise<RankedArticle[]> {
  try {
    return await rerankWithCorrectiveRetry({
      question: params.question,
      articles: params.articles,
      mode: params.mode,
      maxArticles: params.keepTopK,
      conversationHistory: params.conversationHistory,
      filters: params.filters,
      retrievalLimit: params.retrievalLimit,
      vectorWeight: params.vectorWeight,
      onlyWithImages: params.onlyWithImages,
      timeoutMs: params.retrievalTimeoutMs,
      signal: params.signal,
      requestId: params.requestId,
    });
  } catch (err) {
    if (!(err instanceof RetrievalStageError)) throw err;
    if (err.cause instanceof DeadlineExceededError) throw err.cause;
    // The retry's retrieval failure arrives as RetrievalSignalsUnavailableError
    // holding both legs' errors; surface the typed one so the top-level catch
    // maps it to 429/504 instead of a generic 500.
    const cause =
      err.stage === "retrieve-retry"
        ? (retrievalTimeout(err.cause) ?? retrievalQuota(err.cause) ?? err.cause)
        : err.cause;
    throw new StageError(err.stage, cause);
  }
}

// Test hook: tests set this to a short value so they can exercise the
// global deadline path without waiting 30 real seconds. Null = default.
let _testDeadlineMsOverride: number | null = null;
export function _setGlobalDeadlineForTests(ms: number | null): void {
  _testDeadlineMsOverride = ms;
}

// Test hook: tests set this to a short value so they can exercise the
// retrieval-timeout path in real wall time. Null = default.
let _testRetrievalTimeoutMsOverride: number | null = null;
export function _setRetrievalTimeoutForTests(ms: number | null): void {
  _testRetrievalTimeoutMsOverride = ms;
}

interface AskRequestBody {
  question: string;
  sessionId?: string;
  /**
   * The reader asked for this answer again, or edited the question. The
   * turn named here is the one being replaced: it is dropped from stored
   * history before the new answer is generated, so the model does not
   * see itself answering the same question twice in its own context.
   */
  regenerate?: {
    previousQuestion: string;
  };
  filters?: {
    category?: string;
    startDate?: string;
    endDate?: string;
  };
}

const ASK_CATEGORIES = new Set([
  "Campus News",
  "News",
  "Sports",
  "Arts & Entertainment",
  "Opinion",
]);

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function validateAskContext(body: AskRequestBody): string | null {
  if (body.sessionId !== undefined && !isValidSessionId(body.sessionId)) {
    return "sessionId has an invalid format";
  }
  if (body.regenerate !== undefined) {
    const { regenerate } = body;
    if (typeof regenerate !== "object" || regenerate === null || Array.isArray(regenerate)) {
      return "regenerate must be an object";
    }
    if (
      typeof regenerate.previousQuestion !== "string" ||
      regenerate.previousQuestion.trim().length === 0
    ) {
      return "regenerate.previousQuestion must be a non-empty string";
    }
    // Without a session there is no stored history to correct, so a
    // regenerate flag would silently do nothing.
    if (body.sessionId === undefined) {
      return "regenerate requires sessionId";
    }
  }
  if (body.filters === undefined) return null;
  if (typeof body.filters !== "object" || body.filters === null || Array.isArray(body.filters)) {
    return "filters must be an object";
  }
  const { category, startDate, endDate } = body.filters;
  if (category !== undefined && (typeof category !== "string" || !ASK_CATEGORIES.has(category))) {
    return "filters.category is not supported";
  }
  if (startDate !== undefined && (typeof startDate !== "string" || !isValidIsoDate(startDate))) {
    return "filters.startDate must be a real date in YYYY-MM-DD format";
  }
  if (endDate !== undefined && (typeof endDate !== "string" || !isValidIsoDate(endDate))) {
    return "filters.endDate must be a real date in YYYY-MM-DD format";
  }
  if (startDate && endDate && startDate > endDate) {
    return "filters.startDate must not be after filters.endDate";
  }
  return null;
}

function resolveRetrievalFilters(
  explicit: AskRequestBody["filters"] | undefined,
  inferred: { startDate?: string; endDate?: string }
): NonNullable<AskRequestBody["filters"]> {
  const requested = explicit ?? {};
  // A caller-supplied temporal boundary is authoritative. We never combine
  // half of an explicit range with a model-inferred range because that can
  // silently create an impossible interval.
  const hasExplicitDates = Boolean(requested.startDate || requested.endDate);
  return {
    ...requested,
    startDate: hasExplicitDates ? requested.startDate : inferred.startDate,
    endDate: hasExplicitDates ? requested.endDate : inferred.endDate,
  };
}

/**
 * Whether an answer stands on evidence, so the client can tell "the
 * archive does not cover this" from a grounded reply.
 *
 * Only for producers that do not report an outcome of their own; the
 * pipeline generator and the agent loop both do, and an `error` outcome
 * from either never reaches a `done` event.
 */
function answerOutcome(citations: Citation[]): AskAnswerOutcome {
  return citations.length > 0 ? "answered" : "no_evidence";
}

/**
 * HTTP status for a producer that reported `outcome: "error"`. A quota is
 * worth waiting out, a timeout is worth retrying now, and anything else is
 * a bug — which is exactly the split `kind` already encodes.
 */
function answerErrorStatus(kind: AskErrorKind | undefined): number {
  if (kind === "timeout") return 504;
  if (kind === "rate_limit" || kind === "budget") return 429;
  return 500;
}

/**
 * Classify a thrown pipeline error for the client. A quota exhaustion is
 * worth waiting out, a timeout is worth retrying now, and anything else
 * is a bug the reader can only report — the transcript offers a different
 * affordance for each, so guessing "server" for all three (which is what
 * an SSE error without a `kind` forced the client to do) is not enough.
 */
function askStreamErrorKind(err: unknown): {
  kind: AskErrorKind;
  retryAfterSec?: number;
} {
  if (err instanceof QuotaExhaustedError || isQuotaError(err)) {
    const retryAfterSec = retryAfterSecFromQuotaError(err);
    return { kind: kindForQuota(retryAfterSec), retryAfterSec };
  }
  if (err instanceof DeadlineExceededError || err instanceof DbTimeoutError) {
    return { kind: "timeout" };
  }
  if (err instanceof Error && err.name === "AbortError") return { kind: "timeout" };
  return { kind: "server" };
}

// ── Streaming (SSE) handler ──
// When /api/ask is hit with ?stream=1, the route returns a Server-Sent
// Events stream instead of a JSON response. Events are typed:
//   - { type: "stage", name, elapsedMs }       — pipeline step completed
//   - { type: "metadata", question, mode, sourceArticles, meta }
//                                              — emitted after retrieval+rerank
//                                              — so the client can render the
//                                              — citation panel before Gemini
//                                              — streams the answer text
//   - { type: "delta", text }                  — partial answer token(s)
//   - { type: "done", answer, citations, confidence, outcome, meta }
//                                              — final event with cleaned answer
//                                              — and full metadata
//   - { type: "error", kind, stage, message, requestId, retryAfterSec?, cause? }
//                                              — any failure; stream then closes
//
// The event shapes live in src/lib/ask-stream-events.ts and are shared
// with the client, so a field the client reads cannot quietly stop being
// sent. Every error carries a `kind`: without it the transcript renders
// a quota wait, a timeout and a bug identically.
//
// Errors mid-stream cannot change HTTP status (headers already flushed);
// the client differentiates by the "error" event type.
// Concurrent-request dedup does NOT apply to streaming requests because
// the body is a ReadableStream that can't be re-read by multiple waiters.
async function handleStreamingAsk(params: {
  body: AskRequestBody;
  requestId: string;
  totalStart: number;
  sessionId: string;
  conversationHistory: import("@/src/lib/conversation-store").ConversationTurn[];
  /**
   * The request's deadline machinery, armed by POST before the body was
   * parsed so the awaits ahead of this call count against the same budget.
   * Ownership passes here: the stream clears the timer when it settles.
   */
  globalController: AbortController;
  deadlineTimer: ReturnType<typeof setTimeout>;
}): Promise<NextResponse> {
  const {
    body,
    requestId,
    totalStart,
    sessionId,
    conversationHistory,
    globalController,
    deadlineTimer,
  } = params;
  const question = body.question.trim();
  const explicitFilters = body.filters ?? {};

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AskStreamEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeAskStreamEvent(event)));
        } catch {
          // Consumer disconnected mid-write — swallow.
        }
      };

      const stageElapsed = () => Date.now() - totalStart;

      try {
        // ── Step 1: Reformulate ──
        let embeddingQuery: string;
        let ftsQuery: string;
        let mode: "text" | "visual";
        let complexity: "simple" | "complex";
        let coverageIntent: CoverageIntent | undefined;
        let inferredStartDate: string | undefined;
        let inferredEndDate: string | undefined;
        let reformulationDegraded: boolean | undefined;
        try {
          const reformulated = await reformulateQuery(question, {
            signal: globalController.signal,
            requestId,
            conversationHistory,
          });
          embeddingQuery = reformulated.embeddingQuery;
          ftsQuery = reformulated.ftsQuery;
          mode = reformulated.mode;
          complexity = reformulated.complexity;
          coverageIntent = reformulated.coverageIntent;
          inferredStartDate = reformulated.startDate;
          inferredEndDate = reformulated.endDate;
          reformulationDegraded = reformulated.reformulationDegraded;
        } catch (err) {
          console.error(
            JSON.stringify({
              level: "error",
              route: "/api/ask",
              requestId,
              stage: "reformulate",
              msg: "reformulate failed",
              err: err instanceof Error ? err.message : String(err),
            })
          );
          send({
            type: "error",
            ...askStreamErrorKind(err),
            stage: "reformulate",
            message: "Failed to reformulate question. Please try again.",
            requestId,
          });
          return;
        }
        send({
          type: "stage",
          name: "reformulate",
          elapsedMs: stageElapsed(),
          detail: embeddingQuery !== question ? embeddingQuery : undefined,
        });

        const filters = resolveRetrievalFilters(explicitFilters, {
          startDate: inferredStartDate,
          endDate: inferredEndDate,
        });
        let coverage: ArchiveCoverage | undefined;
        try {
          coverage = await resolveArchiveCoverage(
            coverageIntent,
            filters,
            globalController.signal,
            requestId
          );
        } catch (err) {
          // Coverage is supplementary caveat metadata; retrieval
          // grounding stands on its own. Degrade instead of turning
          // one failed stats query into a dead request.
          console.warn(
            JSON.stringify({
              level: "warn",
              route: "/api/ask",
              requestId,
              stage: "coverage",
              msg: "archive coverage query failed; continuing without coverage",
              err: err instanceof Error ? err.message : String(err),
            })
          );
          coverage = undefined;
        }
        if (coverage) {
          send({ type: "stage", name: "coverage", elapsedMs: stageElapsed() });
        }

        // ── Agent path for complex questions ──
        if (complexity === "complex") {
          send({ type: "stage", name: "agent", elapsedMs: stageElapsed() });
          send({
            type: "metadata",
            question,
            mode,
            requestId,
            sourceArticles: [],
            meta: {
              reformulatedQuery: embeddingQuery !== question ? embeddingQuery : undefined,
              ...(reformulationDegraded ? { reformulationDegraded: true } : {}),
              ...coverageMetadata(coverage),
            },
          });

          const conversationContext =
            conversationHistory.length > 0
              ? formatHistoryForPrompt(conversationHistory)
              : undefined;

          // The agent streams its answer text like the pipeline does, so the
          // stage pill has to move off "Researching" the same way — once,
          // just before the first token.
          let announcedGenerate = false;

          try {
            const agentResult = await runAgentLoop(question, {
              signal: globalController.signal,
              requestId,
              conversationContext,
              filters,
              coverage,
              onProgress: (event) => {
                if (event.type === "delta" && !announcedGenerate) {
                  announcedGenerate = true;
                  send({ type: "stage", name: "generate", elapsedMs: stageElapsed() });
                }
                send(event);
              },
            });

            // A research failure is not a turn. Report it and store nothing,
            // or the apology comes back as history in the next prompt.
            if (agentResult.outcome === "error") {
              send({
                type: "error",
                kind: agentResult.errorKind ?? "server",
                stage: "agent",
                message: agentResult.answer,
                requestId,
                retryAfterSec: agentResult.retryAfterSec,
              });
              return;
            }

            const agentSourceArticles = buildAgentSourceArticles(agentResult);

            // Persist what the turn actually rendered, not the raw id list:
            // buildAgentSourceArticles drops an id with no headline or date,
            // and a restored turn rebuilds its sources from what is stored,
            // so the unfiltered list resurrected a source the reader never
            // saw.
            await persistTurnBounded(
              sessionId,
              question,
              agentResult.answer,
              agentSourceArticles.map((article) => article.id),
              buildCitationSnapshots(
                agentResult.citations,
                agentSnapshotSources(agentResult.articleMeta)
              )
            );

            const totalTimeMs = Date.now() - totalStart;

            send({
              type: "done",
              answer: agentResult.answer,
              citations: agentResult.citations,
              confidence: agentResult.confidence,
              outcome: agentResult.outcome ?? answerOutcome(agentResult.citations),
              sessionId,
              requestId,
              sourceArticles: agentSourceArticles,
              meta: {
                retrievalTimeMs: agentResult.retrievalTimeMs,
                generationTimeMs: agentResult.generationTimeMs,
                totalTimeMs,
                articlesSearched: agentResult.articleMeta.size,
                method: agentResult.retrievalMethod ?? "none",
                reformulatedQuery: embeddingQuery !== question ? embeddingQuery : undefined,
                ...(reformulationDegraded ? { reformulationDegraded: true } : {}),
                complexity,
                agentSteps: agentResult.rounds,
                agentToolCalls: agentResult.toolCallCount,
                ...retrievalIdentityMetadata(),
                ...coverageMetadata(coverage),
              },
            });
          } catch (err) {
            console.error(
              JSON.stringify({
                level: "error",
                route: "/api/ask",
                requestId,
                stage: "agent",
                msg: "agent loop failed (streaming)",
                err: err instanceof Error ? err.message : String(err),
              })
            );
            send({
              type: "error",
              ...askStreamErrorKind(err),
              stage: "agent",
              message: "An error occurred while researching your question. Please try again.",
              requestId,
            });
          }
          return;
        }

        // ── Step 2: Retrieve independent lexical + vector signals ──
        const retrievalTimeoutMs = _testRetrievalTimeoutMsOverride ?? RETRIEVAL_TIMEOUT_MS;
        const retrievalLimit = mode === "visual" ? 30 : 20;
        const vectorWeight = mode === "visual" ? 0.7 : 0.6;
        const onlyWithImages = mode === "visual";

        let articles: RetrievedArticle[];
        let method: RetrievalMethod = "hybrid";
        let retrievalTimeMs = 0;
        let retrievalIdentity = getRagRetrievalConfig();

        try {
          const retrieval = await retrieveCandidates({
            embeddingQuery,
            ftsQuery,
            limit: retrievalLimit,
            filters,
            vectorWeight,
            onlyWithImages,
            timeoutMs: retrievalTimeoutMs,
            signal: globalController.signal,
            requestId,
          });
          articles = retrieval.articles;
          method = retrieval.method;
          retrievalTimeMs = retrieval.retrievalTimeMs;
          retrievalIdentity = retrieval.identity;
        } catch (err) {
          const timeoutError = retrievalTimeout(err);
          const quotaError = retrievalQuota(err);
          if (timeoutError || globalController.signal.aborted) {
            send({
              type: "error",
              kind: "timeout",
              stage: "retrieve",
              message: "Retrieval took too long. Please try again.",
              requestId,
            });
            return;
          }
          send({
            type: "error",
            ...askStreamErrorKind(quotaError ?? err),
            stage: "retrieve",
            cause: quotaError ? "quota_exhausted" : undefined,
            message: quotaError
              ? "Vector quota was exhausted and full-text retrieval also failed. Please try again later."
              : "Retrieval failed. Please try again.",
            requestId,
          });
          return;
        }
        send({ type: "stage", name: "retrieve", elapsedMs: stageElapsed() });

        // ── Step 3: Rerank ──
        // Text answers: 6 sources post-rerank — answer F1 peaks near 3-6 kept
        // sources and declines as distractors accumulate; also trims ~40% off
        // the generation prompt. Visual mode keeps a wider pool for image
        // selection (accuracy band-gated by the holdout eval).
        const keepTopK = mode === "visual" ? 15 : 6;
        logRerankSignals(requestId, computeRerankSignals(articles), mode, "streaming");

        let rankedArticles: RankedArticle[];
        try {
          rankedArticles = await rerankWithCragRetry({
            question,
            articles,
            mode,
            keepTopK,
            conversationHistory,
            filters,
            retrievalLimit,
            vectorWeight,
            onlyWithImages,
            retrievalTimeoutMs,
            signal: globalController.signal,
            requestId,
          });
        } catch (err) {
          // Map typed errors back to SSE error events with the
          // specific stage tag so clients + logs can distinguish
          // a retry-stage quota-exhausted from a primary rerank
          // failure. The helper wraps retry-stage typed errors
          // in StageError with cause=underlying error.
          const stage = err instanceof StageError ? err.stage : "rerank";
          const cause = err instanceof StageError ? err.cause : err;
          const message =
            cause instanceof QuotaExhaustedError
              ? "Daily AI quota reached. Please try again later."
              : cause instanceof DeadlineExceededError
                ? "Request timed out. Please try again."
                : cause instanceof DbTimeoutError
                  ? "Retrieval took too long. Please try again."
                  : "Reranking failed. Please try again.";
          console.error(
            JSON.stringify({
              level: "error",
              route: "/api/ask",
              requestId,
              stage,
              msg: "rerank-with-retry failed (streaming)",
              err: cause instanceof Error ? cause.message : String(cause),
            })
          );
          send({
            type: "error",
            ...askStreamErrorKind(cause),
            stage,
            message,
            requestId,
          });
          return;
        }
        send({ type: "stage", name: "rerank", elapsedMs: stageElapsed() });

        // No judge ever scored these candidates, so the reader is told the
        // sources are unvetted and the generator caps confidence at low.
        const rerankDegraded = rankedArticles.some((a) => a.rerankDegraded === true);

        // Emit metadata BEFORE generation so client can render the
        // citation sidebar immediately, before the answer tokens start
        // streaming in.
        const sourceArticles = rankedArticles.map((a) => ({
          id: a.id,
          contentRevisionId: a.contentRevisionId,
          headline: a.headline,
          editionDate: a.editionDate,
          category: a.category,
          summary: a.summary,
          byline: a.byline,
          bodySnippet:
            (a.bodyPlain || "").slice(0, 300) + ((a.bodyPlain || "").length > 300 ? "\u2026" : ""),
          distance: a.distance !== null ? parseFloat(a.distance.toFixed(4)) : null,
          imageUrls: a.imageUrls,
          imageCaptions: a.imageCaptions,
        }));

        send({
          type: "metadata",
          question,
          mode,
          requestId,
          sourceArticles,
          meta: {
            retrievalTimeMs,
            articlesSearched: articles.length,
            method,
            reformulatedQuery: embeddingQuery !== question ? embeddingQuery : undefined,
            ...(reformulationDegraded ? { reformulationDegraded: true } : {}),
            ...(rerankDegraded ? { rerankDegraded: true } : {}),
            ...retrievalIdentityMetadata(retrievalIdentity),
          },
        });

        // ── Step 4: Generate (streaming) ──
        // Announced before the first token so the reader sees "Writing
        // answer" during the generation wait. Without it the pill sat on
        // "Ranking sources" for the whole slowest stage.
        send({ type: "stage", name: "generate", elapsedMs: stageElapsed() });
        const generationStart = Date.now();
        let finalAnswer = "";
        let finalCitations: Citation[] = [];
        let finalConfidence: "low" | "medium" | "high" = "low";
        let finalFollowUps: string[] = [];
        let finalOutcome: AnswerOutcome = "no_evidence";
        let finalErrorKind: AskErrorKind | undefined;
        let finalRetryAfterSec: number | undefined;

        try {
          for await (const event of generateAnswerStream(question, rankedArticles, {
            signal: globalController.signal,
            requestId,
            conversationContext:
              conversationHistory.length > 0
                ? formatHistoryForPrompt(conversationHistory)
                : undefined,
            coverage,
          })) {
            if (event.type === "delta") {
              send({ type: "delta", text: event.text });
            } else if (event.type === "done") {
              finalAnswer = event.answer;
              finalCitations = event.citations;
              finalConfidence = event.confidence;
              finalFollowUps = event.followUps;
              finalOutcome = event.outcome;
              finalErrorKind = event.errorKind;
              finalRetryAfterSec = event.retryAfterSec;
            }
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              level: "error",
              route: "/api/ask",
              requestId,
              stage: "generate",
              msg: "generate stream failed (streaming)",
              err: err instanceof Error ? err.message : String(err),
            })
          );
          send({
            type: "error",
            ...askStreamErrorKind(err),
            stage: "generate",
            message: "An error occurred during answer generation. Please try again.",
            requestId,
          });
          return;
        }

        const generationTimeMs = Date.now() - generationStart;
        const totalTimeMs = Date.now() - totalStart;

        // A canned apology is not an answer. Report it as an error and, above
        // all, do not persist it: stored, it came back as conversation history
        // and the next prompt showed the model apologising for a failure it
        // never made.
        if (finalOutcome === "error") {
          send({
            type: "error",
            kind: finalErrorKind ?? "server",
            stage: "generate",
            message: finalAnswer || "An error occurred during answer generation. Please try again.",
            requestId,
            retryAfterSec: finalRetryAfterSec,
          });
          return;
        }

        await persistTurnBounded(
          sessionId,
          question,
          finalAnswer,
          finalCitations.map((c) => c.articleId),
          buildCitationSnapshots(finalCitations, rankedArticles)
        );

        send({
          type: "done",
          answer: finalAnswer,
          citations: finalCitations,
          confidence: finalConfidence,
          outcome: finalOutcome,
          sessionId,
          requestId,
          followUpQuestions: finalFollowUps,
          meta: {
            retrievalTimeMs,
            generationTimeMs,
            totalTimeMs,
            articlesSearched: articles.length,
            method,
            reformulatedQuery: embeddingQuery !== question ? embeddingQuery : undefined,
            ...(reformulationDegraded ? { reformulationDegraded: true } : {}),
            ...(rerankDegraded ? { rerankDegraded: true } : {}),
            complexity,
            ...retrievalIdentityMetadata(retrievalIdentity),
            ...coverageMetadata(coverage),
          },
        });
      } catch (err) {
        // Top-level safety net (deadline aborts, unexpected throws)
        const isDeadline = err instanceof DeadlineExceededError;
        const message = isDeadline
          ? "Request took too long. Please try a simpler question."
          : "An unexpected error occurred. Please try again.";
        console.error(
          JSON.stringify({
            level: "error",
            route: "/api/ask",
            requestId,
            stage: isDeadline ? "deadline" : "unknown",
            msg: "streaming pipeline unhandled error",
            err: message,
          })
        );
        send({
          type: "error",
          kind: isDeadline ? "timeout" : "server",
          stage: isDeadline ? "deadline" : "unknown",
          message,
          requestId,
        });
      } finally {
        closed = true;
        clearTimeout(deadlineTimer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // Client disconnected — abort the pipeline and clean up.
      globalController.abort();
      clearTimeout(deadlineTimer);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      // Nginx/CDN hint: disable proxy buffering so events arrive in real time.
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const totalStart = Date.now();
  const requestId = newRequestId();
  const deadlineMs = _testDeadlineMsOverride ?? GLOBAL_DEADLINE_MS;

  // Rate limiting lives in middleware.ts (the `mw-ask` bucket, 10/min per IP)
  // — not here. A second bucket in this route meant two Neon writes per
  // question. The IP is still needed as the dedup key below.
  const ip = getClientIp(request);

  // ── Global deadline ──
  // Armed before the body is parsed so every await on the request path counts
  // against it: when it was armed after the budget check instead, a slow
  // pre-pipeline await bought the pipeline a fresh `deadlineMs` on top of time
  // already spent, past Vercel's own maxDuration. The AbortController lets
  // signal-aware libs cancel their in-flight fetches; the Promise.race below
  // returns even if those libs ignore the signal.
  const globalController = new AbortController();
  let rejectDeadline!: (error: DeadlineExceededError) => void;
  const deadlinePromise = new Promise<NextResponse>((_, reject) => {
    rejectDeadline = reject;
  });
  const globalTimer = setTimeout(() => {
    globalController.abort();
    rejectDeadline(new DeadlineExceededError(deadlineMs));
  }, deadlineMs);
  // Nothing awaits the deadline until the race below, and an early return
  // never awaits it at all — this no-op handler keeps a fired deadline from
  // surfacing as an unhandled rejection. Promise.race still observes it.
  deadlinePromise.catch(() => {});
  // Every early return happens before the race that clears the timer, so
  // route them through here: a 400 must not leave a timer armed for a minute.
  const bail = (params: Parameters<typeof askErrorJson>[0]): NextResponse => {
    clearTimeout(globalTimer);
    return askErrorJson(params);
  };

  // ── Parse + validate body ──
  let body: AskRequestBody;
  try {
    body = (await request.json()) as AskRequestBody;
  } catch {
    return bail({
      status: 400,
      kind: "bad_request",
      message: "Invalid JSON body",
    });
  }

  if (!body.question || typeof body.question !== "string") {
    return bail({
      status: 400,
      kind: "bad_request",
      message: "Missing required field: question",
    });
  }
  const question = body.question.trim();
  if (question.length === 0) {
    return bail({
      status: 400,
      kind: "bad_request",
      message: "Question cannot be empty",
    });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return bail({
      status: 400,
      kind: "bad_request",
      message: `Question too long (${question.length} chars). Maximum is ${MAX_QUESTION_LENGTH}.`,
    });
  }
  const contextValidationError = validateAskContext(body);
  if (contextValidationError) {
    return bail({
      status: 400,
      kind: "bad_request",
      message: contextValidationError,
    });
  }

  // ── Daily budget kill switch ──
  // Fail fast if the project has already burned through today's AI
  // spend ceiling. Covers both streaming and non-streaming paths
  // before any Gemini call is issued.
  try {
    await checkDailyBudget();
  } catch (err) {
    if (err instanceof DailyBudgetExceededError) {
      const evaluationBudget = err.scope === "evaluation_run";
      console.warn(
        JSON.stringify({
          level: "warn",
          route: "/api/ask",
          requestId,
          stage: "budget",
          msg: evaluationBudget ? "evaluation run budget exceeded" : "daily budget exceeded",
          spentUsd: err.spentUsd,
          budgetUsd: err.budgetUsd,
        })
      );
      return bail({
        status: 429,
        kind: "budget",
        message: evaluationBudget
          ? "Evaluation spending cap reached. Start a separately approved run to continue."
          : "Daily AI budget reached. Please try again tomorrow.",
        // Until the counter actually rolls over, not a flat hour — the
        // refusal says "tomorrow", so the countdown beside it has to
        // agree or it invites a retry that is certain to fail.
        retryAfterSec: evaluationBudget ? undefined : secondsUntilBudgetReset(),
        cause: evaluationBudget ? "evaluation_budget_reached" : "daily_budget_reached",
        stage: "budget",
        requestId,
      });
    }
    clearTimeout(globalTimer);
    throw err;
  }

  // ── Session handling ──
  const sessionId = body.sessionId ?? newSessionId();
  // Drop the superseded turn before reading history, never after: the
  // replacement answer would otherwise be generated with the answer it
  // replaces still in context. Validation guarantees a sessionId here.
  if (body.regenerate && body.sessionId) {
    await deleteLatestTurn(body.sessionId, body.regenerate.previousQuestion);
  }
  const historySessionId = body.sessionId;
  // History is best-effort context, not a system of record, so a slow Neon
  // costs this follow-up its context rather than the whole answer. Raced
  // because the driver has no AbortSignal support of its own.
  const conversationHistory = historySessionId
    ? await runWithDbTimeout(
        "getConversationHistory",
        () => getConversationHistory(historySessionId),
        CONVERSATION_HISTORY_TIMEOUT_MS
      ).catch((err) => {
        console.warn(
          JSON.stringify({
            level: "warn",
            route: "/api/ask",
            requestId,
            stage: "session",
            msg: "history read exceeded its budget; answering without context",
            err: err instanceof Error ? err.message : String(err),
          })
        );
        return [];
      })
    : [];

  // ── Streaming branch ──
  // If the client requested ?stream=1, return an SSE stream that emits
  // stage/metadata/delta/done/error events as the pipeline progresses.
  // Dedup + the existing JSON response path are bypassed for streaming
  // because a ReadableStream body can't be re-read by multiple waiters.
  const url = new URL(request.url);
  const isStreaming = url.searchParams.get("stream") === "1";
  if (isStreaming) {
    return handleStreamingAsk({
      body: { question, filters: body.filters },
      requestId,
      totalStart,
      sessionId,
      conversationHistory,
      globalController,
      deadlineTimer: globalTimer,
    });
  }

  // ── Concurrent request dedup ──
  // If an identical (ip, question, filters) request is already in
  // flight, piggyback on it instead of running the full pipeline again.
  // Falls through (runs our own) if the in-flight one rejects.
  const evaluationMode = isRagEvaluationMode();
  const dedupId = dedupKey(ip, question, body.filters, sessionId);
  const existingEntry = evaluationMode ? undefined : inFlightAsk.get(dedupId);
  if (existingEntry) {
    try {
      const data = await getOrExtract(existingEntry);
      clearTimeout(globalTimer);
      return freshResponseFromCached(data);
    } catch {
      // Existing pipeline rejected; fall through.
    }
  }

  const pipelinePromise = (async (): Promise<NextResponse> => {
    // ── Step 1: Reformulate query for better retrieval ──
    const reformulated = await wrapStage("reformulate", () =>
      reformulateQuery(question, {
        signal: globalController.signal,
        requestId,
        conversationHistory,
      })
    );
    const { embeddingQuery, ftsQuery, mode, complexity, coverageIntent, reformulationDegraded } =
      reformulated;
    const filters = resolveRetrievalFilters(body.filters, reformulated);
    // Coverage is supplementary caveat metadata — a failed stats query
    // degrades to "no coverage" rather than failing the whole request.
    const coverage = await wrapStage("coverage", () =>
      resolveArchiveCoverage(coverageIntent, filters, globalController.signal, requestId)
    ).catch((err: unknown) => {
      console.warn(
        JSON.stringify({
          level: "warn",
          route: "/api/ask",
          requestId,
          stage: "coverage",
          msg: "archive coverage query failed; continuing without coverage",
          err: err instanceof Error ? err.message : String(err),
        })
      );
      return undefined;
    });

    // ── Agent path for complex questions ──
    if (complexity === "complex") {
      const conversationContext =
        conversationHistory.length > 0 ? formatHistoryForPrompt(conversationHistory) : undefined;

      const agentResult = await wrapStage("agent", () =>
        runAgentLoop(question, {
          signal: globalController.signal,
          requestId,
          conversationContext,
          filters,
          coverage,
        })
      );

      // A research failure is not a turn. Report it typed and store nothing.
      if (agentResult.outcome === "error") {
        return askErrorJson({
          status: answerErrorStatus(agentResult.errorKind),
          kind: agentResult.errorKind ?? "server",
          message: agentResult.answer,
          retryAfterSec: agentResult.retryAfterSec,
          stage: "agent",
          requestId,
        });
      }

      const agentSourceArticles = buildAgentSourceArticles(agentResult);

      // Persist what the turn actually rendered — see the streaming branch.
      await persistTurnBounded(
        sessionId,
        question,
        agentResult.answer,
        agentSourceArticles.map((article) => article.id),
        buildCitationSnapshots(agentResult.citations, agentSnapshotSources(agentResult.articleMeta))
      );

      const response: AskResponse = {
        question,
        answer: agentResult.answer,
        citations: agentResult.citations,
        confidence: agentResult.confidence,
        mode,
        requestId,
        sessionId,
        sourceArticles: agentSourceArticles,
        meta: {
          retrievalTimeMs: agentResult.retrievalTimeMs,
          generationTimeMs: agentResult.generationTimeMs,
          totalTimeMs: Date.now() - totalStart,
          articlesSearched: agentResult.articleMeta.size,
          method: agentResult.retrievalMethod ?? "none",
          reformulatedQuery: embeddingQuery !== question ? embeddingQuery : undefined,
          ...(reformulationDegraded ? { reformulationDegraded: true } : {}),
          complexity,
          agentSteps: agentResult.rounds,
          agentToolCalls: agentResult.toolCallCount,
          ...retrievalIdentityMetadata(),
          ...coverageMetadata(coverage),
        },
      };
      return NextResponse.json(response);
    }

    // ── Step 2: Retrieve independent lexical + vector signals ──
    let articles: RetrievedArticle[];
    let method: RetrievalMethod = "hybrid";
    let retrievalTimeMs = 0;
    let retrievalIdentity = getRagRetrievalConfig();
    // Visual mode retrieves more candidates since we pre-filter to articles
    // with images (smaller pool, need wider net to find relevant photos)
    const retrievalLimit = mode === "visual" ? 30 : 20;

    const retrievalTimeoutMs = _testRetrievalTimeoutMsOverride ?? RETRIEVAL_TIMEOUT_MS;
    // Adaptive vector/FTS weighting based on query mode:
    // Visual queries (conceptual "show me X") favor vector similarity (0.7)
    // Text queries (factual, often keyword-heavy) get more FTS weight (0.4)
    const vectorWeight = mode === "visual" ? 0.7 : 0.6;
    // Visual mode restricts retrieval to articles with images so the gallery
    // has enough content even after reranking filters out weak matches.
    const onlyWithImages = mode === "visual";

    try {
      const retrieval = await retrieveCandidates({
        embeddingQuery,
        ftsQuery,
        limit: retrievalLimit,
        filters,
        vectorWeight,
        onlyWithImages,
        timeoutMs: retrievalTimeoutMs,
        signal: globalController.signal,
        requestId,
      });
      articles = retrieval.articles;
      method = retrieval.method;
      retrievalTimeMs = retrieval.retrievalTimeMs;
      retrievalIdentity = retrieval.identity;
    } catch (err) {
      const timeoutError = retrievalTimeout(err);
      const quotaError = retrievalQuota(err);
      if (timeoutError || globalController.signal.aborted) {
        return askErrorJson({
          status: 504,
          kind: "timeout",
          message: "Retrieval took too long. Please try again.",
          stage: "retrieve",
          requestId,
        });
      }
      if (quotaError) {
        return askErrorJson({
          status: 429,
          kind: "budget",
          message:
            "Vector quota was exhausted and full-text retrieval also failed. Please try again later.",
          retryAfterSec: 3600,
          cause: "quota_exhausted",
          stage: "retrieve",
          requestId,
        });
      }
      throw new StageError("retrieve", err);
    }

    // ── Step 3: Re-rank articles by relevance ──
    // Visual mode uses a lower threshold (3 = tangentially related) because
    // the user's goal is seeing photos, not precise answers — "somewhat related"
    // photos are still valuable. Text mode stays stricter at 4.
    const keepTopK = mode === "visual" ? 15 : 6;
    logRerankSignals(requestId, computeRerankSignals(articles), mode, "default");

    const rankedArticles = await rerankWithCragRetry({
      question,
      articles,
      mode,
      keepTopK,
      conversationHistory,
      filters,
      retrievalLimit,
      vectorWeight,
      onlyWithImages,
      retrievalTimeoutMs,
      signal: globalController.signal,
      requestId,
    });
    // No judge ever scored these candidates, so the reader is told the
    // sources are unvetted and the generator caps confidence at low.
    const rerankDegraded = rankedArticles.some((a) => a.rerankDegraded === true);

    // ── Step 4: Generate answer (using ORIGINAL question, not reformulated) ──
    const generationStart = Date.now();
    const { answer, citations, confidence, followUps, outcome, errorKind, retryAfterSec } =
      await wrapStage("generate", () =>
        generateAnswer(question, rankedArticles, {
          signal: globalController.signal,
          requestId,
          conversationContext:
            conversationHistory.length > 0
              ? formatHistoryForPrompt(conversationHistory)
              : undefined,
          coverage,
        })
      );
    const generationTimeMs = Date.now() - generationStart;

    // A canned apology is not an answer: return it typed, and never store it
    // as history for the next turn's prompt to read back.
    if (outcome === "error") {
      return askErrorJson({
        status: answerErrorStatus(errorKind),
        kind: errorKind ?? "server",
        message: answer || "An error occurred during answer generation. Please try again.",
        retryAfterSec,
        stage: "generate",
        requestId,
      });
    }

    // ── Store conversation turn ──
    await persistTurnBounded(
      sessionId,
      question,
      answer,
      citations.map((c) => c.articleId),
      buildCitationSnapshots(citations, rankedArticles)
    );

    // ── Build response ──
    const response: AskResponse = {
      question,
      answer,
      citations,
      confidence,
      mode,
      requestId,
      sessionId,
      sourceArticles: rankedArticles.map((a) => ({
        id: a.id,
        contentRevisionId: a.contentRevisionId,
        headline: a.headline,
        editionDate: a.editionDate,
        category: a.category,
        summary: a.summary,
        byline: a.byline,
        bodySnippet:
          (a.bodyPlain || "").slice(0, 300) + ((a.bodyPlain || "").length > 300 ? "…" : ""),
        distance: a.distance !== null ? parseFloat(a.distance.toFixed(4)) : null,
        imageUrls: a.imageUrls,
        imageCaptions: a.imageCaptions,
      })),
      followUpQuestions: followUps,
      meta: {
        retrievalTimeMs,
        generationTimeMs,
        totalTimeMs: Date.now() - totalStart,
        articlesSearched: articles.length,
        method,
        reformulatedQuery: embeddingQuery !== question ? embeddingQuery : undefined,
        ...(reformulationDegraded ? { reformulationDegraded: true } : {}),
        ...(rerankDegraded ? { rerankDegraded: true } : {}),
        complexity,
        ...retrievalIdentityMetadata(retrievalIdentity),
        ...coverageMetadata(coverage),
      },
    };

    return NextResponse.json(response);
  })();

  // Register the in-flight pipeline promise in the dedup map BEFORE the
  // race so concurrent duplicate requests that arrive after this point
  // can find it. The entry stores the racing promise so dedup hits get
  // the same deadline behavior as the original.
  const racePromise = Promise.race([pipelinePromise, deadlinePromise]);
  const dedupEntry: DedupEntry = { promise: racePromise };
  if (!evaluationMode) inFlightAsk.set(dedupId, dedupEntry);

  try {
    return await racePromise;
  } catch (err) {
    if (err instanceof DeadlineExceededError) {
      return askErrorJson({
        status: 504,
        kind: "timeout",
        message: "Request took too long. Please try a simpler question.",
        stage: "deadline",
        requestId,
      });
    }
    if (err instanceof QuotaExhaustedError) {
      // wrapStage deliberately rethrows this one bare (it is already
      // specific), but the StageError branch below only unwraps a *wrapped*
      // cause — so an unwrapped quota error used to fall through to the
      // generic 500 and the reader was told to report a bug instead of to
      // come back later.
      const retryAfterSec = retryAfterSecFromQuotaError(err);
      console.warn(
        JSON.stringify({
          level: "warn",
          route: "/api/ask",
          requestId,
          stage: "pipeline",
          msg: "gemini quota exhausted",
          retryAfterSec,
        })
      );
      return askErrorJson({
        status: 429,
        kind: kindForQuota(retryAfterSec),
        message: "AI quota reached. Please try again later.",
        retryAfterSec,
        cause: "quota_exhausted",
        stage: "pipeline",
        requestId,
      });
    }
    if (err instanceof StageError) {
      // Unwrap the cause so retry-stage typed errors (QuotaExhaustedError
      // or the "Retrieval timeout" marker) map to 429/504 instead of
      // the generic 500. This mirrors the inline handling at the
      // primary embed/retrieve stages.
      if (err.cause instanceof QuotaExhaustedError) {
        console.warn(
          JSON.stringify({
            level: "warn",
            route: "/api/ask",
            requestId,
            stage: err.stage,
            msg: "quota exhausted",
            err: err.cause.message,
          })
        );
        return askErrorJson({
          status: 429,
          kind: "budget",
          message: "Daily AI quota reached. Please try again tomorrow.",
          retryAfterSec: 3600,
          cause: "quota_exhausted",
          stage: err.stage,
          requestId,
        });
      }
      if (err.cause instanceof DbTimeoutError) {
        console.warn(
          JSON.stringify({
            level: "warn",
            route: "/api/ask",
            requestId,
            stage: err.stage,
            msg: "retrieval timeout",
          })
        );
        return askErrorJson({
          status: 504,
          kind: "timeout",
          message: "Retrieval took too long. Please try again.",
          stage: err.stage,
          requestId,
        });
      }
      console.error(
        JSON.stringify({
          level: "error",
          route: "/api/ask",
          requestId,
          stage: err.stage,
          msg: "stage error",
          err: err.cause instanceof Error ? err.cause.message : String(err.cause),
        })
      );
      return askErrorJson({
        status: 500,
        kind: "server",
        message: "An unexpected error occurred. Please try again.",
        stage: err.stage,
        requestId,
      });
    }
    console.error(
      JSON.stringify({
        level: "error",
        route: "/api/ask",
        requestId,
        stage: "unknown",
        msg: "unhandled error",
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    );
    return askErrorJson({
      status: 500,
      kind: "server",
      message: "An unexpected error occurred. Please try again.",
      requestId,
    });
  } finally {
    clearTimeout(globalTimer);
    // Auto-evict after TTL so a long-completed entry doesn't pin
    // memory. We don't delete immediately because slow concurrent
    // dups still need a window to read the cached body.
    if (!evaluationMode) {
      setTimeout(() => {
        if (inFlightAsk.get(dedupId) === dedupEntry) {
          inFlightAsk.delete(dedupId);
        }
      }, DEDUP_TTL_MS);
    }
  }
}
