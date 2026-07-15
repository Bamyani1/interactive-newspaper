# After corrections

- Every Ask POST is fulfilled by a deterministic local SSE response carrying
  the `x-audit-fixture: deterministic-ask-stream` proof header.
- Route-specific first-paint checks reject empty, zero-sized, hidden, or
  opacity-zero content; diagnostics are asserted per smoke route, transition,
  and edition.
- Generated evidence follows
  `full/{before|after}/{route}/{state}/{viewport}/`; recorded paths are
  repository-relative and filmstrip filenames contain measured elapsed time.
- The development harness requires `/dev/primitives` to return 200, while the
  production harness requires the same route to return 404.

Verification commands:

```text
npm run typecheck
npm run lint
npm run test:frontend
npm run test:e2e
npm run test:e2e:production
```
