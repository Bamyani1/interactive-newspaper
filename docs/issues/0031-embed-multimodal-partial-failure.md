---
id: 0031
title: embedDocuments multimodal branch could silently leave reassembly holes
status: fixed
severity: medium
area: rag
opened: 2026-04-14
closed: 2026-04-14
---

## Symptom

The image branch in `embedDocuments` processes inputs sequentially and
reassembles into a result array by index. If a future refactor were to
swallow per-image failures (or use `Promise.allSettled`), the reassembly
could produce an array with `undefined` holes — silently writing garbage
embeddings into the database for some articles. The current code is
already atomic (a throw bubbles up before reassembly), but there were
no test guards or invariant checks to keep it that way.

## Fix

`src/lib/embeddings.ts`:

1. Added per-image `try/catch` wrapping the `embedWithTimeout` call to
   re-throw with index context: `"Multimodal embedding failed on image
   N of M: <msg>"`.
2. Added explicit length-invariant checks before reassembly:
   ```ts
   if (textEmbeddings.length !== textIndices.length) throw ...;
   if (imageEmbeddings.length !== imageIndices.length) throw ...;
   ```
3. Documented the atomic-on-failure contract in a comment.

## Verification

New unit tests in `tests/lib/embeddings.test.ts`:

- `throws atomically when image #3 of 5 fails partway through` — asserts
  no further image calls occur after the throw.
- `throws when image branch returns malformed embedding`
- `succeeds when text and image branches both complete (mixed batch)` —
  asserts no `undefined` holes in the reassembled result.
