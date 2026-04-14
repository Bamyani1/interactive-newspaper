---
id: 0007
title: Image proxy silent catch at route.ts:66 opaques all FS errors as 404
status: open
severity: high
area: api
opened: 2026-04-13
---

## Symptom

`GET /api/editions/<date>/images/<path>` returns `404 Image not found` for
*every* file-system error, not just "file missing". Permissions errors,
disk-full errors, corrupt file reads, unmounted volumes, and stale NFS
handles all look identical to a genuine 404. Debugging missing assets in
production is a blind flail.

## Root cause

`src/app/api/editions/[date]/images/[...path]/route.ts:57-68`:

```ts
try {
  return respond(await readFile(filePath));
} catch {
  // Fallback: check gold/ directory
  try {
    const goldPath = path.join(GOLD_DIR, date, 'images', filename);
    if (goldPath.startsWith(path.join(GOLD_DIR, date, 'images'))) {
      return respond(await readFile(goldPath));
    }
  } catch { /* fall through */ }
  return new NextResponse('Image not found', { status: 404 });
}
```

Both catches discard the error object entirely. Neither logs the reason.

## Reproduction

`chmod 000 public/editions/<date>/images/<file>` and request the proxied URL.
Observe 404 instead of 500; no log entry identifies the permission issue.

## Proposed fix

Log non-ENOENT errors and return 500 for them:

```ts
} catch (err) {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code !== 'ENOENT') {
    console.error('[image-proxy] primary read failed', { filePath, code, err });
  }
  // Fallback: check gold/ directory
  try {
    const goldPath = path.join(GOLD_DIR, date, 'images', filename);
    if (goldPath.startsWith(path.join(GOLD_DIR, date, 'images'))) {
      return respond(await readFile(goldPath));
    }
  } catch (goldErr) {
    const goldCode = (goldErr as NodeJS.ErrnoException)?.code;
    if (goldCode !== 'ENOENT') {
      console.error('[image-proxy] gold fallback failed', { goldCode, goldErr });
    }
  }
  return new NextResponse('Image not found', { status: 404 });
}
```

Optionally escalate non-ENOENT to a 500 response so clients don't silently
cache "not found" for a permissions bug.

## Notes

- `console.error` and `console.warn` are both allowed by the project ESLint
  config (see CLAUDE.md → Code Style).
- Local-dev impact only; in production, images are served from R2 via
  `IMAGE_BASE_URL`, so this proxy is the dev/local path.
