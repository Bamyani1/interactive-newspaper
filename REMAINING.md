# Remaining Front-End Audit Work

> **Superseded — completed.** Retained as a point-in-time resume artifact and as
> the source of the eight-commit list. The work it describes is done: all batches
> implemented and independently reviewed, the clean production sweep green, the
> eight scoped commits created, and a fresh independent reviewer signed off. See
> `AUDIT.md` (Batch 8), `PROGRESS.md`, and `audit-evidence/manifest.json` for final
> state.

Last updated: 2026-07-15  
Branch: `codex/frontend-holistic-audit`  
Base: `origin/main` at `1c1663e1819abe7b5ce3b00c153cd74c35208276`

This is the resumable handoff for the holistic front-end audit. The branch is
local. Nothing has been pushed, no pull request exists, and no commits have
been created yet. The worktree contains the reviewed implementation and test
changes; `git diff --check` is currently clean.

## Critical resume facts

- Do **not** reset, clean, switch away from, or discard the dirty worktree. All
  requested implementation currently exists only as uncommitted changes.
- `git log origin/main..HEAD` is empty. No file is staged. The next session must
  create the requested scoped commits only after the remaining gates pass.
- The final `sweep_harness_fixer` subagent was interrupted at the user's request
  before it implemented the three blockers below. Do not assume those fixes
  landed. Current source still lacks production-aware gallery expectations, a
  default weather fixture, and the exact 1989 asset deferral.
- All product batches preceding the final sweep received independent approval.
  The remaining failures are two audit-harness gaps and one external missing
  image/data contract. The latter is still user-visible as a failed image on
  the 1989 edition; no fallback behavior has yet been independently verified.
- `audit-evidence/full/after/` is a **partial failed sweep**, not final evidence.
  Preserve it for diagnosis, then move it aside before generating the clean
  successful archive.
- `audit-evidence/manifest.json` is stale: it contains only three Batch 0
  entries and every `commit` is null. `PLAN.md` also still labels the work as
  Phase 0. Neither file represents final completion yet.

## First actions in the next session

1. Work only in
   `/Users/bamyani/Desktop/project/interactive-newspaper-main` on
   `codex/frontend-holistic-audit`.
2. Read `AGENTS.md`, this file, `AUDIT.md`, `BASELINE.md`, `PLAN.md`,
   `PROGRESS.md`, `design.md`, and `docs/design/carve-outs.md` before editing.
3. Run `git status --short`, `git log --oneline origin/main..HEAD`, and
   `git diff --check`. Expect a large dirty worktree, no commits, and a clean
   whitespace check.
4. Inspect these final-sweep logs before changing the harness:
   - `audit-evidence/full/after/final-gates/00-summary.txt`
   - `audit-evidence/full/after/final-gates/09-audit-visual.log`
   - `audit-evidence/full/after/final-gates/12-audit-editions.log`
5. Assign the three remaining corrections to a harness fixer, then have a
   different agent review them. A fixer must not approve its own work.
6. Do not push or open a pull request. Keep backend APIs, database behavior,
   RAG, OCR, `gold/**`, `design.md`, and environment files untouched.

## Completed and independently reviewed

- Removed opacity-zero route/reveal gates and whole-page edition loading UI.
- Consolidated theme ownership, scoped landing forced-dark mode, stabilized
  archive dates, and preserved edition Back/Forward scroll restoration.
- Made landing content/navigation immediate and optimized its derived artwork.
- Stabilized Ask SSR/hydration, restore/deep-link ordering, streaming/error/
  expired/thread/export/source/gallery/lightbox states, and production URL
  cleanup. No live AI calls are made by the browser suite.
- Aligned tokens, fonts, primitives, contrast, 12px text minimum, 44px targets,
  keyboard/dialog behavior, and reduced motion with `design.md`.
- Added deterministic Search states and edition context/media/navigation states.
- Removed the approved dead UI and preserved/retargeted documented carve-outs.
- Added a safe global error surface and development-only fixture gallery.
- Added strict console/hydration/page/request/HTTP diagnostics, axe, CLS,
  transition filmstrips, no-JavaScript checks, and breakpoint coverage.
- Reconciled 351 live/API dates, 351 generated date paths, `/edition` as path
  352, 373 local dates, and 22 expected local-only 404s.
- Updated the requested front-end packages to their exact requested versions.
- Protected scope audit passed: no backend API, database, RAG, OCR, `gold/**`,
  `design.md`, environment, or unrelated business-logic changes.

## Last green gates

- `git diff --check`
- `npm run lint`
- `npm run typecheck`
- `npm run test:frontend` — 45 files / 274 tests
- `npm run test:e2e` — 91 passed / 5 intentional skips / 0 failed
- `npm run build` — passed; only the two documented unchanged backend image-
  route broad-pattern warnings
- `npm run audit:transitions` — 22/22; maximum transition CLS
  `0.0041479343`, average `0.0002304408`
- Development breakpoint audit — 72/72 route-width states
- Full Vitest — 709 passed / 11 skipped; only failure is the pre-existing
  missing `public/editions/1983-04-28/edition.json` OCR fixture

## Remaining blockers

These are the only known items that are not properly implemented or not fully
verified. If a new failure appears, record it rather than weakening a gate.

### 1. Production gallery expectations in two audit specs

The product is correct: `/dev/primitives` is a development 200 and production
404. The generic production visual and breakpoint specs still expect the
development heading/status.

Update:

- `tests/e2e/audit/visual.spec.ts`
- `tests/e2e/audit/breakpoints.spec.ts`

In production, keep the route in the sweep, require HTTP 404 plus the generic
`Page Not Found` first paint, consume only that expected document 404, and
capture evidence. In development, continue requiring the primitives gallery.
Do not exclude the route or weaken other diagnostics.

### 2. Deterministic weather fixture for the exhaustive desktop sweep

The desktop sweep stopped after 11/373 because repeated real
`/api/weather?date=...` requests reached middleware rate limiting (429).

Add a default deterministic `GET **/api/weather?*` fixture in
`tests/e2e/support/deterministic.ts` returning a valid empty response such as:

```json
{ "record": null, "reason": "No deterministic audit weather record." }
```

Confirm edition-state specs can still override this fixture and add a focused
test proving the full audit never reaches the live weather endpoint.

### 3. One exact missing external edition image

The mobile union sweep stopped at 268/373 on `/edition/1989-10-25` because this
R2 object is absent:

`0004_Page 4_img1.webp`

The Next image optimizer returned 404 and one responsive candidate aborted.
This is an external asset/data contract, not a layout or hydration failure.

Implement a narrow audit deferral for this exact encoded R2 object only:

- consume only its corresponding optimizer 404/console entry and aborted
  responsive candidate;
- record its full URL, edition, and reason in edition evidence;
- keep the screenshot/fallback visible;
- add negative tests proving near matches and every other image failure still
  fail strict diagnostics.

Do not add a generic image-error suppression or mock all edition media. Record
this as `ASSET-001` in `AUDIT.md` with a reasoned external-data deferral.

If a production fallback is added instead of an audit-only deferral, it must
still preserve the exact failure record, avoid hiding other assets, and receive
an independent visual/accessibility review. Restoring the missing R2 object is
outside the authorized front-end scope.

## Required reruns after those three corrections

Use a fresh production build and one owned server/port.

```sh
npm run lint
npm run typecheck
npm run test:frontend
npm run test:e2e
npm run build

# Start the completed build on an unused local port, for example 3219.
npm run start -- --hostname 127.0.0.1 --port 3219

# In a second shell, against that owned production server:
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3219 PLAYWRIGHT_SERVER_MODE=production npm run audit:visual
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3219 PLAYWRIGHT_SERVER_MODE=production npm run audit:transitions
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3219 PLAYWRIGHT_SERVER_MODE=production npx playwright test tests/e2e/audit/breakpoints.spec.ts --project=chromium-desktop --workers=1
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3219 PLAYWRIGHT_SERVER_MODE=production npm run audit:editions
```

The edition gate is complete only when both projects finish all 373 union dates
(746 route/viewport states), including screenshots for the 22 local-only 404s,
with no generated/local failures other than documented `ASSET-001`.

Then rerun `npm run test:run` and confirm the only failure is still the known
missing OCR fixture.

## Evidence still to finish

Current ignored local evidence:

- `audit-evidence/full/after/` — partial final sweep, about 634 MB
- `audit-evidence/full/pre-final-20260715T173421Z/` — preserved earlier run,
  about 224 MB
- `audit-evidence/full/after/final-gates/00-summary.txt` — exact final-sweep log

Before the successful rerun, rename the current partial `after` directory to a
new `pre-final-failed-*` directory and recreate an empty `after` directory.
This prevents stale passing screenshots or failing metrics from being mistaken
for the final archive.

Tracked pristine before evidence is complete:

- `audit-evidence/curated/BATCH-ORIGIN-MAIN-BEFORE/` — 28 inspected PNGs plus
  metadata from pristine `origin/main`, about 11 MB

After all reruns pass:

1. Curate matching representative after PNGs for landing, Ask, Search, About,
   1960 edition, and delayed edition navigation.
2. Update `audit-evidence/manifest.json` with reviewed batch entries, before/
   after paths, commands, verdicts, final inventory/CLS metrics, deferrals, and
   actual commit hashes.
3. Update every route/state row and issue in `AUDIT.md`, `PLAN.md`, and
   `PROGRESS.md`; change `PLAN.md` from the stale Phase 0 heading to final.

## Commits still required

Create scoped conventional commits only after the reruns are green. Suggested
order:

1. `chore(deps): update audited frontend packages`
2. `fix(ui): align design system and accessibility`
3. `fix(edition): remove dead readers and gate desktop context`
4. `fix(ui): stabilize first paint and edition navigation`
5. `fix(landing): remove delayed first-paint gates`
6. `fix(ask): keep workspace stable through hydration`
7. `test(frontend): add holistic browser audit harness`
8. `docs(frontend): record holistic audit results`

After committing, verify no untracked/requested files remain, run a fresh
independent final review, and update the evidence manifest with the resulting
hashes. Keep the branch local unless push/PR work is explicitly requested.

## Copy/paste handoff prompt

```text
Continue the holistic front-end audit in:
/Users/bamyani/Desktop/project/interactive-newspaper-main

Work on the existing local branch `codex/frontend-holistic-audit`. Do not
create another branch, reset/clean the worktree, discard changes, push, or open
a PR. There are currently no commits beyond origin/main and no staged files;
the large dirty worktree is the reviewed implementation and must be preserved.

First read, in order:
1. AGENTS.md
2. REMAINING.md
3. AUDIT.md, BASELINE.md, PLAN.md, PROGRESS.md
4. design.md and docs/design/carve-outs.md
5. audit-evidence/full/after/final-gates/00-summary.txt
6. audit-evidence/full/after/final-gates/09-audit-visual.log
7. audit-evidence/full/after/final-gates/12-audit-editions.log

Then verify the starting state with:
`git status --short`
`git log --oneline origin/main..HEAD`
`git diff --check`

Treat all completed product batches as independently reviewed. Use separate
agents for the remaining harness fixes and their review; no fixer approves its
own batch. Keep the orchestrator limited to ledgers/evidence coordination.

Exactly three final-sweep blockers remain:

1. Production `/dev/primitives` handling:
   `tests/e2e/audit/visual.spec.ts` and
   `tests/e2e/audit/breakpoints.spec.ts` still expect the development 200
   gallery. In production the required behavior is a 404 with `Page Not Found`.
   Keep the route in both sweeps, consume only its expected document 404, and
   capture evidence. Do not exclude it or weaken other diagnostics.

2. Exhaustive desktop weather fixture:
   add a deterministic default `GET **/api/weather?*` fixture in
   `tests/e2e/support/deterministic.ts`, returning a valid empty weather
   response. Confirm edition-state tests can override it and that the full
   edition audit never calls the real weather endpoint. The prior desktop run
   stopped at 11/373 only because middleware returned 429.

3. Exact missing external asset:
   `/edition/1989-10-25` references missing R2 object
   `0004_Page 4_img1.webp`. Add only an exact, recorded audit deferral for its
   encoded Next optimizer 404/console entry and aborted responsive candidate.
   Preserve the screenshot/fallback, record full URL/edition/reason, and add
   negative tests proving all near-match and other asset failures remain fatal.
   Never add a generic image suppression or mock all media. Record `ASSET-001`
   as a reasoned external-data deferral in AUDIT.md. Restoring R2 is out of
   front-end scope.

After an independent reviewer approves those fixes, move the current partial
`audit-evidence/full/after` aside so the next `after` archive is clean. Run the
entire command sequence in REMAINING.md against one fresh owned production
server. Completion requires visual and breakpoint production sweeps green and
both edition projects completing all 373 union dates (746 route/viewport
states), with exactly 351 live/generated dates, 352 paths including /edition,
373 local dates, 22 local-only 404s, zero generated-only dates, and only the
documented ASSET-001 external deferral.

Expected already-green gates to preserve:
- lint and typecheck
- frontend tests: 45 files / 274 tests
- cross-browser E2E: 91 pass / 5 intentional skips
- production build with only two unchanged backend image-route warnings
- transitions: 22/22, max CLS 0.0041479343
- development breakpoints: 72/72
- full Vitest: 709 pass / 11 skip, with only the pre-existing missing
  public/editions/1983-04-28/edition.json OCR fixture failing

Do not treat the current 634 MB `audit-evidence/full/after` directory as final;
it is partial. Pristine before evidence is complete under
`audit-evidence/curated/BATCH-ORIGIN-MAIN-BEFORE/` (28 PNGs plus metadata).
After all reruns pass, curate matching after images, fully update
audit-evidence/manifest.json, finish every ledger/route row, replace PLAN.md's
stale Phase 0 heading, create the eight scoped conventional commits listed in
REMAINING.md, add actual commit hashes to the manifest, and assign a fresh
independent final reviewer. Keep the branch local and do not push or create a
PR unless explicitly requested.
```
