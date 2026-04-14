---
id: 0016
title: /api/admin/revalidate uses string-equality token check, no rate limit
status: open
severity: medium
area: api
opened: 2026-04-13
---

## Symptom

The token-gated cache invalidation endpoint is vulnerable to:

1. **Timing-leak attacks** (theoretical) — string equality is not
   constant-time; a determined attacker could learn token prefixes over
   enough samples.
2. **Online brute force** (practical) — the endpoint has no rate limiter,
   unlike `/api/ask` which uses `src/lib/rate-limit.ts`. A bot can probe
   the token freely.

## Root cause

`src/app/api/admin/revalidate/route.ts:19`:

```ts
if (!provided || provided !== expected) { ... }
```

Plus no import or use of the rate limiter. The endpoint is fail-closed on
a missing `ADMIN_REVALIDATE_TOKEN`, which is correct, but once a token is
set the check is direct equality with no other defenses.

## Reproduction

`curl`-probe the endpoint repeatedly with random tokens. No throttling
kicks in. Timing differences are measurable with enough samples on a
local network.

## Proposed fix

1. **Constant-time comparison** — use `crypto.timingSafeEqual` on
   Buffer-wrapped tokens. Guard against length mismatch to avoid
   exceptions:

   ```ts
   import { timingSafeEqual } from "node:crypto";

   function safeEqual(a: string, b: string): boolean {
     const ab = Buffer.from(a, "utf8");
     const bb = Buffer.from(b, "utf8");
     if (ab.length !== bb.length) return false;
     return timingSafeEqual(ab, bb);
   }
   ```

2. **Rate limit** — reuse `src/lib/rate-limit.ts` with an aggressive
   throttle (5 requests / minute / IP is plenty for a cache revalidation
   endpoint).

## Notes

- Threat model is modest: the endpoint only invalidates cached editions
  and doesn't leak data. But it's an admin route and should treat
  authentication with appropriate discipline.
