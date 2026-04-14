---
id: 0029
title: seedEditions wipes all embeddings on every seed run
status: fixed
severity: critical
area: scripts
opened: 2026-04-14
closed: 2026-04-14
---

## Symptom

Every `npm run db:seed` run re-embeds ~9,582 articles from scratch, even when
no edition content has changed. This burns the Gemini daily quota on the
free tier within minutes. The user's working theory ("the rate limit is the
problem") was wrong — the rate limit is a downstream *symptom* of re-embedding
the same content over and over. Issue 0028 (quota backoff) was filed earlier
as a mitigation but doesn't address the root cause.

**Observed 2026-04-14.** Back-to-back `npm run db:seed` runs each started
from `Embedded 50/9582` and hit 429 `RESOURCE_EXHAUSTED` around batch 184,
after embedding 9,200 articles — the exact same 9,582-article work every
time. The embeddings from the previous run had been silently wiped.

## Root cause

`scripts/db/seed.mjs:seedEditions` does two things for every edition:

1. **Line 300 (pre-fix):** blanket DELETE
   ```js
   await sql`DELETE FROM articles WHERE edition_date = ${date}`;
   ```
2. **Lines 303–321 (pre-fix):** re-INSERT with a column list that does
   **not** include `embedding` or `embedding_model`:
   ```js
   sql`INSERT INTO articles (id, edition_date, position, category, headline,
       summary, full_text, body_plain, byline, writer_position, page, is_hero,
       is_featured, image_urls, image_caption, image_captions)
       VALUES (...)
       ON CONFLICT (id) DO UPDATE SET
         category = EXCLUDED.category, ... image_captions = EXCLUDED.image_captions`
   ```

The `ON CONFLICT DO UPDATE` clause is **dead code** in this path — the rows
were just deleted, so there's nothing to conflict on. Even if it did fire,
its UPDATE SET list also omits `embedding` / `embedding_model`. Result:
every non-gold article loses its embedding on every seed.

Gold edition `1960-01-13` survives because `restoreLockedEditions` at
`scripts/db/seed.mjs:~226` uses a separate code path that explicitly
preserves `embedding, embedding_model` during the re-insert, via
`ON CONFLICT (id) DO NOTHING`.

## Why matching only by ID is unsafe

Article IDs are `{date}-{index}` (schema comment at
`scripts/db/schema.sql:21`). If the OCR pipeline re-runs and the adapter
filters out the article at index 5, everything after it shifts: old index 6
becomes new index 5 with the same ID but different content. Restoring the
old embedding onto the new content would silently poison RAG retrieval with
a vector for content that no longer lives at that ID. **Preservation must
match by content fingerprint, not by ID.**

## Fix

Snapshot embeddings by content fingerprint **before** the DELETE and
restore them **after** the INSERT, keyed on a stable hash of
`(headline, byline, body_plain, category)`:

1. New helper `articleContentFingerprint` at module level.
2. New SELECT before the existing DELETE, building a
   `preservedByFingerprint` Map.
3. New restore transaction after the existing INSERT transaction that
   UPDATEs embeddings back for articles whose fingerprint is still in the
   Map.

Articles whose content has changed (or that are new) are left with NULL
embeddings, which `embedArticles` picks up via its existing
`WHERE embedding IS NULL` filter.

The fingerprint excludes `edition_date` because it's constant within the
loop iteration; the four included fields cover everything that materially
affects the embedding vector produced by `buildEmbeddingInput` at
`src/lib/embeddings.ts:265-285`.

## Reproduction

1. `npm run db:seed` — embeds ~9,582 articles.
2. Immediately re-run `npm run db:seed`.
3. **Before fix:** all ~9,582 articles are re-embedded from scratch.
4. **After fix:** 0 articles are re-embedded, because their content
   fingerprints still match.

## Notes

- **Related 0001 / 0002:** The type-mismatch fix in `embedArticles` made
  this issue *visible* — before 0001 was fixed, zero articles ever got
  embedded, so there was nothing to wipe.
- **Related 0028:** Quota detection / early-abort is still a valid
  follow-up. This fix mitigates it in practice (seeds no longer burn
  quota for no reason), but 0028 remains useful for catching genuine
  overrun cases (e.g., someone wipes embeddings manually and re-seeds).
- **Gold edition unaffected.** `restoreLockedEditions` uses a separate
  path that has always preserved embeddings correctly; no regression
  risk there.
- **Self-healing on formula change.** If `buildEmbeddingInput`'s
  text-building formula changes in the future, stored embeddings no
  longer match what a fresh embed would produce, but the fingerprint
  still matches (same field values). To force a rebuild, operators
  should run `npm run db:embed:force`.
