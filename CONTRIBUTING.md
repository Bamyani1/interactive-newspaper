# Contributing to The Transcript Archive

Thanks for taking a look. This is a solo portfolio project, so the primary author does not actively recruit contributors — but issues, discussions, and small focused PRs are welcome.

## Ground rules

- **Scope.** The project is pre-production and under active iteration. Large feature PRs may be declined if they conflict with the roadmap. Open an issue first before investing significant effort.
- **Conventional commits.** Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/) format: `feat(rag):`, `fix(ocr):`, `chore:`, `docs:`, `ci:`. Keep the summary under ~70 characters.
- **One concern per PR.** Bundle unrelated changes into separate PRs.
- **Tests.** Tests mirror the source tree under `tests/` rather than sitting beside the code — a change to `src/lib/foo.ts` belongs in `tests/lib/foo.test.ts` (Vitest). If you change `ocr/src/transcript_ocr/`, add a pytest test under `tests/ocr/`. Feature UI tests use the feature name (`tests/ask-archive/`); browser specs live in `tests/e2e/` (`npm run test:e2e`).
- **Lint + tests.** `npm run lint`, `npm run typecheck`, `npm run test:typecheck`, and `npm run test:run` must pass before requesting review (CI runs all four). Note that ESLint is configured to skip `scripts/**` and `ocr/**`, so a clean lint says nothing about those trees — check them by hand.

## Filing an issue

1. Search existing issues first.
2. Include reproduction steps, expected vs. actual behaviour, Node/Python/Postgres versions, and any relevant log output.
3. For OCR pipeline issues, attach the edition's `provenance.json` and the matching `ocr/logs/failures.jsonl` lines if possible.
4. For RAG pipeline issues, include the `requestId` from the `/api/ask` response body (or SSE `error` event) and a one-line question/answer excerpt.

## Development workflow

```bash
# Install (Node 24+ with npm; Python 3.12 for the OCR pipeline)
npm ci
cp .env.example .env.local     # fill DATABASE_URL and Google Cloud project/location
gcloud auth application-default login

# Run locally
npm run dev                    # http://localhost:3000

# Checks
npm run lint                   # ESLint (zero errors and warnings; skips scripts/** and ocr/**)
npm run typecheck && npm run test:typecheck
npm run test:run               # Vitest run mode
npm run test:e2e               # Playwright smoke (optional; needs a database)

# Python OCR suite (if working on the pipeline)
source ocr/.venv/bin/activate && pip install pytest
python -m pytest tests/ocr/ -x
```

See `README.md` for the full command reference and environment variable list.

## Code of conduct

Be respectful. Assume good intent. This project exists to make historical student journalism more accessible, and contributors are expected to share that goal.
