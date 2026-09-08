import { readdirSync, readFileSync, existsSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const EDITIONS_DIR = path.resolve(__dirname, "../../public/editions");

// Discover all edition directories.
const dateNamedDirs = existsSync(EDITIONS_DIR)
  ? readdirSync(EDITIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
      .map((d) => d.name)
      .sort()
  : [];

// A date-named directory is only an *ingested* edition once it has an
// edition.json; the OCR pipeline creates the directory and writes images
// before that file exists. These invariants describe ingested editions, so
// a partially-ingested directory is out of scope rather than a failure.
//
// Filtering matters beyond tidiness: this module reads each edition.json at
// collection time, so a single partial directory used to throw here and
// prevent *every* edition from being validated.
const hasEdition = (date: string) =>
  existsSync(path.join(EDITIONS_DIR, date, "edition.json"));
const editionDirs = dateNamedDirs.filter(hasEdition);
const partiallyIngested = dateNamedDirs.filter((date) => !hasEdition(date));

// Pre-existing data issues in legacy editions — tracked here so tests pass
// while still catching regressions in newly processed editions.
// Remove entries as editions are re-processed through the improved pipeline.
const KNOWN_EMPTY_ARTICLES: Record<string, number[]> = {
  "1980-02-28": [7],
};

// Legacy editions whose source_pages carry bare section letters instead of
// page numbers. 1980-10-30 is an election issue with lettered supplement
// sections, and OCR captured the section marker ("B", "D") with no page
// digit. Scoped per edition so the numeric invariant still guards the rest
// of the corpus; drop the entry once the edition is re-ingested.
const KNOWN_NON_NUMERIC_PAGES: Record<string, string[]> = {
  "1980-10-30": ["B", "D"],
};

const KNOWN_DUPLICATE_EDITIONS = new Set<string>([
  "1960-02-24",
  "1968-01-10",
  "1972-10-05",
  "1977-03-03",
  "1986-01-31",
  "1986-02-21",
  "1990-04-04",
]);

if (editionDirs.length === 0) {
  it("no editions to validate", () => {
    expect(editionDirs).toHaveLength(0);
  });
}

describe("edition corpus", () => {
  it("validates every directory that carries an edition.json", () => {
    // Guards the filter above: if a partial directory ever slipped into the
    // validated set, the sweep would throw instead of reporting.
    editionDirs.forEach((date) => expect(hasEdition(date)).toBe(true));
  });

  it("does not let promoted-article page provenance debt grow", () => {
    // Every article missing source_pages today is a content_rescue.py
    // promotion in a legacy edition. Freezing the count means re-ingesting
    // editions can only shrink it, while a new pipeline bug that drops page
    // provenance still fails here. Lower this number as editions are
    // re-processed; never raise it.
    const PROMOTED_WITHOUT_PAGES_BASELINE = 676;

    let promotedWithoutPages = 0;
    let otherWithoutPages = 0;
    for (const date of editionDirs) {
      const edition = JSON.parse(
        readFileSync(path.join(EDITIONS_DIR, date, "edition.json"), "utf-8"),
      );
      for (const article of edition.articles ?? []) {
        if ((article.source_pages || []).length > 0) continue;
        if (article.triage_promoted === true) promotedWithoutPages += 1;
        else otherWithoutPages += 1;
      }
    }

    // Anything missing page provenance that is NOT a rescued promotion is a
    // genuine pipeline failure, not legacy debt.
    expect(otherWithoutPages).toBe(0);
    expect(promotedWithoutPages).toBeLessThanOrEqual(
      PROMOTED_WITHOUT_PAGES_BASELINE,
    );
  });

  it("reports directories still awaiting ingestion", () => {
    // Informational, not a failure: these are mid-pipeline artifacts on a
    // local checkout (public/editions is gitignored, so CI sees none).
    if (partiallyIngested.length > 0) {
      console.warn(
        `[pipeline-invariants] ${partiallyIngested.length} directory(ies) have no edition.json and were skipped: ${partiallyIngested.join(", ")}`,
      );
    }
    expect(partiallyIngested.every((d) => !editionDirs.includes(d))).toBe(true);
  });
});

for (const date of editionDirs) {
  describe(`Edition ${date}`, () => {
    const editionPath = path.join(EDITIONS_DIR, date, "edition.json");
    const edition = JSON.parse(readFileSync(editionPath, "utf-8"));

    it("has valid edition_date", () => {
      expect(edition.edition_date).toBe(date);
    });

    it("has articles array", () => {
      expect(Array.isArray(edition.articles)).toBe(true);
    });

    it("all articles have headline, body, or images", () => {
      const knownEmpty = new Set(KNOWN_EMPTY_ARTICLES[date] ?? []);
      for (const [i, article] of edition.articles.entries()) {
        if (knownEmpty.has(i)) continue; // skip known legacy issues
        const hasHeadline = (article.headline || "").trim().length > 0;
        const hasBody = (article.body || "").trim().length > 0;
        const hasImages = (article.image_files || []).some(
          (f: string) => f.length > 0,
        );
        expect(
          hasHeadline || hasBody || hasImages,
          `Article ${i} has no headline, body, or images`,
        ).toBe(true);
      }
    });

    it("all image_files reference existing files", () => {
      for (const [i, article] of edition.articles.entries()) {
        for (const imgFile of article.image_files || []) {
          if (!imgFile) continue;
          const fullPath = path.join(EDITIONS_DIR, date, imgFile);
          expect(
            existsSync(fullPath),
            `Article ${i}: image file "${imgFile}" does not exist`,
          ).toBe(true);
        }
      }
      for (const [i, ad] of (edition.ads || []).entries()) {
        for (const imgFile of ad.image_files || []) {
          if (!imgFile) continue;
          const fullPath = path.join(EDITIONS_DIR, date, imgFile);
          expect(
            existsSync(fullPath),
            `Ad ${i}: image file "${imgFile}" does not exist`,
          ).toBe(true);
        }
      }
    });

    it("source_pages is non-empty for every article", () => {
      const knownEmpty = new Set(KNOWN_EMPTY_ARTICLES[date] ?? []);
      for (const [i, article] of edition.articles.entries()) {
        if (knownEmpty.has(i)) continue; // legacy
        // Articles rescued by content_rescue.py carry no page provenance in
        // editions ingested before the ADC pipeline landed. They are exempted
        // per-article here and ratcheted corpus-wide below, so the existing
        // debt cannot grow even though it is too large to enumerate.
        if (article.triage_promoted === true) continue;
        expect(
          (article.source_pages || []).length,
          `Article ${i} "${(article.headline || "").slice(0, 50)}" has no source_pages`,
        ).toBeGreaterThan(0);
      }
    });

    it("page numbers are valid integers", () => {
      const knownNonNumeric = new Set(KNOWN_NON_NUMERIC_PAGES[date] ?? []);
      for (const article of edition.articles) {
        for (const p of article.source_pages || []) {
          if (knownNonNumeric.has(p)) continue; // legacy section marker
          const n = parseInt(p, 10);
          expect(isNaN(n), `Edition ${date}: page "${p}" is not numeric`).toBe(
            false,
          );
          expect(n).toBeGreaterThan(0);
        }
      }
    });

    it("no exact duplicate article bodies", () => {
      if (KNOWN_DUPLICATE_EDITIONS.has(date)) return; // skip known legacy dupes
      const bodies = edition.articles
        .map((a: { body?: string }) => (a.body || "").trim())
        .filter((b: string) => b.length > 200);

      const seen = new Set<string>();
      for (const [i, body] of bodies.entries()) {
        expect(
          seen.has(body),
          `Article ${i} has an exact duplicate body (${body.slice(0, 60)}...)`,
        ).toBe(false);
        seen.add(body);
      }
    });
  });
}
