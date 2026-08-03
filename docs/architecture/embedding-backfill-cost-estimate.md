# Embedding Backfill — Written Cost Estimate

Status: **estimate from corpus statistics; exact figures pending the
approval-gated read-only dry-run** (`npm run rag:index:build -- --dry-run`)
Prepared: 2026-08-02

This document satisfies the Phase 5 requirement that a full embedding backfill
have a written cost estimate before its own separate approval. **Nothing here
authorizes spending.** The $10 live-evaluation ceiling does not cover this
backfill; it requires explicit stand-alone approval.

## Inputs

| Quantity | Value | Source |
|---|---|---|
| Articles | 11,705 | frozen corpus `legacy-8b8207373510d69e` |
| Image references | 2,876 (across 2,537 articles) | frozen corpus |
| Chunk target / overlap | 3,200 chars / ≤600-char trailing sentences (effective stride ≈2,600) | `src/lib/article-chunking.ts` |
| Per-chunk context header | ≈150 chars | `buildEmbeddingText` |
| Text price | $0.20 / M input tokens | `src/lib/cost-tracker.ts` |
| Image price | $0.00012 / image (+ caption text tokens) | `src/lib/cost-tracker.ts` |
| Token conversion | chars ÷ 4 (the cost-tracker's own fallback ratio) | `src/lib/cost-tracker.ts` |

## Formula

```
embedded_chars ≈ C × overlap_inflation + n_chunks × 150
  C                 = total body+headline characters across the corpus
  overlap_inflation ∈ [1.0, 3200/2600 ≈ 1.23]  (1.0 for single-chunk articles)
  n_chunks          ≈ Σ max(1, ceil((L_i − 600) / 2600))

text_cost  = (embedded_chars / 4) / 1e6 × $0.20
image_cost = 2,876 × $0.00012 + (caption_chars / 4) / 1e6 × $0.20
```

`C` is not measurable locally (this worktree has no edition data and the
frozen corpus snapshot stores hashes, not text). The dry-run computes it
exactly with read-only SELECTs.

## Bracketed estimate (per full pass)

| Scenario | avg chars/article | text tokens | text cost |
|---|---:|---:|---:|
| Low | 1,500 | ≈5.1 M | **$1.01** |
| Mid | 2,500 | ≈8.5 M | **$1.71** |
| High | 4,000 | ≈14.7 M | **$2.93** |

Image add-on: 2,876 × $0.00012 = $0.345 per-image fee plus ≈$0.09 of caption
context ≈ **$0.43**.

**Expected magnitude: text-only ≈ $1.0–$2.9 (central ≈ $1.7); text+image ≈
$1.4–$3.4 (central ≈ $2.2) per full pass.** The estimate carries a ±25% band
until the first paid batch confirms the API's actual token accounting.

## Number of passes

Two full passes may be required — one for the Phase 7 isolated evaluation
index and one for the eventual Phase 8 production build — unless vectors are
copied between builds (identical model, dimensions, and input hashes; only
the build ID differs). Worst case with two full text+image passes ≈ **$7**.
The pass-count decision belongs to the Phase 7/8 approvals; both options will
be presented with the evaluation report.

## What approval is being requested (in order)

1. **Read-only production access** to produce exact figures: SELECTs over
   `articles`/`ads`/`article_images` (registry bootstrap + dry-run character
   counts) and R2 `ListObjectsV2` over both namespaces. No writes of any kind.
2. **After exact figures are recorded here: the paid backfill itself**, scoped
   to the Phase 7 evaluation environment first (never production in that
   step), executed via the resumable, build-scoped
   `npm run rag:index:build` tool with per-item failure isolation and the
   quota-stop behavior inherited from the embeddings module.

Until both approvals are given, stable `gemini-embedding-2` vector coverage
remains 0/11,705 and `/ask` retrieval remains lexical-only wherever the
legacy vector filter applies.
