# Archive

**Nothing in this directory is current.** These are plans and handoffs for work that
has since shipped, kept for provenance — why a decision was made, what the numbers
looked like at the time, what the rollout actually did.

Do not follow instructions in these files and do not treat their figures as live.
They quote model names, budgets, deadlines, and coverage numbers that were true when
written and have drifted since.

For how the system works today:

| Topic | Live document |
|---|---|
| Retrieval and answer generation | [`../architecture/rag-pipeline.md`](../architecture/rag-pipeline.md) |
| OCR pipeline | [`../architecture/ocr-pipeline.md`](../architecture/ocr-pipeline.md) |
| Database schema and data flow | [`../architecture/data-model.md`](../architecture/data-model.md) |
| Production rollout / rollback | [`../architecture/rag-phase8-rollout-runbook.md`](../architecture/rag-phase8-rollout-runbook.md) |
| Evaluation results | [`../architecture/rag-phase7-evaluation-report.md`](../architecture/rag-phase7-evaluation-report.md) |

## Contents

| File | What it recorded | Superseded by |
|---|---|---|
| `rag-enhancement-handoff.md` | Phase-by-phase branch handoff for the RAG v2 build (phases 0–9, now closed) | `../architecture/rag-pipeline.md` |
| `rag-data-pipeline-final-plan.md` | The original RAG data-pipeline roadmap | `../architecture/rag-pipeline.md`, `../architecture/data-model.md` |
| `ocr-pipeline-implementation-plan.md` | Reviewed plan for the OCR rewrite, implemented and verified | `../architecture/ocr-pipeline.md` |
| `embedding-backfill-cost-estimate.md` | Point-in-time cost estimate that gated the embedding backfill (since executed) | — |
