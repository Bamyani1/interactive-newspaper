import { describe, it, expect } from "vitest";
import { parseEraLabel, eraOverlapFraction } from "@/src/lib/era-parser";
import type { Era } from "@/src/lib/era-parser";

describe("parseEraLabel", () => {
    // ─── Standard decades ────────────────────────────────────────
    it("parses four-digit decade", () => {
        expect(parseEraLabel("1960s")).toEqual({
            label: "1960s",
            startDate: "1960-01-01",
            endDate: "1969-12-31",
        });
    });

    it("parses decade with apostrophe", () => {
        expect(parseEraLabel("1960's")).toEqual({
            label: "1960's",
            startDate: "1960-01-01",
            endDate: "1969-12-31",
        });
    });

    it("parses two-digit decade", () => {
        const result = parseEraLabel("60s");
        expect(result?.startDate).toBe("1960-01-01");
        expect(result?.endDate).toBe("1969-12-31");
    });

    it("parses two-digit decade with apostrophe prefix", () => {
        const result = parseEraLabel("'60s");
        expect(result?.startDate).toBe("1960-01-01");
        expect(result?.endDate).toBe("1969-12-31");
    });

    it("parses 'the 1960s' with article", () => {
        const result = parseEraLabel("the 1960s");
        expect(result?.startDate).toBe("1960-01-01");
        expect(result?.endDate).toBe("1969-12-31");
    });

    it("parses decade by word name", () => {
        expect(parseEraLabel("sixties")).toEqual({
            label: "sixties",
            startDate: "1960-01-01",
            endDate: "1969-12-31",
        });
    });

    it("parses 'the seventies'", () => {
        const result = parseEraLabel("the seventies");
        expect(result?.startDate).toBe("1970-01-01");
        expect(result?.endDate).toBe("1979-12-31");
    });

    it("parses 2000s decade (clamped to archive end)", () => {
        const result = parseEraLabel("2000s");
        expect(result?.startDate).toBe("2000-01-01");
        expect(result?.endDate).toBe("2006-12-31");
    });

    it("parses 1950s (at archive start)", () => {
        const result = parseEraLabel("1950s");
        expect(result?.startDate).toBe("1950-01-01");
        expect(result?.endDate).toBe("1959-12-31");
    });

    it("parses fifties by name", () => {
        const result = parseEraLabel("fifties");
        expect(result?.startDate).toBe("1950-01-01");
        expect(result?.endDate).toBe("1959-12-31");
    });

    // ─── Qualified decades ───────────────────────────────────────
    it("parses early 1970s", () => {
        expect(parseEraLabel("early 1970s")).toEqual({
            label: "early 1970s",
            startDate: "1970-01-01",
            endDate: "1973-12-31",
        });
    });

    it("parses mid 1970s", () => {
        expect(parseEraLabel("mid 1970s")).toEqual({
            label: "mid 1970s",
            startDate: "1974-01-01",
            endDate: "1976-12-31",
        });
    });

    it("parses late 1980s", () => {
        expect(parseEraLabel("late 1980s")).toEqual({
            label: "late 1980s",
            startDate: "1987-01-01",
            endDate: "1989-12-31",
        });
    });

    it("parses early nineties (word form)", () => {
        const result = parseEraLabel("early nineties");
        expect(result?.startDate).toBe("1990-01-01");
        expect(result?.endDate).toBe("1993-12-31");
    });

    it("parses late 60s (two-digit)", () => {
        const result = parseEraLabel("late 60s");
        expect(result?.startDate).toBe("1967-01-01");
        expect(result?.endDate).toBe("1969-12-31");
    });

    it("parses early 2000s (clamped to archive end)", () => {
        const result = parseEraLabel("early 2000s");
        expect(result?.startDate).toBe("2000-01-01");
        expect(result?.endDate).toBe("2003-12-31");
    });

    it("returns null for late 2000s (entirely outside archive)", () => {
        // late 2000s = 2007-2009, all past the 2006 archive end
        expect(parseEraLabel("late 2000s")).toBeNull();
    });

    // ─── Single years ────────────────────────────────────────────
    it("parses single year 1986", () => {
        expect(parseEraLabel("1986")).toEqual({
            label: "1986",
            startDate: "1986-01-01",
            endDate: "1986-12-31",
        });
    });

    it("parses single year 2000", () => {
        expect(parseEraLabel("2000")).toEqual({
            label: "2000",
            startDate: "2000-01-01",
            endDate: "2000-12-31",
        });
    });

    it("parses 'the 1965'", () => {
        const result = parseEraLabel("the 1965");
        expect(result?.startDate).toBe("1965-01-01");
        expect(result?.endDate).toBe("1965-12-31");
    });

    it("parses 2006 (archive end)", () => {
        const result = parseEraLabel("2006");
        expect(result?.startDate).toBe("2006-01-01");
        expect(result?.endDate).toBe("2006-12-31");
    });

    // ─── Named periods ───────────────────────────────────────────
    it("parses mid-century (with hyphen, clamped)", () => {
        const result = parseEraLabel("mid-century");
        expect(result?.startDate).toBe("1950-01-01"); // clamped from 1945
        expect(result?.endDate).toBe("1965-12-31");
    });

    it("parses mid century (no hyphen)", () => {
        const result = parseEraLabel("mid century");
        expect(result?.startDate).toBe("1950-01-01");
        expect(result?.endDate).toBe("1965-12-31");
    });

    it("parses turn of the millennium", () => {
        expect(parseEraLabel("turn of the millennium")).toEqual({
            label: "turn of the millennium",
            startDate: "1998-01-01",
            endDate: "2002-12-31",
        });
    });

    it("parses mid-century case-insensitively", () => {
        const result = parseEraLabel("Mid-Century");
        expect(result?.startDate).toBe("1950-01-01");
    });

    // ─── Outside archive → null ──────────────────────────────────
    it("returns null for decade before archive", () => {
        expect(parseEraLabel("1850s")).toBeNull();
    });

    it("returns null for decade after archive", () => {
        expect(parseEraLabel("2020s")).toBeNull();
    });

    it("returns null for year after archive", () => {
        expect(parseEraLabel("2050")).toBeNull();
    });

    it("returns null for year before archive", () => {
        expect(parseEraLabel("1920")).toBeNull();
    });

    it("returns null for 1940s (fully before archive)", () => {
        expect(parseEraLabel("1940s")).toBeNull();
    });

    it("returns null for 2007 (just past archive)", () => {
        expect(parseEraLabel("2007")).toBeNull();
    });

    // ─── Bad inputs → null ───────────────────────────────────────
    it("returns null for empty string", () => {
        expect(parseEraLabel("")).toBeNull();
    });

    it("returns null for whitespace", () => {
        expect(parseEraLabel("   ")).toBeNull();
    });

    it("returns null for random text", () => {
        expect(parseEraLabel("hello world")).toBeNull();
    });

    it("returns null for partial number", () => {
        expect(parseEraLabel("196")).toBeNull();
    });

    // ─── Whitespace tolerance ────────────────────────────────────
    it("trims leading/trailing whitespace", () => {
        const result = parseEraLabel("  1960s  ");
        expect(result?.startDate).toBe("1960-01-01");
    });
});

describe("eraOverlapFraction", () => {
    function era(start: string, end: string): Era {
        return { label: "test", startDate: start, endDate: end };
    }

    it("returns 0 for non-overlapping eras", () => {
        const a = era("1960-01-01", "1969-12-31");
        const b = era("1980-01-01", "1989-12-31");
        expect(eraOverlapFraction(a, b)).toBe(0);
    });

    it("returns 1 for identical eras", () => {
        const a = era("1960-01-01", "1969-12-31");
        const b = era("1960-01-01", "1969-12-31");
        expect(eraOverlapFraction(a, b)).toBe(1);
    });

    it("returns > 0.5 for heavily overlapping eras", () => {
        const a = era("1960-01-01", "1969-12-31"); // 10 years
        const b = era("1962-01-01", "1969-12-31"); // 8 years, fully inside A
        expect(eraOverlapFraction(a, b)).toBeGreaterThan(0.5);
    });

    it("returns < 0.5 for slightly overlapping eras", () => {
        const a = era("1960-01-01", "1969-12-31"); // 10 years
        const b = era("1968-01-01", "1979-12-31"); // 12 years, 2 years overlap
        expect(eraOverlapFraction(a, b)).toBeLessThan(0.5);
    });

    it("handles adjacent non-overlapping eras (boundary)", () => {
        const a = era("1960-01-01", "1969-12-31");
        const b = era("1970-01-01", "1979-12-31");
        expect(eraOverlapFraction(a, b)).toBe(0);
    });

    it("returns > 0.5 for 1970 vs early 1970s", () => {
        const a = era("1970-01-01", "1970-12-31"); // single year
        const b = era("1970-01-01", "1973-12-31"); // early 1970s, 4 years
        expect(eraOverlapFraction(a, b)).toBeGreaterThan(0.5);
    });
});
