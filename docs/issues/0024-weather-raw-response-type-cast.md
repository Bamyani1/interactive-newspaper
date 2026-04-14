---
id: 0024
title: weather.ts uses `as unknown as` double-cast for raw OpenMeteo response
status: open
severity: low
area: api
opened: 2026-04-13
---

## Symptom

`src/lib/weather.ts:481` stores the raw OpenMeteo response as an
unvalidated `Record<string, unknown>` via:

```ts
raw: parsed as unknown as Record<string, unknown>
```

This double-cast bypasses TypeScript's type system entirely. Any future
schema drift in OpenMeteo's response will compile cleanly but produce
surprising runtime behavior in downstream consumers.

## Root cause

The developer needed to store the raw response as part of the cached
weather record but didn't define a proper type for it. The double-cast
(`as unknown as`) is the TypeScript idiom for "I know this won't type-check
and I want to force the conversion anyway" — which is fine for
throwaway code but leaves no check for the actual structure.

## Proposed fix

Pick one of:

1. **Stringify.** Store as `JSON.stringify(parsed)` and parse on read. No
   structural claim in the type system.
2. **Explicit type.** Define `type OpenMeteoRawResponse = { ... }` with
   the fields you actually care about, and cast with `parsed as
   OpenMeteoRawResponse`. The compiler will catch structural drift.
3. **zod schema.** Define a zod schema for OpenMeteo responses and call
   `.parse()` / `.safeParse()` to validate at the boundary. Heaviest but
   most principled.

If the raw field is purely informational (never read programmatically),
option 1 is lowest-overhead. If any code reads fields off `raw`, option 2
or 3.

## Notes

- Low severity because OpenMeteo is stable and this code path hasn't
  broken in practice. Flagged as defensive hygiene.
