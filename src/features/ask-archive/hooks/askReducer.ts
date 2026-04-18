/**
 * askReducer — pure state machine for the transcript UI.
 *
 * Each Turn is a Q/A pair with its own `status` ("streaming" | "done" |
 * "error"). Submitting a question appends an optimistic user turn; SSE
 * events fill in the assistant fields; a `done` event freezes the turn;
 * a `TURN_ERROR` replaces the assistant region with a typed error row.
 *
 * The reducer has no I/O — the hook that owns it handles fetch, SSE
 * parsing, session-id mint, and localStorage. Keeping this file pure
 * means the interesting state transitions are unit-testable without
 * mocking streams or storage.
 */

import type { AskResponse, AskErrorKind } from "@/src/types";

export type TurnStatus = "streaming" | "done" | "error";

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
}

export interface AskState {
    turns: Turn[];
    isHydrating: boolean;
    /** True iff the last /api/ask/session response reported `expired:true`. */
    expiredBanner: boolean;
    sessionGen: number;
}

export type AskAction =
    | { type: "HYDRATING" }
    | { type: "HYDRATE"; turns: Turn[]; expired: boolean }
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
    | { type: "CLEAR_CONVERSATION" };

export const INITIAL_STATE: AskState = {
    turns: [],
    isHydrating: false,
    expiredBanner: false,
    sessionGen: 0,
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

function updateTurn(
    state: AskState,
    id: string,
    updater: (t: Turn) => Turn,
): AskState {
    let changed = false;
    const turns = state.turns.map((t) => {
        if (t.id !== id) return t;
        changed = true;
        return updater(t);
    });
    return changed ? { ...state, turns } : state;
}

export function askReducer(state: AskState, action: AskAction): AskState {
    switch (action.type) {
        case "HYDRATING":
            return { ...state, isHydrating: true };
        case "HYDRATE":
            return {
                ...state,
                turns: action.turns,
                isHydrating: false,
                expiredBanner: action.expired,
            };
        case "APPEND_USER": {
            // If the most recent turn is still "streaming" when a new
            // question arrives, freeze it with whatever partial answer
            // it has — avoids a zombie spinner in the transcript.
            const frozen = state.turns.map((t, i) =>
                i === state.turns.length - 1 && t.status === "streaming"
                    ? { ...t, status: "done" as const }
                    : t,
            );
            return {
                ...state,
                // Any new question clears an expired banner — the user
                // has started a fresh conversation in intent.
                expiredBanner: false,
                turns: [
                    ...frozen,
                    emptyTurn(
                        action.id,
                        action.question,
                        action.createdAt ?? Date.now(),
                    ),
                ],
            };
        }
        case "TURN_META":
            return updateTurn(state, action.id, (t) => ({
                ...t,
                mode: action.mode,
                requestId: action.requestId,
                sourceArticles: action.sourceArticles,
                meta: { ...(t.meta ?? ({} as AskResponse["meta"])), ...action.meta } as AskResponse["meta"],
            }));
        case "TURN_STAGE":
            return updateTurn(state, action.id, (t) => ({
                ...t,
                stage: action.stage,
            }));
        case "TURN_DELTA":
            return updateTurn(state, action.id, (t) => ({
                ...t,
                answer: t.answer + action.text,
                // First delta removes the stage pill — streaming text now
                // replaces it as the visual progress indicator.
                stage: undefined,
            }));
        case "TURN_DONE":
            return updateTurn(state, action.id, (t) => ({
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
            return updateTurn(state, action.id, (t) => ({
                ...t,
                status: "error",
                errorKind: action.kind,
                errorMessage: action.message,
                retryAfterSec: action.retryAfterSec,
                stage: undefined,
            }));
        case "CLEAR_CONVERSATION":
            return {
                ...state,
                turns: [],
                expiredBanner: false,
                sessionGen: state.sessionGen + 1,
            };
        default:
            return state;
    }
}
