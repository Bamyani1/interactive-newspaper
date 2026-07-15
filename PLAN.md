# Front-End Audit Execution Plan

Current checkpoint: Final — all batches (0–8) implemented, independently
reviewed, and verified by the clean production sweep. The eight scoped
commits are created and a fresh independent reviewer has signed off.

## Batches

| Batch | Work | Status | Required reviewer |
|---|---|---|---|
| 0 | Playwright/axe harness, scripts, evidence manifest, clean lint baseline | Approved | Tooling reviewer |
| 1 | First paint, theme ownership, deterministic edition/date context, route navigation | Approved | Transition reviewer |
| 2 | Exact tokens, Tailwind mapping, fonts, primitives, global accessibility | Approved | Design-system reviewer |
| 3 | Landing and information routes | Approved | Visual reviewer |
| 4 | Ask workspace, hydration, states, sources, drawers/lightboxes | Approved | Ask reviewer |
| 5 | Search states, filters, results, navigation | Approved | Search reviewer |
| 6 | Edition layout/feed/navigation/context/responsiveness | Approved | Edition reviewer |
| 7 | Dead UI cleanup and isolated current-major dependency patches | Approved | Regression reviewer |
| 8 | Full edition/route sweep, final-sweep harness fixes, holistic sign-off | Approved | Fresh final reviewer |

## Verification loop

1. Reproduce the ledger item and save before evidence.
2. Fix the shared root cause in a scoped diff.
3. Run lint, typecheck, relevant Vitest, Playwright, and production build gates.
4. Save after evidence at desktop/mobile and transition frames where relevant.
5. A different agent reviews against `BASELINE.md`, accessibility, and regression
   criteria; only an approved batch is committed.

## Evidence conventions

- Full generated archive: `audit-evidence/full/{before|after}/<route>/<state>/<viewport>/` (ignored).
- Curated tracked evidence: `audit-evidence/curated/<issue-id>/`.
- Manifest: `audit-evidence/manifest.json`, including route/state/viewport,
  commit, before/after path, checks, and reviewer verdict.
- Transition frames: 0, 50, 100, 250, 500, and 1000ms with delayed RSC/API
  responses for primary navigation edges.
