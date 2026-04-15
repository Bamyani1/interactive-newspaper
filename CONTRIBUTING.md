# Contributing to The Transcript Archive

Thanks for taking a look. This is a solo portfolio project, so the primary author does not actively recruit contributors — but issues, discussions, and small focused PRs are welcome.

## Ground rules

- **Scope.** The project is pre-production and under active iteration. Large feature PRs may be declined if they conflict with the roadmap. Open an issue first before investing significant effort.
- **Conventional commits.** Commit messages follow the [Conventional Commits](https://www.conventionalcommits.org/) format: `feat(rag):`, `fix(ocr):`, `chore:`, `docs:`, `ci:`. Keep the summary under ~70 characters.
- **One concern per PR.** Bundle unrelated changes into separate PRs.
- **Tests.** If you change `src/lib/`, add or update a Vitest test next to the change. If you change `ocr/src/transcript_ocr/`, add a pytest test under `tests/ocr/`.
- **Lint + tests.** `npm run lint` and `npm run test:run` must pass before requesting review.

## Filing an issue

1. Check existing discussions first.
2. Include reproduction steps, expected vs. actual behaviour, Node/Python/Postgres versions, and any relevant log output.
3. For OCR pipeline issues, attach the `diagnostics.json` from the affected run if possible.
4. For RAG pipeline issues, include the request ID from the response headers and a one-line question/answer excerpt.

## Development workflow

```bash
# Install
npm install
cp .env.example .env.local     # fill DATABASE_URL, GOOGLE_API_KEY, etc.

# Run locally
npm run dev                    # http://localhost:3000

# Tests + lint
npm run lint                   # ESLint (zero errors; one known pre-existing warning is acceptable)
npm run test:run               # Vitest run mode
python -m pytest tests/ocr/ -x # Python OCR suite (if working on the pipeline)
```

See `README.md` for the full command reference and environment variable list.

## Code of conduct

Be respectful. Assume good intent. This project exists to make historical student journalism more accessible, and contributors are expected to share that goal.
