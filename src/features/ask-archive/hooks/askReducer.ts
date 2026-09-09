/**
 * askReducer — pure state machine for the transcript UI.
 *
 * Each Turn is a Q/A pair with its own `status` ("streaming" | "done" |
 * "stopped" | "error"). Submitting a question appends an optimistic user
 * turn; SSE events fill in the assistant fields; a `done` event freezes
 * the turn; a `TURN_ERROR` replaces the assistant region with a typed
 * error row; `TURN_STOPPED` freezes it with whatever text arrived.
 *
 * "streaming" is the only non-terminal status, and it is the gate on
 * every assistant-side event: a turn that has already settled cannot be
 * reanimated by a frame that arrives after the reader stopped it, left
 * the thread, or asked something else. Without that gate a late `done`
 * from an abandoned stream would overwrite a turn the reader considers
 * finished, and the composer would flip back to disabled.
 *
 * The reducer has no I/O — the hook that owns it handles fetch, SSE
 * parsing, session-id mint, and localStorage. Keeping this file pure
 * means the interesting state transitions are unit-testable without
 * mocking streams or storage.
 */

import type { AskResponse, AskErrorKind } from "@/src/types";

export type TurnStatus = "streaming" | "done" | "stopped" | "error";

export interface Turn {
  id: string;
  question: string;
  answer: string;
  status: TurnStatus;
  /** Optional current stage label for the "Thinking…" pill. */
  stage?: string;
  sourceArticles: AskResponse["sourceArticles"];
  citations: AskResponse["citations"];
  meta: AskResponse["meta"] | null;
  followUpQuestions?: string[];
  confidence: AskResponse["confidence"];
  requestId: string;
  mode: "text" | "visual";
  createdAt: number;
  errorKind?: AskErrorKind;
  errorMessage?: string;
  retryAfterSec?: number;
  /**
   * The reader's rating of this answer. Optimistic — set the moment the
   * button is pressed and rolled back if the POST is refused, so the
   * control never lies about what the server accepted.
   */
  feedback?: "up" | "down";
}

/**
 * Reason the transcript is currently empty — drives the in-chat empty-
 * state UI when the user is past the first visit. `null` means either
 * pristine first visit (handled at page level) or the user just
 * submitted and turns haven't arrived yet.
 */
export type EmptyReason = "cleared" | "new" | null;

/**
 * A pointer-level summary of an archived thread, used to render the
 * sidebar thread list without hauling every turn's body into the
 * reducer. The full turn history lives in localStorage keyed by
 * `id` — the hook round-trips to the archive on switch.
 */
export interface ThreadSummary {
  /** Matches the thread's sessionId (the two are the same identifier). */
  id: string;
  /** First user question — the sidebar's title when the reader hasn't set one. */
  firstQuestion: string;
  /** A name the reader gave this thread. Falls back to `firstQuestion`. */
  title?: string;
  /** Number of Q/A pairs in the thread. */
  turnCount: number;
  /** Last time any turn in the thread was mutated (ms since epoch). */
  lastUpdatedAt: number;
}

export interface AskState {
  turns: Turn[];
  isHydrating: boolean;
  /** True iff the last /api/ask/session response reported `expired:true`. */
  expiredBanner: boolean;
  sessionGen: number;
  emptyReason: EmptyReason;
  /** All archived threads — includes the active one if it has turns. */
  threads: ThreadSummary[];
  /** The thread currently in `turns`. null before the first BOOT tick. */
  activeThreadId: string | null;
}

export type AskAction =
  | { type: "HYDRATING" }
  | {
      type: "HYDRATE";
      turns: Turn[];
      expired: boolean;
      threads?: ThreadSummary[];
      activeThreadId?: string | null;
      /** Ignore a stale restore that completed after local interaction. */
      preserveCurrentState?: boolean;
    }
  | {
      type: "SET_THREADS";
      threads: ThreadSummary[];
      /** Omit to refresh the summaries without moving the active thread. */
      activeThreadId?: string | null;
    }
  | {
      type: "SWITCH_THREAD";
      activeThreadId: string;
      turns: Turn[];
    }
  | { type: "APPEND_USER"; id: string; question: string; createdAt?: number }
  | {
      type: "TURN_META";
      id: string;
      mode: "text" | "visual";
      requestId: string;
      sourceArticles: AskResponse["sourceArticles"];
      meta: Partial<AskResponse["meta"]>;
    }
  | { type: "TURN_STAGE"; id: string; stage: string }
  | { type: "TURN_DELTA"; id: string; text: string }
  | {
      type: "TURN_DONE";
      id: string;
      answer: string;
      citations: AskResponse["citations"];
      confidence: AskResponse["confidence"];
      meta: AskResponse["meta"];
      sourceArticles?: AskResponse["sourceArticles"];
      followUpQuestions?: string[];
    }
  | {
      type: "TURN_ERROR";
      id: string;
      kind: AskErrorKind;
      message: string;
      retryAfterSec?: number;
    }
  | { type: "TURN_STOPPED"; id: string }
  /** Undefined clears the vote — both the toggle-off and the rollback. */
  | { type: "TURN_FEEDBACK"; id: string; feedback?: "up" | "down" }
  | { type: "TURN_RESTART"; id: string; question: string }
  // Both carry the freshly minted thread pointer so it lands in the same
  // dispatch that empties the transcript, rather than depending on a
  // follow-up SET_THREADS to repair it.
  | { type: "CLEAR_ALL_THREADS"; activeThreadId?: string | null; threads?: ThreadSummary[] }
  | { type: "NEW_CONVERSATION"; activeThreadId?: string | null; threads?: ThreadSummary[] };

export const INITIAL_STATE: AskState = {
  turns: [],
  // The first client effect reconciles the saved local/server session.
  // Starting true closes the pre-effect window in which a deep link or
  // manual submit could race that restore and then be overwritten by it.
  isHydrating: true,
  expiredBanner: false,
  sessionGen: 0,
  emptyReason: null,
  threads: [],
  activeThreadId: null,
};

function emptyTurn(id: string, question: string, createdAt: number): Turn {
  return {
    id,
    question,
    answer: "",
    status: "streaming",
    sourceArticles: [],
    citations: [],
    meta: null,
    confidence: "low",
    requestId: "",
    mode: "text",
    createdAt,
  };
}

function updateTurn(state: AskState, id: string, updater: (t: Turn) => Turn): AskState {
  let changed = false;
  const turns = state.turns.map((t) => {
    if (t.id !== id) return t;
    const next = updater(t);
    // An updater that declines the update (a settled turn, an event for
    // a turn that no longer exists) must not produce a new array — the
    // archive effect keys off `state.turns` identity.
    if (next === t) return t;
    changed = true;
    return next;
  });
  return changed ? { ...state, turns } : state;
}

/**
 * Apply an assistant-side stream event only while the turn is still
 * streaming. Every other status is terminal, so a frame that arrives
 * after the reader stopped the answer or moved on is dropped.
 */
function updateStreamingTurn(state: AskState, id: string, updater: (t: Turn) => Turn): AskState {
  return updateTurn(state, id, (t) => (t.status === "streaming" ? updater(t) : t));
}

export function askReducer(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case "HYDRATING":
      return { ...state, isHydrating: true };
    case "HYDRATE":
      if (action.preserveCurrentState) {
        // The reader interacted while the restore was in flight, so
        // their turns win — but the thread pointer and the sidebar
        // summaries still apply. Dropping them left `activeThreadId`
        // null, and the persist effect keys off it, so a conversation
        // started during hydration was never archived at all: it
        // vanished on reload with no way to get it back.
        return {
          ...state,
          isHydrating: false,
          threads: state.threads.length === 0 && action.threads ? action.threads : state.threads,
          activeThreadId: state.activeThreadId ?? action.activeThreadId ?? null,
        };
      }
      return {
        ...state,
        turns: action.turns,
        isHydrating: false,
        expiredBanner: action.expired,
        // Any hydration supersedes a prior cleared/new empty
        // reason — turns either exist or don't on their own.
        emptyReason: null,
        threads: action.threads !== undefined ? action.threads : state.threads,
        activeThreadId:
          action.activeThreadId !== undefined ? action.activeThreadId : state.activeThreadId,
      };
    case "SET_THREADS":
      return {
        ...state,
        threads: action.threads,
        activeThreadId:
          action.activeThreadId !== undefined ? action.activeThreadId : state.activeThreadId,
      };
    case "SWITCH_THREAD":
      // Replace the working transcript with the target thread's
      // turns. Bump sessionGen so the composer refocuses (same
      // mechanic as Clear/New). emptyReason stays null because
      // the thread already has turns.
      return {
        ...state,
        turns: action.turns,
        activeThreadId: action.activeThreadId,
        isHydrating: false,
        expiredBanner: false,
        emptyReason: null,
        sessionGen: state.sessionGen + 1,
      };
    case "APPEND_USER": {
      // If the most recent turn is still "streaming" when a new
      // question arrives, freeze it with whatever partial answer it
      // has — avoids a zombie spinner in the transcript. It settles to
      // "stopped", not "done": the answer was cut off, and calling a
      // truncated paragraph "done" hides that from the reader and from
      // the archive.
      const frozen = state.turns.map((t, i) =>
        i === state.turns.length - 1 && t.status === "streaming"
          ? { ...t, status: "stopped" as const, stage: undefined }
          : t
      );
      return {
        ...state,
        // Any new question clears an expired banner — the user
        // has started a fresh conversation in intent.
        expiredBanner: false,
        // And clears any "cleared" / "new" empty-state marker —
        // we're populating turns again.
        emptyReason: null,
        turns: [...frozen, emptyTurn(action.id, action.question, action.createdAt ?? Date.now())],
      };
    }
    case "TURN_META":
      return updateStreamingTurn(state, action.id, (t) => ({
        ...t,
        mode: action.mode,
        requestId: action.requestId,
        sourceArticles: action.sourceArticles,
        meta: { ...(t.meta ?? ({} as AskResponse["meta"])), ...action.meta } as AskResponse["meta"],
      }));
    case "TURN_STAGE":
      return updateStreamingTurn(state, action.id, (t) => ({
        ...t,
        stage: action.stage,
      }));
    case "TURN_DELTA":
      return updateStreamingTurn(state, action.id, (t) => ({
        ...t,
        answer: t.answer + action.text,
        // First delta removes the stage pill — streaming text now
        // replaces it as the visual progress indicator.
        stage: undefined,
      }));
    case "TURN_DONE":
      return updateStreamingTurn(state, action.id, (t) => ({
        ...t,
        status: "done",
        answer: action.answer,
        citations: action.citations,
        confidence: action.confidence,
        meta: action.meta,
        sourceArticles: action.sourceArticles ?? t.sourceArticles,
        followUpQuestions: action.followUpQuestions,
        stage: undefined,
      }));
    case "TURN_ERROR":
      return updateStreamingTurn(state, action.id, (t) => ({
        ...t,
        status: "error",
        errorKind: action.kind,
        errorMessage: action.message,
        retryAfterSec: action.retryAfterSec,
        stage: undefined,
      }));
    case "TURN_RESTART":
      // Reset the turn in place, keeping its id and createdAt so it holds
      // its position in the transcript and its slot in the archive.
      // Retrying used to append a fresh turn instead, which grew a column
      // of identical error rows down the page. This is also what
      // Regenerate and edit-and-resend are built on.
      return {
        ...updateTurn(state, action.id, (t) =>
          t.status === "streaming" ? t : emptyTurn(t.id, action.question, t.createdAt)
        ),
        expiredBanner: false,
      };
    case "TURN_STOPPED":
      // The reader interrupted, switched thread, or closed the page.
      // Keep every token that did arrive; Regenerate is the way back.
      return updateStreamingTurn(state, action.id, (t) => ({
        ...t,
        status: "stopped",
        stage: undefined,
      }));
    case "TURN_FEEDBACK":
      // Deliberately not gated on "streaming": a vote only ever lands on
      // a turn that has already settled, and it is the reader's input
      // rather than a frame from a stream that may have been abandoned.
      return updateTurn(state, action.id, (t) =>
        t.feedback === action.feedback ? t : { ...t, feedback: action.feedback }
      );
    case "CLEAR_ALL_THREADS":
      // Stay inside the chat chrome; the Transcript renders the
      // "ALL THREADS CLEARED — ASK A NEW QUESTION BELOW." pill.
      // Unlike the old single-thread clear, this drops the whole
      // sidebar archive too — the confirmation dialog is what makes
      // that scope explicit to the user before it happens.
      return {
        ...state,
        turns: [],
        threads: action.threads ?? [],
        activeThreadId: action.activeThreadId ?? null,
        expiredBanner: false,
        sessionGen: state.sessionGen + 1,
        emptyReason: "cleared",
      };
    case "NEW_CONVERSATION":
      // Also stays inside the chat chrome — but the Transcript
      // renders the landing suggestions + lede + stats inline,
      // so "New conversation" feels like a fresh prompt surface
      // without the page flipping back to the full editorial
      // landing hero.
      return {
        ...state,
        turns: [],
        threads: action.threads ?? state.threads,
        activeThreadId:
          action.activeThreadId !== undefined ? action.activeThreadId : state.activeThreadId,
        expiredBanner: false,
        sessionGen: state.sessionGen + 1,
        emptyReason: "new",
      };
    default:
      return state;
  }
}
