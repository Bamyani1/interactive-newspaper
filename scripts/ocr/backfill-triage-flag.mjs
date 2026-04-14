#!/usr/bin/env node
// One-shot backfill: stamps `triage_promoted: true` on existing articles in
// public/editions/*/edition.json that have empty source_pages, so the
// pipeline-invariants test can grandfather them. Idempotent — safe to re-run.
//
// Skips the one true legacy article (1980-02-28 index 7) so it keeps its
// semantic distinction in tests/ocr/pipeline-invariants.test.ts KNOWN_EMPTY_ARTICLES.

import { readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

const EDITIONS_DIR = path.resolve("public/editions");
const KNOWN_LEGACY = { "1980-02-28": new Set([7]) };

let totalFlagged = 0;
let editionsTouched = 0;

for (const entry of readdirSync(EDITIONS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
  const editionPath = path.join(EDITIONS_DIR, entry.name, "edition.json");
  const edition = JSON.parse(readFileSync(editionPath, "utf-8"));
  const legacy = KNOWN_LEGACY[entry.name] ?? new Set();
  let changed = false;
  edition.articles.forEach((art, i) => {
    if (legacy.has(i)) return;
    if ((art.source_pages || []).length === 0 && art.triage_promoted !== true) {
      art.triage_promoted = true;
      totalFlagged++;
      changed = true;
    }
  });
  if (changed) {
    writeFileSync(editionPath, JSON.stringify(edition, null, 2));
    editionsTouched++;
  }
}

console.log(`Flagged ${totalFlagged} articles across ${editionsTouched} editions.`);
