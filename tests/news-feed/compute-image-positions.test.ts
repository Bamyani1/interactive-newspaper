import { describe, it, expect } from "vitest";
import { computeImagePositions } from "../../src/features/news-feed/components/variants/print-edition-primitives";

describe("computeImagePositions", () => {
  it("returns [] for a single image (no interleaving needed)", () => {
    expect(computeImagePositions(1, 5)).toEqual([]);
  });

  it("returns [] when there are no paragraphs", () => {
    expect(computeImagePositions(2, 0)).toEqual([]);
  });

  it("returns [] for zero images", () => {
    expect(computeImagePositions(0, 5)).toEqual([]);
  });

  it("wraps a single paragraph with 2 images: [0, 1]", () => {
    expect(computeImagePositions(2, 1)).toEqual([0, 1]);
  });

  it("anchors first image at top and second after the only paragraph", () => {
    const result = computeImagePositions(2, 1);
    expect(result[0]).toBe(0);
    expect(result[1]).toBeGreaterThan(0);
  });

  it("distributes 2 images across 2 paragraphs: [0, 1]", () => {
    expect(computeImagePositions(2, 2)).toEqual([0, 1]);
  });

  it("distributes 2 images across 6 paragraphs: [0, 3]", () => {
    expect(computeImagePositions(2, 6)).toEqual([0, 3]);
  });

  it("distributes 2 images across 11 paragraphs (OWU women's basketball): [0, 6]", () => {
    expect(computeImagePositions(2, 11)).toEqual([0, 6]);
  });

  it("distributes 3 images across 6 paragraphs: [0, 2, 4]", () => {
    expect(computeImagePositions(3, 6)).toEqual([0, 2, 4]);
  });

  it("shifts forward on collision when paragraphs are tight (3 images, 2 paragraphs)", () => {
    const positions = computeImagePositions(3, 2);
    expect(positions[0]).toBe(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    }
  });

  it("always anchors the first image at position 0 across many shapes", () => {
    for (const N of [2, 3, 4]) {
      for (const P of [1, 2, 5, 10]) {
        const r = computeImagePositions(N, P);
        if (r.length > 0) expect(r[0]).toBe(0);
      }
    }
  });

  it("returns monotonic non-decreasing positions clamped to [0, P]", () => {
    for (const N of [2, 3, 4, 5]) {
      for (const P of [1, 2, 5, 10, 20]) {
        const r = computeImagePositions(N, P);
        for (let i = 0; i < r.length; i++) {
          expect(r[i]).toBeGreaterThanOrEqual(0);
          expect(r[i]).toBeLessThanOrEqual(P);
          if (i > 0) expect(r[i]).toBeGreaterThanOrEqual(r[i - 1]);
        }
      }
    }
  });

  it("returns exactly N positions when interleaving applies", () => {
    expect(computeImagePositions(2, 5)).toHaveLength(2);
    expect(computeImagePositions(3, 10)).toHaveLength(3);
    expect(computeImagePositions(4, 12)).toHaveLength(4);
  });
});
