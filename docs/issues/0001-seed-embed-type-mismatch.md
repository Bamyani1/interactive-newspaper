---
id: 0001
title: seed.mjs embed loop passes strings to embedDocuments (expects EmbedInput)
status: fixed
severity: critical
area: scripts
opened: 2026-04-13
closed: 2026-04-14
---

## Symptom

`npm run db:seed` reports `Embedding complete: 0 articles.` and exits 0. Every
batch fails with the Gemini API error:

```
BatchEmbedContentsRequest.requests[N].content.parts[0].data:
required oneof field 'data' must have one initialized field
```

Articles table stays un-embedded and RAG retrieval silently degrades to FTS-only.

## Root cause

Commit `9ef252b` refactored `embedDocuments()` in `src/lib/embeddings.ts:62`
from accepting `string[]` to accepting `EmbedInput[]` (objects with a `.text`
property, optionally with `imageBase64` / `imageMimeType`). The standalone
`scripts/db/embed.mjs` was updated in the same commit and now correctly uses
`buildEmbeddingInput()` at line 148.

The **inline** embed loop in `scripts/db/seed.mjs:524` was not updated. It
still calls `buildEmbeddingText()` (which returns a string) and passes the
resulting `string[]` to `embedDocuments()`. At `src/lib/embeddings.ts:88`:

```js
contents: batch.map((inp) => ({ parts: [{ text: inp.text }] }))
```

reads `.text` off a string, which is `undefined`, producing a part with no
initialized `data` oneof field. The API rejects every batch.

Because `seed.mjs` is a `.mjs` file, the TypeScript type checker never catches
the contract break.

## Reproduction

```bash
npm run db:seed
```

Observe "Embedding batch error: …" logs for every batch and
`Embedding complete: 0 articles.` at the end. Exit code 0.

## Proposed fix

Two options:

1. **Preferred — delete the duplicate.** Remove the inline `embedArticles()`
   at `scripts/db/seed.mjs:490-541` and have seed.mjs shell out to
   `scripts/db/embed.mjs` or import and call its main function. Kills the
   code duplication.

2. **Minimal patch.** Update `scripts/db/seed.mjs:524` to call
   `buildEmbeddingInput(...)` instead of `buildEmbeddingText(...)`, and add
   `buildEmbeddingInput` to the dynamic import at the top of the script.
   Also include `summary` and `image_caption` in the SELECT at line 510-511
   so the new input function gets all of the fields it supports.

Either fix should be paired with issue 0002 (which addresses the silent
error swallowing that kept this bug invisible for a full seed run).

## Notes

- Discovered via a `npm run db:seed` run during unrelated music-work debugging.
- Related: issue 0002 (seed.mjs swallows embed errors) and issue 0003 (embed.mjs
  also exits 0 on errors).
- Commit that introduced the regression: `9ef252b`.
