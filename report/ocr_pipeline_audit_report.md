# OCR Pipeline Audit Report

**Date:** April 1, 2026
**Auditor:** Claude (automated audit)
**Pipeline version:** Git commit `59f1f39`
**Scope:** Two complete end-to-end runs from raw TIF scans through database seeding

---

## 1. Executive Summary

Two editions of The Transcript (Ohio Wesleyan University) were processed through the full OCR pipeline: a compact 8-page issue from October 12, 1988 and a larger 16-page issue from May 1, 1992. Both runs completed without hard errors (exit code 0), but the 1992 edition exposed a critical defect: two pages (2 and 6) suffered complete content loss when Gemini returned null candidates despite successful DocAI extraction.

**Input A (1988-10-12):** 8 pages → 27 articles, 19 ads → 25 seeded to DB. Pipeline time: 703s (11.7 min). All 8 pages processed successfully. DocAI mean confidence 97.2%. Overall accuracy: 3.5/5.

**Input B (1992-05-01):** 16 pages → 26 articles, 18 ads → 22 seeded to DB (4 filtered). Pipeline time: 1,524s (25.4 min). 14 of 16 pages processed; pages 2 and 6 returned zero content. DocAI mean confidence 96.8%. Overall accuracy: 3.5/5.

**Critical finding:** Gemini's structuring pass can silently fail (candidates_tokens = null) on pages that DocAI reads perfectly well. No error is recorded, no retry is attempted, and no fallback chunking triggers. This is the single most impactful bug found in this audit.

---

## 2. Pipeline Overview

The OCR pipeline executes in five phases orchestrated by `scripts/ocr/process-edition.sh`:

**Phase 1 — DocAI Extraction (per page, parallelized)**
Each TIF scan is preprocessed (grayscale conversion, CLAHE contrast enhancement, morphological denoising, border crop), then sent to Google Document AI Layout Parser for character-level OCR. DocLayout-YOLO simultaneously detects photo/illustration regions. DocAI returns raw text with token-level confidence scores; YOLO returns bounding boxes for figure regions filtered by class, area, and aspect ratio.

**Phase 2 — Gemini Structuring + Image Linking (per page, parallelized)**
The raw DocAI text and YOLO regions are sent to Google Gemini, which structures the text into articles, ads, and other content items with headlines, bylines, categories, and continuation markers. A visual matching pass then links detected image regions to their corresponding articles or ads.

**Phase 3 — Cross-Page Merging**
Articles that span multiple pages (identified by continuation markers like "Continued on page X") are merged into single entries. Deduplication removes overlapping content. Image orphans from merged articles are consolidated or dropped.

**Phase 4 — Ad Enrichment**
Post-processing enriches ad entries with additional metadata extracted by Gemini.

**Phase 5 — Diagnostics + Issue Reports**
Per-page diagnostics (timing, confidence, token usage, YOLO stats) are written to `diagnostics.json`. An `issue_report.json` flags any detected problems. The final `edition.json` is written to `public/editions/<date>/`.

After OCR completes, the orchestration script runs image cleanup (`cleanup-images.mjs`), R2 upload (`images:upload`), and database seeding (`db:seed`).

---

## 3. Test Inputs

### Input A: 1988-10-12

| Property | Value |
|----------|-------|
| Edition date | October 12, 1988 |
| Page count | 8 |
| Source format | TIF scans (numbered 0001–0008) |
| Content profile | Front-page campus news, editorial/opinion, Greek life features, ads, sports |
| Processing time | 702.6s (11.7 min) |
| Run ID | 20260401T211150Z |

### Input B: 1992-05-01

| Property | Value |
|----------|-------|
| Edition date | May 1, 1992 |
| Page count | 16 |
| Source format | TIF scans (numbered 0001–0016) |
| Content profile | Campus news, graduation coverage, sesquicentennial photo essay, arts, sports, ads |
| Processing time | 1,524.0s (25.4 min) |
| Run ID | 20260401T212340Z |

---

## 4. Page-by-Page Findings — Input A (1988-10-12)

### Page 1 — Front Page

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9743 |
| YOLO detections | 1 total, 0 kept (1 filtered by area) |
| Gemini tokens | 3,822 prompt / 1,469 candidates |
| Articles | 3 |
| Ads | 0 |
| Processing time | 40.0s |

Content: Campus news front page with shanty protest story ("Students Assemble Shanty in Solidarity with South Africa"), student government coverage, and news summary sidebar. One proper noun correction applied (South African → South Africa). YOLO detected one region but filtered it as too large. No images saved for this page.

Character errors: Minor. "South African" variant auto-corrected. Body text clean.

**Rating: 4/5**

---

### Page 2 — News

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9748 |
| YOLO detections | 50 total, 1 kept |
| Gemini tokens | 4,257 prompt / 1,991 candidates |
| Articles | 3 |
| Ads | 4 |
| Processing time | 61.0s |

Content: Continuation articles, campus news, and classified advertisements. One image region detected and matched to an ad via visual matching. High YOLO detection count (50 components found) but aggressive class filtering kept only 1.

Character errors: Isolated OCR errors in ad text — minor garbling in small-print classified sections. Body article text accurate.

**Rating: 4/5**

---

### Page 3 — News & Ads

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9734 |
| YOLO detections | 47 total, 3 kept |
| Gemini tokens | 3,663 prompt / 1,505 candidates |
| Articles | 3 |
| Ads | 5 |
| Processing time | 32.7s |

Content: Continuation of shanty protest story (merged with page 1 during Phase 3), additional news, and multiple advertisements. Three image regions detected; one matched to an article, two to ads via visual matching. Fastest page in this edition.

Character errors: Minimal. One ad image region unmatched but content captured correctly as text.

**Rating: 4/5**

---

### Page 4 — Editorial / Opinion

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9711 |
| YOLO detections | 36 total, 3 kept |
| Gemini tokens | 3,612 prompt / 1,436 candidates |
| Articles | 7 (including letters, masthead entries) |
| Ads | 0 |
| Processing time | 61.3s |

Content: Editorial page with opinion pieces, letters to the editor, editorial cartoon, and masthead. Highest article count per page in this edition (7 items). Three images detected; one matched to an article (editorial cartoon), two classified as standalone.

Character errors: This was the weakest page in Input A. Five character-level errors identified: garbled fragments in editorial cartoon caption text, minor spacing artifacts in letter text where column breaks occurred, and one proper noun rendering issue. Editorial cartoon handwritten text partially corrupted.

**Rating: 2.5/5**

---

### Page 5 — Features / Greek Life

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9704 |
| YOLO detections | 47 total, 2 kept |
| Gemini tokens | 3,652 prompt / 1,601 candidates |
| Articles | 3 |
| Ads | 6 |
| Processing time | 62.8s |

Content: Greek life features (Delta Zeta coverage), campus life articles, and advertisements. One proper noun correction applied (Delta Zetas → Delta Zeta). One image matched to article; one text-ad image correctly rejected by visual matching.

Character errors: None detected in article body text. Clean extraction.

**Rating: 5/5**

---

### Page 6 — Sports / News

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9695 |
| YOLO detections | 43 total, 1 kept |
| Gemini tokens | 3,906 prompt / 1,670 candidates |
| Articles | 3 |
| Ads | 3 |
| Processing time | 60.7s |

Content: Sports coverage and news articles with accompanying photographs. One image region detected and successfully matched to an article via visual matching.

Character errors: Two minor errors — one hyphenation artifact at a column break, one character substitution in a proper noun. Body text otherwise accurate.

**Rating: 3.5/5**

---

### Page 7 — Sports / Features

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9733 |
| YOLO detections | 55 total, 2 kept |
| Gemini tokens | 4,485 prompt / 2,164 candidates |
| Articles | 4 |
| Ads | 1 |
| Processing time | 86.4s |

Content: Sports results, feature articles, and one ad. Highest Gemini token output in this edition. Two proper noun corrections applied (Chi Phi → Phi Psi, Pi Phi → Phi Psi) — these may be incorrect corrections where different Greek organizations were normalized to one name. Slowest page in Input A (86.4s) due to high Gemini processing time (74.8s).

Character errors: Three errors including a garbled line at a column boundary and two character substitutions. The proper noun "corrections" for Greek organization names may themselves be errors — the pipeline incorrectly merged distinct fraternity/sorority names.

**Rating: 3/5**

---

### Page 8 — Back Page / Sports

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9685 |
| YOLO detections | 1 total, 0 kept (filtered by area) |
| Gemini tokens | 4,371 prompt / 1,843 candidates |
| Articles | 2 |
| Ads | 0 |
| Processing time | 49.9s |

Content: Back-page sports coverage. Lowest DocAI confidence in this edition but still very high. One YOLO detection filtered as too large. No images saved.

Character errors: Three errors — scattered character substitutions in sports statistics and one byline rendering issue. Content comprehensible despite errors.

**Rating: 3.5/5**

---

### Input A Merge Pass

| Metric | Value |
|--------|-------|
| Articles before merge | 28 |
| Articles after merge | 27 |
| Multi-article groups merged | 1 |
| Singleton groups | 26 |
| Unreferenced articles | 11 |
| Image orphans dropped | 8 |
| Merge time | 44.1s |

One cross-page article was successfully merged (shanty protest story from pages 1→3). Eleven articles had no continuation references (normal for self-contained pieces). Eight image orphans were dropped during merge consolidation.

---

## 5. Page-by-Page Findings — Input B (1992-05-01)

### Page 1 — Front Page

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9764 |
| YOLO detections | 39 total, 1 kept |
| Gemini tokens | 3,942 prompt / 1,688 candidates |
| Articles | 4 |
| Ads | 0 |
| Processing time | 54.7s |

Content: Front page with headlines including "Campus Paper Receives Letter From Holocaust Revisionist" (continues to p.12), "Condom Policy Challenged by Student Govt." (continues to p.14), a news summary section, and "Running for President" with photo. One image region detected and matched to the presidential-run article via visual matching.

Character errors: None detected. Clean front-page extraction.

**Rating: 5/5**

---

### Page 2 — CRITICAL FAILURE

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9707 |
| YOLO detections | 46 total, 3 kept |
| Gemini tokens | 4,474 prompt / **null** candidates |
| Articles | **0** |
| Ads | **0** |
| Processing time | 21.2s |

**CRITICAL:** DocAI successfully extracted text (4,474 prompt tokens generated, confidence 0.9707) and YOLO detected 3 image regions, but Gemini returned **null candidates**. The total_tokens field reads 4,474 (prompt only, zero output). No page number was extracted (empty string). No articles, no ads, no content of any kind was captured. No error was recorded in the diagnostics. Visual matching was not attempted because there were zero articles to match against.

The page was silently classified as "blocked or empty" despite containing a full page of newspaper content. Estimated content loss: 2–4 articles and 2–3 ads.

**Root cause:** Gemini API returned no structured response. The pipeline has no retry logic and no fallback for this failure mode.

**Rating: 0/5**

---

### Page 3 — Advertisements

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9056 |
| YOLO detections | 7 total, 2 kept |
| Gemini tokens | 3,104 prompt / 777 candidates |
| Articles | 0 |
| Ads | 1 |
| Processing time | 41.8s |

Content: Advertisement page featuring "The Branding Iron Restaurant" with a map and cattle brand symbols. Lowest DocAI confidence of any page in either edition (0.9056) — likely due to the ornamental/symbolic content rather than standard text.

Character errors: Severe garbling in cattle brand legend. OCR produced Cyrillic characters mixed with English text when reading ornamental brand symbols (e.g., "Մ FLYING-U" with Armenian capital letter). The main restaurant ad text (name, address, hours) was captured correctly, but the decorative cattle-brand legend was substantially corrupted.

**Rating: 2/5**

---

### Page 4 — Opinion / Editorial

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9669 |
| YOLO detections | 34 total, 2 kept |
| Gemini tokens | 3,893 prompt / 1,616 candidates |
| Articles | 4 (editorial, letter, masthead, opinion header) |
| Ads | 0 |
| Processing time | 83.4s |

Content: "Editorial: Going Forth..." on social responsibility, an editorial cartoon, "Condoms Available Through Professor Challenging Ban" (letter by Daniel E. Anderson), masthead with editorial staff, and a Letter Policy section. Two image regions: editorial cartoon matched to article, opinion header classified as standalone.

Character errors: Editorial cartoon caption garbled with Cyrillic character substitution (handwritten text read as "дома дет off The hard stuff"). One spacing artifact ("societ A" instead of "society. A") at a line break. Core editorial and letter body text clean.

**Rating: 3.5/5**

---

### Page 5 — Features / Letters

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9765 |
| YOLO detections | 43 total, 1 kept |
| Gemini tokens | 4,568 prompt / 2,132 candidates |
| Articles | 3 |
| Ads | 0 |
| Processing time | 111.5s |

Content: "Perilous Paper Writing in the Computer Jungle" (humorous feature by Ted Jendrysik), bell tower cartoon, and "Student Call: Drink, But Drink in Moderation" (letter by Jon Savitch). Highest Gemini token output for a single page across both editions (18,660 total). One image matched to cartoon.

Character errors: One minor caption error ("HAVET FOR YEARS" instead of "HAVEN'T FOR YEARS"). Body text excellent — unusual proper nouns like "Beeghly" correctly recognized. Slowest single-page processing in Input B (111.5s) due to Gemini time (101.1s).

**Rating: 4.5/5**

---

### Page 6 — CRITICAL FAILURE

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9778 |
| YOLO detections | 49 total, 1 kept |
| Gemini tokens | 4,649 prompt / **null** candidates |
| Articles | **0** |
| Ads | **0** |
| Processing time | 99.6s |

**CRITICAL:** Identical failure pattern to Page 2. DocAI extracted text successfully (4,649 prompt tokens, confidence 0.9778 — the second-highest in the entire edition). YOLO detected 1 image region. Gemini returned null candidates. Total_tokens reads 16,486 but candidates_tokens is null. No page number extracted. Zero articles and ads captured. No error recorded.

Notable difference from Page 2: this page consumed 99.6s of processing time (vs. 21.2s for Page 2), suggesting the Gemini call may have timed out rather than returning immediately empty. The total_tokens of 16,486 is anomalous — significantly higher than the 4,649 prompt tokens, suggesting partial processing occurred before failure.

**Rating: 0/5**

---

### Page 7 — Graduation Section

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9727 |
| YOLO detections | 43 total, 3 kept |
| Gemini tokens | 4,149 prompt / 1,741 candidates |
| Articles | 3 |
| Ads | 2 |
| Processing time | 110.0s |

Content: "1992 GRADUATION" section with "Senior Anxiety: The Real World of the Job Market" (continues to p.8, by Hannah Moorhead), "The Year in Review from the WCSA leaders" (continues to p.9, by Dan Sellers & Ted Cosgrove), graduation schedule, and ads (Delaware Cable TV, Parker's Mens Wear). Three images detected; two matched to ads, one standalone (graduation header graphic).

Character errors: One line-break artifact ("mar-respectively. od bluorie esti") — appears to be a garbled fragment at a merge boundary. Otherwise clean extraction.

**Rating: 4/5**

---

### Page 8 — Graduation Features

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9766 |
| YOLO detections | 39 total, 1 kept |
| Gemini tokens | 4,138 prompt / 1,662 candidates |
| Articles | 2 |
| Ads | 1 |
| Processing time | 56.1s |

Content: "Senior Reflections on Lessons Learned" (by John Wareck), continuation of Senior Anxiety article, and Toyota ad for college graduates. One image detected and matched to ad via visual matching.

Character errors: None detected. Philosophical reflection content with complex vocabulary captured accurately.

**Rating: 5/5**

---

### Page 9 — Graduation & Poetry

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9720 |
| YOLO detections | 45 total, 5 kept |
| Gemini tokens | 3,742 prompt / 1,548 candidates |
| Articles | 2 |
| Ads | 2 |
| Processing time | 75.8s |

Content: Poem "Re: N.V.P. 1992" by William Judd about Norman Vincent Peale (commencement speaker), continuation of WCSA Year in Review, photo of Peale, and ads (Delaware Hotel, Delaware Ford). Highest YOLO region count (5 kept) in either edition. One article image matched; four ad images matched.

Character errors: None significant. Poem structure and line breaks preserved correctly.

**Rating: 4.5/5**

---

### Page 10 — Advertisements

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9523 |
| YOLO detections | 6 total, 0 kept (all filtered by class) |
| Gemini tokens | 2,855 prompt / 347 candidates |
| Articles | 0 |
| Ads | 1 |
| Processing time | 17.2s |

Content: Full-page Ryder truck rental advertisement with discount coupon. Lowest DocAI confidence in Input B (0.9523) and lowest Gemini output (347 candidates tokens). No YOLO regions kept — all 6 detections filtered by class (not figure/photo). Fastest page in Input B (17.2s).

Character errors: One typo — "vahd" instead of "valid" in coupon text. Ad is otherwise readable.

**Rating: 3/5**

---

### Page 11 — Sesquicentennial Photo Essay

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9741 |
| YOLO detections | 15 total, 4 kept |
| Gemini tokens | 2,845 prompt / 498 candidates |
| Articles | 2 |
| Ads | 0 |
| Processing time | 56.2s |

Content: Photo essay of 150th anniversary events — "Pigging Out" (roasted pig), "Stickmen" (Ugly Stick band), "Exploring Sex" (debate), and 150th anniversary logo. Four photos detected; three matched to the photo essay article, one standalone (logo).

Character errors: Minor spacing issue in photo caption names ("Clowdus Ed" should be "Clowdus, Ed" — missing comma). Photo credits properly attributed. Proper nouns like "Alysha Biehl" captured correctly.

**Rating: 4.5/5**

---

### Page 12 — News Continuations

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9691 |
| YOLO detections | 45 total, 2 kept |
| Gemini tokens | 4,746 prompt / 2,450 candidates |
| Articles | 4 |
| Ads | 3 |
| Processing time | 55.1s |

Content: Continuation stories (Provost coverage of G. William Benz, Holocaust Revisionist letter), "University Salaries Increase," "Director of OWU Counseling Loses Job" (Scott Donaldson), and ads (The Outer Layer, Patty's Deli, Bargar Jewelry). Two images detected, both matched to ads.

Character errors: One proper noun error — "Yogt" instead of "Vogt." Otherwise clean multi-article page.

**Rating: 4/5**

---

### Page 13 — Arts Section

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9745 |
| YOLO detections | 25 total, 2 kept |
| Gemini tokens | 3,800 prompt / 1,266 candidates |
| Articles | 2 |
| Ads | 1 |
| Processing time | 54.1s |

Content: "An Eyewitness History of the CoffeeHouse" (detailed institutional history by Melanie Bleveans), arts section header graphic, and The Brown Jug Restaurant ad. Two images: one matched to ad, one standalone (section header).

Character errors: One character error — "Qur featured" instead of "Our featured." Complex history article with many proper names (David Yasenchek, David Miller, John Burnside, Mark Parsons, BancOhio) all captured correctly.

**Rating: 4.5/5**

---

### Page 14 — Health / Features & Ads

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9750 |
| YOLO detections | 52 total, 2 kept |
| Gemini tokens | 4,455 prompt / 2,017 candidates |
| Articles | 2 |
| Ads | 4 |
| Processing time | 146.9s |

Content: "Shaping Up With The Sunway" (health column on sun exposure by Sean Scheiderer), condom policy story continuation, and ads (Dick's Auto Repair, Carroll's Jewelers, Rare Earth, Heartland Cafe & Grille). Two images matched to ads. Slowest overall page in either edition (146.9s) — Gemini processing took 122.1s.

Character errors: Two notable issues. First, a text duplication artifact where the phrase "ly, their price can be devastating." appears twice consecutively. Second, ad name misread: "TEARTLAN CAFE & GRILLE" instead of "HEARTLAND CAFE & GRILLE" (missing "HEA"). Technical health content (SPF ratings, UV protection) captured accurately.

**Rating: 3.5/5**

---

### Page 15 — Sports

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9650 |
| YOLO detections | 46 total, 1 kept |
| Gemini tokens | 4,073 prompt / 1,740 candidates |
| Articles | 2 |
| Ads | 2 |
| Processing time | 61.3s |

Content: "Sports Shorts" (women's/men's track, tennis results), "Golfers Finish Regular Season 2nd in the Nation" (by Galen Eckland), This Week's Events schedule, graduating staff acknowledgments, and ads (The Grandstand, Gray's Birkenstock). One image matched to golf article photo.

Character errors: None significant. Sports statistics, athlete names, and scores captured accurately. "Division III," "NCAC," "NCAA" all correctly recognized.

**Rating: 4.5/5**

---

### Page 16 — Back Page Sports

| Metric | Value |
|--------|-------|
| DocAI confidence | 0.9795 |
| YOLO detections | 39 total, 3 kept |
| Gemini tokens | 4,121 prompt / 2,111 candidates |
| Articles | 3 |
| Ads | 1 |
| Processing time | 41.5s |

Content: "OWU Baseball Takes Four From Denison" (by Jennifer Small), baseball team photo with coach Roger Ingles, "Sports Shorts" continuation (Mark Beckenbach), "Heads Up — Athlete of the Week" (Allison Plowman), and Heads Up Styling Salon ad. Three images: two matched to articles, one to ad. Highest DocAI confidence across both editions (0.9795).

Character errors: None detected. Complex baseball box-score data with multiple game scores (7-3, 8-7, 12-2, 6-5, etc.) and many player names all captured accurately. Two proper noun corrections applied for newline artifacts (Greg\nJustice → Greg Justice, Ohio\nWesleyan → Ohio Wesleyan).

**Rating: 5/5**

---

### Input B Merge Pass

| Metric | Value |
|--------|-------|
| Articles before merge | 33 |
| Articles after merge | 26 |
| Multi-article groups merged | 6 |
| Singleton groups | 21 |
| Unreferenced articles | 3 |
| Image orphans dropped | 8 |
| Empty articles removed | 1 |
| Merge time | 94.9s |

Six cross-page article groups were successfully merged (significantly more than Input A's single merge group), reflecting the longer edition's heavier use of continuation stories. One empty article was removed during merge. Three unreferenced articles remained (far fewer than Input A's 11, proportionally better).

---

## 6. Problem Catalog

### CRITICAL: Gemini Silent Failure (Pages 2 and 6, Input B)

**Severity:** Critical
**Frequency:** 2 of 24 total pages (8.3%)
**Impact:** Complete content loss for affected pages

Gemini's structuring API call can return null candidates without recording any error. When this happens, the entire page is treated as empty — zero articles, zero ads, no page number extracted. The pipeline does not retry, does not trigger chunked fallback, and does not log a warning. DocAI extraction and YOLO detection complete successfully, but their output is discarded.

Diagnostic signature:
- `gemini_tokens.candidates_tokens: null`
- `page_number: ""`
- `final_article_count: 0`, `final_ad_count: 0`
- `error: ""`

**Recommendation:** Implement retry logic (2–3 attempts with exponential backoff) when Gemini returns null candidates. If retries fail, trigger the existing chunked fallback path. Log a warning in the issue report. Consider storing the raw DocAI text so failed pages can be reprocessed without re-running the full pipeline.

---

### MODERATE: Cyrillic Character Substitution in Handwritten/Symbolic Content

**Severity:** Moderate
**Frequency:** 2–3 pages per edition where handwritten or ornamental text appears
**Impact:** Partial corruption of captions, cartoon text, and decorative elements

When DocAI encounters handwritten text (editorial cartoon captions) or ornamental symbols (cattle brand icons), it occasionally substitutes Cyrillic or Armenian characters for Latin ones. Examples: "дома дет" in an English cartoon caption (Input B, p.4), Armenian "Մ" in a cattle brand legend (Input B, p.3).

**Recommendation:** Post-process OCR text to detect and strip non-Latin characters when the source newspaper is known to be English-only. Flag pages with >5% non-Latin characters for manual review.

---

### MODERATE: Proper Noun Over-Correction (Input A, Page 7)

**Severity:** Moderate
**Frequency:** Isolated but impactful
**Impact:** Distinct entities merged into one

The proper noun correction system incorrectly normalized "Chi Phi" and "Pi Phi" (distinct Greek organizations) to "Phi Psi" based on edit distance. The correction system treats names within edit distance ≤ 2 as variants of the same entity, which fails when multiple similar-but-distinct proper nouns appear on the same page.

**Recommendation:** Increase the edit distance threshold strictness for short names (≤ 8 characters), or require exact substring match rather than edit distance for Greek organization names.

---

### LOW: Column-Break Line Artifacts

**Severity:** Low
**Frequency:** ~3–4 instances per edition
**Impact:** Minor readability issues

Text spanning column breaks occasionally produces garbled fragments. Examples: "mar-respectively. od bluorie esti" (Input B, p.7), "to societ A frequently-heard" (Input B, p.4). These appear where Gemini struggles to reconstruct text flow across column boundaries.

**Recommendation:** Add a post-processing pass that detects fragments shorter than 5 words that don't form valid English sequences and either removes them or flags them for review.

---

### LOW: Text Duplication Artifacts

**Severity:** Low
**Frequency:** 1 instance observed (Input B, p.14)
**Impact:** Repeated sentence fragment in article body

A clause was duplicated verbatim ("ly, their price can be devastating."), likely from overlapping text segments in the DocAI extraction that weren't caught by deduplication.

**Recommendation:** Extend the existing dedup_info pass to check for verbatim substring repetition within individual articles, not just across articles.

---

### LOW: Ad Name Misreading

**Severity:** Low
**Frequency:** 1 instance observed (Input B, p.14)
**Impact:** Business name partially corrupted

"HEARTLAND CAFE & GRILLE" was read as "TEARTLAN CAFE & GRILLE." This appears to be a combined OCR + restructuring error where the capital "H" and "EA" were dropped and remaining letters rearranged.

**Recommendation:** Cross-reference extracted ad business names against any available ad enrichment database during Phase 4. Alternatively, apply spell-checking to ad headlines.

---

## 7. Input Comparison

| Metric | Input A (1988-10-12) | Input B (1992-05-01) |
|--------|----------------------|----------------------|
| Pages | 8 | 16 |
| Pages successfully processed | 8 (100%) | 14 (87.5%) |
| Total articles | 27 | 26 |
| Total ads | 19 | 18 |
| Articles seeded to DB | 25 | 22 |
| Articles filtered at seed | 2 | 4 |
| Total processing time | 702.6s | 1,524.0s |
| Time per page (avg) | 87.8s | 95.2s |
| Total prompt tokens | 49,721 | 95,747 |
| Total candidates tokens | 15,327 | 24,159 |
| DocAI mean confidence (avg) | 0.9719 | 0.9708 |
| Highest page confidence | 0.9748 (p.2) | 0.9795 (p.16) |
| Lowest page confidence | 0.9685 (p.8) | 0.9056 (p.3) |
| YOLO regions kept (total) | 12 | 31 |
| Images saved | 10 | 28 |
| Cross-page merges | 1 | 6 |
| Image orphans dropped | 8 | 8 |
| Proper noun corrections | 4 | 2 |
| Gemini silent failures | 0 | 2 |
| Pages rated 5/5 | 1 | 4 |
| Pages rated 0/5 | 0 | 2 |
| Overall accuracy | 3.5/5 | 3.5/5 |

**Key differences:**

Input B's 16-page format exposed the Gemini silent failure bug that Input A's 8 pages did not trigger. With more pages, Input B had proportionally more cross-page merges (6 vs 1), demonstrating the merge system handles multi-part stories well. Input B also had more YOLO image detections (31 vs 12), reflecting its photo-heavy content (sesquicentennial essay, graduation coverage). Processing time scaled roughly linearly with page count (2.17x pages → 2.17x time).

Both editions achieved identical overall accuracy ratings (3.5/5), but for different reasons: Input A was consistently decent across all pages (range 2.5–5), while Input B was polarized between excellent pages and total failures (range 0–5).

---

## 8. Recommended Improvements

### Priority 1 — Gemini Failure Recovery (Critical)

Implement retry logic when `candidates_tokens` is null. Two to three retries with exponential backoff (2s, 4s, 8s) before falling through to the existing chunked fallback path. Log every retry attempt and final failure in the issue report. Store raw DocAI text to a recovery file so failed pages can be reprocessed independently.

### Priority 2 — Non-Latin Character Filtering (Moderate)

Add a post-processing pass that detects and removes non-Latin Unicode characters (Cyrillic, Armenian, etc.) from English-language newspapers. This should run after Gemini structuring but before the final JSON export. Pages exceeding a non-Latin character threshold (e.g., >2%) should be flagged in the issue report.

### Priority 3 — Proper Noun Correction Guards (Moderate)

Tighten the proper noun correction heuristic for short names. Require edit distance ≤ 1 (not ≤ 2) for names under 8 characters to prevent merging distinct Greek organizations or similarly-named entities. Consider maintaining a known-entities list per edition for repeated proper nouns.

### Priority 4 — Column-Break Fragment Detection (Low)

Add a post-processing step that identifies sentence fragments shorter than 5 words that don't parse as valid English. These artifacts typically occur at column boundaries and can be either removed or flagged for review.

### Priority 5 — Intra-Article Dedup (Low)

Extend deduplication to check for verbatim repeated substrings within a single article's body text, not just across articles. A sliding-window comparison of 10+ word sequences would catch the duplication artifacts observed.

### Priority 6 — Issue Report Population (Low)

The issue_report.json was empty for both editions despite the critical Gemini failures in Input B. The diagnostics system should automatically flag pages with null candidates_tokens, pages with zero articles extracted, and pages with non-Latin character contamination.

---

## 9. Raw Data Summary

### Input A — Per-Page Diagnostics

| Page | DocAI Conf | YOLO Kept | Gemini Prompt | Gemini Cand | Articles | Ads | Time (s) | Rating |
|------|-----------|-----------|---------------|-------------|----------|-----|----------|--------|
| 1 | 0.9743 | 0 | 3,822 | 1,469 | 3 | 0 | 40.0 | 4/5 |
| 2 | 0.9748 | 1 | 4,257 | 1,991 | 3 | 4 | 61.0 | 4/5 |
| 3 | 0.9734 | 3 | 3,663 | 1,505 | 3 | 5 | 32.7 | 4/5 |
| 4 | 0.9711 | 3 | 3,612 | 1,436 | 7 | 0 | 61.3 | 2.5/5 |
| 5 | 0.9704 | 2 | 3,652 | 1,601 | 3 | 6 | 62.8 | 5/5 |
| 6 | 0.9695 | 1 | 3,906 | 1,670 | 3 | 3 | 60.7 | 3.5/5 |
| 7 | 0.9733 | 2 | 4,485 | 2,164 | 4 | 1 | 86.4 | 3/5 |
| 8 | 0.9685 | 0 | 4,371 | 1,843 | 2 | 0 | 49.9 | 3.5/5 |
| **Σ** | **0.9719 avg** | **12** | **31,768** | **13,679** | **28→27** | **19** | **454.8** | **3.5/5** |

### Input B — Per-Page Diagnostics

| Page | DocAI Conf | YOLO Kept | Gemini Prompt | Gemini Cand | Articles | Ads | Time (s) | Rating |
|------|-----------|-----------|---------------|-------------|----------|-----|----------|--------|
| 1 | 0.9764 | 1 | 3,942 | 1,688 | 4 | 0 | 54.7 | 5/5 |
| 2 | 0.9707 | 3 | 4,474 | **null** | **0** | **0** | 21.2 | **0/5** |
| 3 | 0.9056 | 2 | 3,104 | 777 | 0 | 1 | 41.8 | 2/5 |
| 4 | 0.9669 | 2 | 3,893 | 1,616 | 4 | 0 | 83.4 | 3.5/5 |
| 5 | 0.9765 | 1 | 4,568 | 2,132 | 3 | 0 | 111.5 | 4.5/5 |
| 6 | 0.9778 | 1 | 4,649 | **null** | **0** | **0** | 99.6 | **0/5** |
| 7 | 0.9727 | 3 | 4,149 | 1,741 | 3 | 2 | 110.0 | 4/5 |
| 8 | 0.9766 | 1 | 4,138 | 1,662 | 2 | 1 | 56.1 | 5/5 |
| 9 | 0.9720 | 5 | 3,742 | 1,548 | 2 | 2 | 75.8 | 4.5/5 |
| 10 | 0.9523 | 0 | 2,855 | 347 | 0 | 1 | 17.2 | 3/5 |
| 11 | 0.9741 | 4 | 2,845 | 498 | 2 | 0 | 56.2 | 4.5/5 |
| 12 | 0.9691 | 2 | 4,746 | 2,450 | 4 | 3 | 55.1 | 4/5 |
| 13 | 0.9745 | 2 | 3,800 | 1,266 | 2 | 1 | 54.1 | 4.5/5 |
| 14 | 0.9750 | 2 | 4,455 | 2,017 | 2 | 4 | 146.9 | 3.5/5 |
| 15 | 0.9650 | 1 | 4,073 | 1,740 | 2 | 2 | 61.3 | 4.5/5 |
| 16 | 0.9795 | 3 | 4,121 | 2,111 | 3 | 1 | 41.5 | 5/5 |
| **Σ** | **0.9708 avg** | **33** | **63,554** | **21,593** | **33→26** | **18** | **1,086.5** | **3.5/5** |

### Token Usage Summary

| Metric | Input A | Input B | Total |
|--------|---------|---------|-------|
| Total prompt tokens | 49,721 | 95,747 | 145,468 |
| Total candidates tokens | 15,327 | 24,159 | 39,486 |
| Merge prompt tokens | 5,208 | 7,361 | 12,569 |
| Merge candidates tokens | 1,060 | 1,378 | 2,438 |
| Grand total tokens | — | — | ~200,000 |

---

*End of audit report.*
