import { describe, it, expect } from "vitest";
import {
    QUESTION_POOL,
    pickDailyQuestion,
    pickSuggestions,
} from "@/features/ask-archive/data/question-pool";

describe("pickDailyQuestion", () => {
    it("returns a question that exists in the pool", () => {
        const q = pickDailyQuestion(new Date("2026-04-18T12:00:00Z"));
        expect(QUESTION_POOL).toContain(q);
    });

    it("returns the same question for the same day, regardless of hour", () => {
        const morning = pickDailyQuestion(new Date("2026-04-18T01:00:00Z"));
        const evening = pickDailyQuestion(new Date("2026-04-18T23:30:00Z"));
        expect(morning).toBe(evening);
    });

    it("advances to a different question on consecutive days", () => {
        // Consecutive day-indices differ by 1, so they map to adjacent
        // pool slots — guaranteed different since the pool has > 1 entry.
        const today = pickDailyQuestion(new Date("2026-04-18T12:00:00Z"));
        const tomorrow = pickDailyQuestion(new Date("2026-04-19T12:00:00Z"));
        expect(tomorrow).not.toBe(today);
    });
});

describe("pickSuggestions", () => {
    it("returns exactly three questions", () => {
        const s = pickSuggestions(new Date("2026-04-18T12:00:00Z"));
        expect(s).toHaveLength(3);
    });

    it("all returned questions are drawn from the pool", () => {
        const s = pickSuggestions(new Date("2026-04-18T12:00:00Z"));
        for (const q of s) {
            expect(QUESTION_POOL).toContain(q);
        }
    });

    it("excludes the specified question from the result", () => {
        const exclude = QUESTION_POOL[0];
        const s = pickSuggestions(new Date("2026-04-18T12:00:00Z"), exclude);
        expect(s).not.toContain(exclude);
    });

    it("is deterministic across calls for the same day", () => {
        const a = pickSuggestions(new Date("2026-04-18T12:00:00Z"));
        const b = pickSuggestions(new Date("2026-04-18T12:00:00Z"));
        expect(b).toEqual(a);
    });
});
