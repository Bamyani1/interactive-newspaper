---
name: transcript-ocr
description: >
  Process scanned newspaper pages into structured edition.json files for The Transcript Archive.
  Use this skill whenever the user mentions OCR, scanning newspapers, processing editions, extracting
  articles from scans, newspaper digitization, edition processing, or asks to turn scanned pages into
  structured data. Also triggers for requests like "process this edition", "OCR these scans",
  "extract articles from these pages", "run the pipeline on this folder", or "digitize this newspaper".
  Use this skill even for vague requests like "I have some scans to process" or "new edition ready".
---

# Transcript OCR Skill

You are processing scanned 1960s newspaper pages into structured JSON. You replace the Gemini AI components of an existing OCR pipeline — you do the reading, structuring, merging, and enrichment yourself using your vision capabilities. The existing YOLO detection and image cropping code still runs as Python scripts you orchestrate.

The output is an `edition.json` file that feeds directly into the archive's database and web UI. Accuracy matters more than speed — every word, every field, every structural detail must be correct.

## Before you start

Read these reference files in order. They contain the schemas, detailed pipeline steps, and examples you need:

1. `references/schema.md` — The exact output schema. Every field, every type, every valid value. Treat this as the contract.
2. `references/pipeline.md` — Detailed phase-by-phase instructions for the 6-phase pipeline.
3. `references/examples.md` — Example inputs and outputs, edge cases, and known failure modes from past runs.

## Quick Overview

**Input:** A folder of scanned newspaper pages (TIF, JPG, or PNG files).

**Output:** `public/editions/YYYY-MM-DD/edition.json` + `images/` directory with cropped article/ad photos.

**6 Phases:**

1. **Preprocess** — Convert TIFs, quality-check pages, deskew/enhance. Run `scripts/preprocess.py`.
2. **Detect & Crop** — YOLO finds image regions, crops them to files. Also done by `scripts/preprocess.py`.
3. **Per-Page OCR** — YOU read each page scan and extract articles, ads (with enrichment), and other content. This is the core work.
4. **Cross-Page Merge** — YOU review all pages together and merge articles that continue across pages.
5. **Assemble** — Run `scripts/assemble.py` to build the final edition.json and copy images.
6. **Validate** — Run `scripts/validate.py` to check the output against the schema contract.

## Phase 1 & 2: Preprocess + Detect

Run the preprocessing script. It handles TIF conversion, quality checks, image preprocessing, YOLO detection, and image cropping in one step:

```bash
cd <project-root>
source ocr/.venv/bin/activate
python <skill-path>/scripts/preprocess.py <scan-folder> --output <output-dir>
```

This produces:
- Preprocessed page images (JPG) in `<output-dir>/pages/`
- Cropped image regions in `<output-dir>/images/`
- A detection manifest at `<output-dir>/detection_manifest.json`

If the script fails (missing YOLO model, venv issues, etc.), check `references/pipeline.md` for troubleshooting.

## Phase 3: Per-Page OCR (Your Core Work)

This is where you do the heavy lifting. For each page:

1. **View the full page scan** from `<output-dir>/pages/`.
2. **Read the detection manifest** to see which image regions YOLO found on this page.
3. **View each cropped image** to understand what the photos show.
4. **Extract everything** on the page into structured JSON.

Read `references/pipeline.md` § "Phase 3" for the detailed extraction instructions, but the key points:

- **Read carefully.** Multi-column layouts are tricky — identify column boundaries first, then read each column top-to-bottom. Never read across columns.
- **Article boundaries** are marked by headlines (bold/large text), horizontal rules, bylines, and whitespace gaps.
- **Continuation markers** like "(Continued on page 5)" or "(See Back Page)" tell you an article continues elsewhere. Record these in `continues_on`/`continued_from`.
- **Image matching:** Use spatial proximity and caption text to assign each YOLO-cropped image to its article or ad. Read the caption from the page near the image.
- **Ad enrichment is inline:** For every ad you extract, also determine its category, type, and metadata right away. You're already looking at it — don't defer this to a later pass.
- **Other content** includes mastheads, standings tables, notices, announcements, and standalone photos with captions that don't belong to any article.

Save each page's results as `<output-dir>/page_results/page_<N>.json`.

### Per-page output format

```json
{
  "page_number": "1",
  "articles": [
    {
      "headline": "...",
      "author": "",
      "writer_position": "",
      "category": "Campus News",
      "continues_on": "",
      "continued_from": "",
      "body": "...",
      "images": [{"caption": "...", "position": "upper-center"}],
      "image_files": ["images/0001_Page 1_img1.jpg"]
    }
  ],
  "ads": [
    {
      "business_name": "...",
      "body": "...",
      "image_files": []
    }
  ],
  "enriched_ads": [
    {
      "business_name": "...",
      "body": "...",
      "image_files": [],
      "category": "Retail",
      "ad_type": "display",
      "display_text": "...",
      "phone": "",
      "address": "",
      "price": ""
    }
  ],
  "other_content": [
    {"title": "...", "body": "..."}
  ],
  "publication_info": ""
}
```

`publication_info` is only extracted from the masthead page (usually page 1). Leave it empty on other pages.

## Phase 4: Cross-Page Merge

After all pages are done, review the full set of results together:

1. **Identify continuations:** Match articles where page X says `continues_on: "Y"` with an article on page Y that says `continued_from: "X"` or has a matching headline.
2. **Merge matched articles:** Combine body text (earlier page first), merge images, unify metadata, collect source_pages.
3. **Normalize continuation fields:** Any non-numeric value (like "Back Page") becomes `"?"`.
4. **Deduplicate:** Remove duplicate ads and other_content that appeared on multiple pages.
5. **Check for orphaned images:** If a cropped image isn't assigned to any article or ad, create an other_content entry for it with the caption as body text.

Save the merged results as `<output-dir>/merged_edition.json`.

## Phase 5 & 6: Assemble + Validate

```bash
python <skill-path>/scripts/assemble.py <output-dir> --date YYYY-MM-DD --dest public/editions/YYYY-MM-DD/
python <skill-path>/scripts/validate.py public/editions/YYYY-MM-DD/edition.json
```

If validation reports errors, fix them in the merged results and re-run assembly.

## Multiple Editions (Parallel Processing)

When the user provides multiple edition folders, spawn one subagent per edition:

```
For each edition folder:
  → Agent tool: "Process edition <date>"
  → Each agent runs the full 6-phase pipeline independently
  → Report results as editions complete
```

Coordinate from the main conversation — track which editions are done, which failed, and present a summary when all are complete.

## Text Accuracy: Why It Matters

The previous pipeline used Gemini models for text extraction and structuring. The two biggest problems were:

1. **Garbled text** — Gemini would read across newspaper columns instead of down them, producing nonsensical text that mixed multiple articles together.
2. **Wrong structure** — Articles would be assigned incorrect headlines, categories, or continuation info.

You have an advantage: you can see the full page layout and use visual context to understand column boundaries, article flow, and which text belongs where. Use that advantage. When in doubt, zoom in on the cropped images and read character by character. Getting 98% of words right is not good enough — this is a historical archive. Every word matters.
