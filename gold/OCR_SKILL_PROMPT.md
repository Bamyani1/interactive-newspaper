Create a Cowork skill called `transcript-ocr` that performs the complete OCR pipeline for The Transcript Archive — turning scanned newspaper pages into structured `edition.json` files. This skill replaces the Gemini-powered parts of the existing Python pipeline with Claude's vision and reasoning. This is deep, serious work. Do not rush. Plan thoroughly, iterate on the plan, then build.

Before writing anything, do the following research. Do all of it. Do not skip any step.

1. Read `CLAUDE.md` — understand the full project, tech stack, data flow, and existing pipeline structure.
2. Read `ocr/src/transcript_ocr/contracts/content_models.py` — this defines the exact Pydantic models for the output schema (MergedArticle, Ad, EnrichedAd, OtherContent, EditionContent, ArticleImage). The skill's output must match these models exactly.
3. Read `ocr/src/transcript_ocr/merging/continuation.py` — understand the continuation normalization rules (non-numeric values → "?", how continues_on/continued_from work).
4. Read `gold/1960-01-13/gold-edition.json` — this is the audited ground-truth reference. Study the exact shape, field names, how articles span pages, how images are referenced, how ads and enriched_ads relate.
5. Read `gold/1960-01-13/gold-edition-audit-log.md` — understand what the original pipeline got wrong and what was corrected.
6. Read `ocr/src/transcript_ocr/detection/` — understand how YOLO region detection works. The skill reuses YOLO for detecting regions and cropping images.
7. Read `ocr/src/transcript_ocr/preprocessing/` — understand image preprocessing (TIF → processable format).
8. Read `scripts/ocr/process-edition.sh` — understand the current orchestration flow.
9. Read `ocr/src/transcript_ocr/application/edition_pipeline.py` and `page_pipeline.py` — understand the phase-by-phase orchestration.
10. Explore `public/editions/1960-01-13/` to see what a final output directory looks like (edition.json + images/).

After completing ALL research, write a master plan document at `gold/ocr-skill-plan.md` covering:

- Every phase of the pipeline and what handles each phase
- What existing Python code is reused vs what Claude replaces
- How data flows from input scans to final edition.json
- Edge cases and known failure modes (from the audit log)
- The exact output schema with field-by-field documentation

Then review your own plan. Find gaps. Fix them. Review again. Only after you're confident the plan is airtight, proceed to writing the skill.

---

## What the skill does

The skill processes scanned newspaper pages into a structured `edition.json` file. Here's the pipeline:

### Phase 1: Setup and preprocessing
- User points the skill at a folder of scans (e.g., `ocr/inbox/1960-01-13/`) containing TIF and/or JPG/PNG page images.
- Convert any TIF files to JPG/PNG so Claude can view them. Use existing preprocessing code from `ocr/src/transcript_ocr/preprocessing/` if beneficial, or write a simple conversion script.
- Sort pages by filename into page order.

### Phase 2: YOLO region detection + image cropping
- Run the existing YOLO detection model on each page to identify regions: articles, ads, images, headers, etc.
- Use the existing Python cropping code to extract article/ad images from the page scans as separate JPG files.
- This phase reuses the existing Python pipeline code. The skill orchestrates it — it does not rewrite it.

### Phase 3: Per-page OCR with Claude (this is the core)
- For each page, Claude receives:
  - The full page scan image
  - The YOLO detection results (bounding boxes, region types)
  - The cropped images from that page
- Claude looks at the page and extracts:
  - **Articles**: headline, author, writer_position, category, body text, continuation markers (continues_on, continued_from), which images belong to this article with captions
  - **Ads**: business_name, body text, which images belong to this ad
  - **Ad enrichment (inline)**: For each ad, also extract: category (from the valid set: "Food & Drink", "Entertainment", "Services", "Retail", "Greek Life", "Jobs", "Housing", "Education", "Events", "Other"), ad_type ("display" or "classified"), display_text, phone, address, price
  - **Other content**: mastheads, column headers, filler items — title and body
- Claude must be meticulous about text accuracy. The biggest problem with the previous pipeline was garbled text (misread words, mixed-up columns, lost article boundaries). The skill must emphasize: read every word carefully, preserve exact spelling of proper nouns, do not guess at illegible text — mark it.
- Article categories must be exactly one of: "Campus News", "News", "Sports", "Arts & Entertainment", "Opinion".

### Phase 4: Cross-page article merging
- After all pages are processed, Claude reviews the full set of per-page articles.
- Claude identifies articles that continue across pages using continuation markers and content matching.
- Claude merges them into single articles with combined body text, merged source_pages, and correct continuation metadata.
- Continuation normalization: continues_on/continued_from values must be empty string, a page number string, or "?" — any non-numeric text like "Back Page" becomes "?".

### Phase 5: Assembly and output
- Assemble the final `edition.json` matching the EditionContent schema exactly:
  ```
  {
    "edition_date": "YYYY-MM-DD",
    "publication_info": "...",
    "articles": [ MergedArticle... ],
    "ads": [ Ad... ],
    "enriched_ads": [ EnrichedAd... ],
    "other_content": [ OtherContent... ]
  }
  ```
- Write `edition.json` to `public/editions/<date>/`
- Copy cropped images to `public/editions/<date>/images/`
- image_files paths in the JSON must be relative: `images/<filename>.jpg`
- images[] and image_files[] arrays must be index-aligned on every article and ad

### Phase 6: Self-audit
- After producing the output, the skill does a validation pass:
  - All articles have valid categories
  - All continuation fields follow normalization rules
  - images/image_files arrays are same length on every article
  - All referenced image files exist on disk
  - ads count == enriched_ads count
  - All enriched_ad categories and ad_types are from the valid sets
  - No control characters in text fields
  - Report any issues found

---

## Parallel edition processing

When the user provides multiple edition folders (or a parent folder containing several), the skill spawns one agent per edition to process them in parallel. Each agent handles its edition independently through all phases. A coordinator agent tracks progress and reports results as editions complete.

---

## Key requirements for the skill

- The skill MUST produce output that exactly matches the Pydantic models in `content_models.py`. Read those models carefully and treat them as the contract.
- The skill MUST handle the image pipeline end-to-end: YOLO detects regions → existing code crops images → images land in the output directory → JSON references them correctly.
- The skill MUST do ad enrichment inline during page processing, not as a separate pass. Claude already sees the ad — it should categorize and extract metadata right there.
- The skill MUST handle cross-page merging by having Claude review all extracted articles and decide merges, not by reusing the Python merger.
- Text accuracy is the top priority. The previous Gemini-based pipeline produced garbled text, wrong article boundaries, and structural errors. The entire point of this skill is to fix those problems by using Claude's superior vision and reasoning. Emphasize careful, word-by-word reading in the skill instructions.

---

## What to reuse from the existing Python pipeline

- YOLO region detection (`ocr/src/transcript_ocr/detection/`)
- Image cropping from detected regions
- Image preprocessing / TIF conversion (`ocr/src/transcript_ocr/preprocessing/`)
- Any file I/O utilities that are helpful

## What Claude replaces

- All Gemini text extraction (DocAI + Gemini structuring)
- All Gemini-based article structuring
- Cross-page merge decisions (was partly Gemini, partly heuristic)
- Ad enrichment (was a separate Gemini pass)

---

## Skill structure

```
transcript-ocr/
├── SKILL.md          — Main instructions
├── references/
│   ├── schema.md     — Full edition.json schema documentation
│   ├── pipeline.md   — Detailed phase-by-phase pipeline instructions
│   └── examples.md   — Example inputs/outputs for edge cases
├── scripts/
│   ├── preprocess.py — TIF conversion + YOLO detection orchestration
│   ├── validate.py   — Post-processing validation (Phase 6)
│   └── assemble.py   — Final JSON assembly + file copying
└── assets/           — (if needed)
```

The SKILL.md should be concise and reference the docs in references/ for details. Keep SKILL.md under 500 lines — use the references for depth.

---

## After writing the skill

Save the skill to `/sessions/laughing-hopeful-cray/mnt/.claude/skills/transcript-ocr/`.

Do NOT run test cases yet. Present the skill to me first for review. Show me:
1. The master plan document
2. The SKILL.md
3. Each reference file
4. Each script

I want to review everything before we test.
