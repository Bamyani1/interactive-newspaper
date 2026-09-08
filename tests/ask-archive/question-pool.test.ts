import { describe, it, expect } from "vitest";
import {
    QUESTION_POOL,
    QUESTION_LENSES,
    QUESTION_PROMPTS,
    getQuestionPrompt,
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

    it("draws the three suggestions from distinct research lenses", () => {
        const suggestions = pickSuggestions(new Date("2026-04-18T12:00:00Z"));
        const lenses = suggestions.map(
            (question) => getQuestionPrompt(question)?.lens,
        );

        expect(new Set(lenses).size).toBe(3);
        lenses.forEach((lens) => expect(QUESTION_LENSES).toContain(lens));
    });

    it("never repeats a suggestion, on any day of a full rotation", () => {
        // The lens-per-slot draw is what guarantees distinctness; walk a
        // full year so an off-by-one in the rotation cannot hide.
        for (let day = 0; day < 366; day += 1) {
            const date = new Date(Date.UTC(2026, 0, 1 + day, 12));
            const suggestions = pickSuggestions(date, pickDailyQuestion(date));
            expect(new Set(suggestions).size, date.toISOString()).toBe(3);
            expect(suggestions).not.toContain(pickDailyQuestion(date));
        }
    });

    it("every lens is represented by enough prompts to survive an exclusion", () => {
        for (const lens of QUESTION_LENSES) {
            const count = QUESTION_PROMPTS.filter(
                (prompt) => prompt.lens === lens,
            ).length;
            expect(count, lens).toBeGreaterThan(1);
        }
    });
});
