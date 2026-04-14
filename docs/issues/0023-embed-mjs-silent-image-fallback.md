---
id: 0023
title: embed.mjs silently degrades to text-only when local images missing
status: fixed
severity: medium
area: scripts
opened: 2026-04-13
closed: 2026-04-14
---

> **Fix:** `scripts/db/embed.mjs` tracks `imagesExpected` and
> `imagesMissing` counters inside `loadFirstImage` and emits a WARNING at
> end-of-run if any articles had `image_urls` but no local mirror. The
> embedding still runs text-only for those articles (preserving current
> behavior), but operators now see the degradation instead of silently
> shipping a partially-multimodal index. Did NOT add a `--require-images`
> flag — that's a new feature, not a bug fix.


## Symptom

`scripts/db/embed.mjs:146` calls `loadFirstImage(article)`, which reads
from `public/editions/<date>/images/`. In a production-mirror dev
environment where images live only on Cloudflare R2 (not mirrored
locally), every article becomes text-only with no warning. The
multimodal embedding work from commit `9ef252b` is effectively a no-op
in that environment — embeddings are generated, RAG still works, but
the visual signal is gone and nobody notices.

## Root cause

`scripts/db/embed.mjs:59-87` (`loadFirstImage`):

```js
function loadFirstImage(article) {
    const imageUrls = article.image_urls;
    if (!imageUrls || imageUrls.length === 0) return null;
    ...
    for (const ext of [".jpg", ".jpeg", ".png", ""]) {
        const filePath = path.join(EDITIONS_DIR, date, "images", baseName + ext);
        if (existsSync(filePath)) { ... }
    }
    return null;
}
```

Returns `null` on any failure path — missing file, wrong extension,
unreadable file. The caller at line 146 silently treats that as "no
image" without distinguishing:

- "Article has no image URLs" (legitimate text-only) vs.
- "Article has image URLs but local mirror is missing" (degradation).

## Reproduction

1. Seed a database from edition JSONs that reference R2-hosted images.
2. Delete or rename `public/editions/<date>/images/` locally.
3. Run `npm run db:embed`. Observe `[0 with images]` for every batch and
   no warning.

## Proposed fix

Track a degradation counter:

```js
let imagesExpected = 0;
let imagesMissing = 0;

function loadFirstImage(article) {
    const imageUrls = article.image_urls;
    if (!imageUrls || imageUrls.length === 0) return null;
    imagesExpected++;
    ...
    imagesMissing++;
    console.warn(`  Image expected but not found locally: ${baseName} (${firstUrl})`);
    return null;
}
```

At the end of `main()`:

```js
if (imagesMissing > 0) {
  console.warn(
    `WARNING: ${imagesMissing}/${imagesExpected} articles had image_urls ` +
    `but no local mirror — multimodal embedding skipped for those.`
  );
}
```

Operators can then decide whether to mirror images locally before
embedding, or accept the degradation consciously.

## Notes

- Related to 0001 (embed type mismatch) only in that both involve the
  post-`9ef252b` embed pipeline. Independent problems.
- Consider adding a `--require-images` flag that fails the script if any
  expected image is missing.
