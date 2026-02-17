# OCR Pipeline Validation: 1960-02-24 Ohio Wesleyan Transcript

## Summary

| Metric | Value |
|--------|-------|
| Articles extracted | 51 |
| Ads extracted | 54 (includes ~4 duplicate placements) |
| Other content items | 9 |
| Pages processed | 12/12 (all succeeded) |
| Pipeline duration | 16.7 minutes |
| Total tokens | ~180K (prompt: 31K, candidates: 28K, visual matching + merge: rest) |
| Chunked fallback used | 0 pages |
| Overall accuracy grade | **B+** |

## Pre-Run Code Fixes Applied

| # | Issue | Fix |
|---|-------|-----|
| P1 | `enrich_ads.py:67` — ad prompt hard-coded "a 1980s college newspaper" | Changed to `"a historical college newspaper"` |
| P2 | `convert_scans.py:1476` — no `max_output_tokens` on merge call | Added `max_output_tokens=8192` |
| P3 | `convert_scans.py:1445` — merge body preview only 200 chars | Increased to 400 chars for better topic-continuity detection |
| P4 | `enrich_articles.py` — `max_output_tokens` too low for 51 articles | Increased to prevent truncation (discovered during pipeline run) |

## Diagnostics Overview

- **Chunked fallback pages**: None (all 12 pages processed in single pass)
- **Visual matching fallbacks**: None (all visual matching succeeded, no spatial fallback)
- **Dedup merges**: 0 overlapping pairs merged across all pages
- **Cross-page merge**: 55 articles → 51 (4 groups: 2 cross-page, 2 same-page)
- **Proper noun warnings**: 2 — Pat Latin/Pat Martin (dist 2), Sue Bode/Sue Dodge (dist 2)
- **Proper noun corrections**: 0 applied
- **Ad reclassifications**: 0
- **Page number misdetections**: 3 pages — Page 2→"1", Page 5→"null", Page 11→"10"

## Per-Page Findings

### Page 1 — Grade: B+

- **Articles**: 6 visible / 6 extracted (correct). However, 5 additional articles from page 2 are misattributed to page 1 due to page 2's number being misdetected as "1".
- **Headlines**: All 6 captured verbatim. "3-Way Fight Shaping For Presidency," "AWS Vote Set Thursday," "1960 Bijou Queen Pick Slated Greek Week End," "Greek Heads Will Hear Rush Plan," "Artist Series Finale Offers Szell, Cleveland Symphony," "IPP Will Stay; New Director Being Sought."
- **Body accuracy**: Excellent. All candidate names, statistics, and facts verified correct.
- **Bylines**: "By Ray Esch" and "By Pat Hanna / Transcript Staff" found embedded in body text but NOT in the `byline` field.
- **Ads**: 0 visible / 0 extracted. Correct.
- **Images**: 5 saved (3 candidate headshots, 1 Forrester photo, 1 Armstrong group). 4/5 matched to articles; Armstrong photo correctly placed in `other_content`.
- **Other content**: "Chapel Slate" notice and Armstrong caption captured.
- **Issues**: Byline fields empty; image paths empty strings in article objects despite files on disk.

### Page 2 — Grade: B+

- **Articles**: 5 visible / 5 extracted (correct count)
- **Headlines**: "Council OK's Phone Plan," "Drill Team Places Third At Purdue," "Special Meeting To Talk Grades," "Testing Policy Change Sought," "Pi Sigma Alpha Inducts Seven" — all verbatim.
- **Body accuracy**: Spot-checked 2 articles — accurate opening paragraphs, correct names and facts.
- **Ads**: 6 visible / 6 extracted (Snyder's, Rambler, O'Brien Olds, Stairs, Vallette, Mar-De).
- **Issues**: **Page number misdetected as "1"** — all 5 articles incorrectly attributed to page 1 in `edition.json`. This is the most impactful page-numbering error since it doubles the apparent page 1 article count.

### Page 3 — Grade: A-

- **Articles**: 5 visible / 5 extracted
- **Headlines**: All correct. "Board Invites Applications," "MSM Elects Officers," "Bookstore Checks," "1960 Campaign To Be Hashed," "Faculty Series Presents Hladky."
- **Body accuracy**: Good. Minor OCR typos: "Misic" for "Music," "Rochestra" for "Rochester."
- **Ads**: 4 visible / 4 extracted (Foster's, Casa-Bianca, Brown Jug, Winston).
- **Issues**: Minor name inconsistency in photo caption (hallucinated "Mike Whitehouse" vs body text's "Steve Whitehead").

### Page 4 — Grade: A-

- **Articles**: 3 visible / 3 extracted (editorial page)
- **Headlines**: "Comprehensive Exam Trial Badly Planned," "Possible Honor System Involves Many Factors," "Hits Reviewing" — all correct.
- **Body accuracy**: Accurate. Staff box/masthead correctly captured (editor Bill Darrow, etc.). "Hits Reviewing" letter correctly marked as continuing to next page.
- **Ads**: 0 visible / 0 extracted. Correct.
- **Issues**: Minor: "the report is draw up" (likely "drawn up") — could be OCR error or original typo.

### Page 5 — Grade: B

- **Articles**: 5 visible / 5 extracted
- **Headlines**: "Informal Benefits Of Meeting Hailed," "Hits Reviewing" (continuation), "Test Explained," "THREE WHO PASSED IN THE NIGHT," "Brotherhood Week."
- **Body accuracy**: Accurate. Max Shulman syndicated humor column fully captured including Marlboro advertising tagline.
- **Ads**: 3 classified ads visible / 3 extracted (Volkswagen, Garber Rubber Stamp, Transcript rates).
- **Issues**: **Page number detection failed ("null")**. All 5 articles have `source_pages: ["null"]`. Articles contain literal `\n` escape sequences instead of actual newlines. "On Campus with Max Shulman" column header not captured.

### Page 6 — Grade: A

- **Articles**: 5 visible / 5 extracted
- **Headlines**: "OWU Staff Policies To Be Altered," "OWU Hosts Ohio MSM," "OWU Entertains 45 5-College Delegates," "Stendhal's Novel Suffers From Movie Adaptation," "Staff Replacements."
- **Body accuracy**: Excellent. Byline "By Connie McNeil Guest Reviewer" captured in body.
- **Ads**: 6 visible / 6 extracted (Gateway, Gibson Flowers, Safety PSA, Angus, Wally's Pizza, U.S. Air Force).
- **Issues**: Very minor: "hyocrite" should be "hypocrite."

### Page 7 — Grade: A-

- **Articles**: 6 visible / 6 extracted
- **Headlines**: "Two Replace Absent Profs," "Faculty Art On Display," "Phys Ed Upheld," "70 Attend Phi Upsilon Banquet," "Cupid's Classroom," "Summer Grant Bids Due Soon."
- **Body accuracy**: Accurate. Cupid's Classroom pinning/engagement list correct.
- **Ads**: 6 visible / 6 extracted (Independent Print, Whetsel Bros, Candy Box, Farmhouse, Little Shop, Delaware Hardware).
- **Issues**: Delaware Hardware ad slightly truncated (missing "Furniture Polish — Window Cleaners" line).

### Page 8 — Grade: A-

- **Articles**: 4 visible / 4 extracted
- **Headlines**: "Yugoslav Governmental Structure Described," "135 Hear Sears' Darwin Speech," "Rosh Doan Selected as 1960 Ambassador," "Summer Grants Available."
- **Body accuracy**: Good. Minor OCR typos: "Setpember" (September), "Bristish" (British), "Reserach" (Research).
- **Ads**: 4 visible / 4 extracted (Marten Electronics, Ginn's, Hamburger Inn, Tareyton).
- **Issues**: Scattered minor typos only.

### Page 9 — Grade: A

- **Articles**: 1 long article + tournament bracket
- **Headlines**: "Bishops Knock Off Heidelberg, 88-73; Prepare For Otterbein In OC Tourney" — verbatim.
- **Body accuracy**: Excellent. Detailed game account with correct scores, player names, and the "Unusual Call" anecdote about jersey numbers fully captured.
- **Ads**: 5 visible / 5 extracted (Rip's Drive In, Deerlick Dairy, Westinghouse Laundromat, Keefer Chevrolet, Peoples Store).
- **Issues**: "Best Hamburger in Town" tagline for Rip's Drive In not captured (very minor).

### Page 10 — Grade: B+

- **Articles**: 8 visible / 7 in per-page markdown (8 in edition.json counting merged content)
- **Headlines**: "IPP Misses In Kennedy, Nixon Try," "Honor Air Group Initiates 8 Cadets," "OWU Joins Oberlin Plan," etc. — all correct.
- **Body accuracy**: Good. Swimming article continuation from page 11 present but structural heading missing in markdown.
- **Ads**: 7 visible / 7 extracted (Eddie's Shoe Repair, New Method's, Smith-Wood/Goodyear, Private Camps, Strand Theatre, Frisch's, Cap's Barber Shop).
- **Issues**: Minor typo "indvidual" (individual). "Winter IM Playoffs" not visible as separate markdown section.

### Page 11 — Grade: C+

- **Articles**: 3 visible / 3 extracted (but all misattributed to page "10" due to misdetection)
- **Headlines**: "OC Lead Will Be Prize Of Kenyon Meet Today," "Winter IM Playoffs," "'Brown Jug' Founder Dies" — correct.
- **Body accuracy**: **SIGNIFICANT ISSUES** with "OC Lead" article:
  - Body is fully duplicated (~5,098 chars, text appears twice)
  - First copy has garbled text: "Waterfield, indvidual medley" should be "Jim Brown, OWU record-holder in the 200-yard individual medley"
  - Contains `[illegible]` marker
  - "'Brown Jug' Founder Dies" obituary is also fully duplicated (identical 2-paragraph text printed twice)
- **Ads**: 6 visible / 6 extracted (Surrey Lounge, Smith-Wood, Private Camps, Strand, Frisch's, Cap's).
- **Issues**: **Page number misdetected as "10"** (collides with real page 10). Body duplication in 2 articles due to same-page merge concatenating instead of de-duplicating. Basketball standings tables correctly in `other_content`.

### Page 12 — Grade: B+

- **Articles**: 5 visible / 5 extracted
- **Headlines**: "Press Box" (column), "Hiram Nips OWU," "All-Ohio Meet Sat. In Columbus," "Gutknecht Runs Best," "Robin Farran Athlete of the Week" — all correct.
- **Body accuracy**: Good. Pop culture references in Press Box column (teen-angel, Eliot Ness, Jack Paar) all captured. Wrestling score 22-6 in body text vs 22-8 in photo caption — both match the original newspaper (inconsistency in source).
- **Ads**: 8 visible / 8 extracted (Use The Products, Wilson's C.J., Valley Dale, Humphries, Marino's, Hertz, Martinizing, Overture and Combs).
- **Issues**: Byline "By Rog Lockwood / Transcript Columnist" not in byline field. Press Box portrait has empty caption.

## Grade Summary

| Page | Grade | Articles (Scan/OCR) | Ads (Scan/OCR) | Key Issue |
|------|-------|---------------------|-----------------|-----------|
| 1 | B+ | 6/6 | 0/0 | 5 misattributed articles from page 2 |
| 2 | B+ | 5/5 | 6/6 | Page number misdetected as "1" |
| 3 | A- | 5/5 | 4/4 | Minor OCR typos, caption name mismatch |
| 4 | A- | 3/3 | 0/0 | Clean editorial page |
| 5 | B | 5/5 | 3/3 | Page number = "null"; literal \n in text |
| 6 | A | 5/5 | 6/6 | Near-perfect |
| 7 | A- | 6/6 | 6/6 | One ad slightly truncated |
| 8 | A- | 4/4 | 4/4 | Minor OCR typos |
| 9 | A | 1/1 + bracket | 5/5 | Excellent sports page |
| 10 | B+ | 8/7 in md | 7/7 | Structural heading missing |
| 11 | C+ | 3/3 | 6/6 | Page misdetected; 2 articles with duplicated body text |
| 12 | B+ | 5/5 | 8/8 | Bylines missing, otherwise clean |

## Cross-Page Merge Findings

### Merge Statistics

| Metric | Count |
|--------|-------|
| Total merge groups | 4 |
| Correct groupings | 4/4 |
| Clean join points | 0/4 |
| False positives | 0 |
| Missed merges | 0 |

### Multi-Page Article 1: "Greek Heads Will Hear Rush Plan" (pages 1 → 10)

- **Merge correct**: Yes. Page 1 ends mid-sentence ("handed out to each"), page 10 continuation completes it ("rushee so that he could...").
- **Join point**: Dirty — residual `( Page)` left from partial stripping of "(Continued on Back Page)". Should read "...handed out to each rushee..." seamlessly.
- **Continuation markers**: Partially stripped. Page 10's "(Continued from Page 1)" was removed; page 1's "(Continued on Back Page)" left as `( Page)`.

### Multi-Page Article 2: "Hits Reviewing" (pages 4 → null/5)

- **Merge correct**: Yes. Philip Diser letter continues coherently from page 4 to page 5.
- **Join point**: Dirty — empty `()` left where "(Continued on Next Page)" was. Also, page 5 text has literal `\n` escape sequences instead of real newlines.
- **Continuation markers**: Partially stripped. Page 5's "(Continued from Page 4)" removed; page 4's marker left as `()`.

### Same-Page Merges (pages 10/11 collision)

- **"OC Lead Will Be Prize Of Kenyon Meet Today"**: Correctly identified as same article from pages 10 and 11, BUT the merge concatenated both extractions resulting in **fully duplicated body text** (~5,098 chars, article appears twice). The page 10 extraction is inferior (missing lede, has `[illegible]` gaps); the page 11 extraction is complete. The merge should have used the better version rather than concatenating.
- **"'Brown Jug' Founder Dies"**: Same issue — both extractions are identical and were concatenated, producing the 2-paragraph obituary printed twice (610 chars total, should be ~305).

## Category Accuracy

- **Total correct**: 48/51 (94.1%)
- **Category distribution**: Campus Life (20), News (10), Sports (8), Opinion (7), Arts (3), Features (3)

### Misclassifications

| Index | Headline | Assigned | Should Be | Reason |
|-------|----------|----------|-----------|--------|
| 21 | "THREE WHO PASSED IN THE NIGHT" | Opinion | Features | Syndicated humor column by Max Shulman (Marlboro-sponsored entertainment), not editorial opinion |
| 26 | "Stendhal's Novel Suffers From Movie Adaptation" | Opinion | Arts | Film/book critical review by named reviewer, not an editorial stance on campus issues |
| 44 | "'Brown Jug' Founder Dies" | Features | News | Brief 2-paragraph obituary with no feature-style narrative; pure factual death notice |

## Ad Enrichment Accuracy

| Metric | Result |
|--------|--------|
| display_text accurate | 54/54 (100%) |
| category accurate | 54/54 (100%) |
| ad_type accurate | 54/54 (100%) — 53 display, 1 classified (Volkswagen student listing) |
| Phone numbers extracted | 14 total, 14 correct, 0 hallucinated |
| Addresses extracted | 34 total, 34 correct, 0 hallucinated |
| Prices extracted | 6 total, 6 correct, 0 hallucinated |
| Anachronistic content | None found (P1 fix verified effective) |

### Notable Ad Issues

- **Duplicate placements**: 4 ad pairs appear to be the same ad extracted from multiple pages — Ads 37/42 (Private Camps), 38/43 (Strand Theatre), 39/44 (Frisch's), 40/45 (Cap's Barber Shop). These inflate the ad count by ~4.
- **Price format inconsistency**: Ad 31 (Westinghouse Laundromat) has `price: "WASH 20c DRY 10c"` — functional but not normalized.

## Systemic Issues

### Critical (affects data quality)

1. **Page number misdetection** — 3 of 12 pages (25%) have wrong page numbers. Page 2→"1" (5 articles misattributed), Page 5→"null" (5 articles unindexable), Page 11→"10" (3 articles collide with page 10, causing merge duplication).

2. **Same-page merge produces duplicated text** — When two extractions of the same article from different physical scans share a detected page number, the merge pass concatenates them instead of de-duplicating. Affects 2 articles on page 11 with a combined ~5.7K chars of duplicate content.

3. **Continuation marker stripping is incomplete** — The regex/logic for removing "Continued on/from page X" markers leaves parenthetical remnants (`( Page)`, `()`). Affects at least 2 merged articles.

### Moderate (affects completeness)

4. **Byline field never populated** — All bylines detected by the OCR appear only in body text or markdown, not in the structured `byline` field. Affects all pages where bylines exist (at least pages 1, 4, 5, 7, 9, 12).

5. **Image paths empty in article objects** — `image_files` arrays contain empty strings despite 35 images being saved to disk. Visual matching records exist in diagnostics but the paths don't flow through to edition.json article objects.

6. **Literal `\n` in page 5 text** — All 5 articles from the "null" page contain literal backslash-n sequences instead of actual newline characters.

### Minor (cosmetic/edge cases)

7. **OCR typos** — Scattered across pages: "Misic/Music," "Rochestra/Rochester," "Setpember/September," "Bristish/British," "Reserach/Research," "indvidual/individual," "hyocrite/hypocrite." ~7 instances across 12 pages.

8. **Duplicate ad placements** — 4 ads extracted from both pages 10 and 11 appear twice in the ads array. The OCR pipeline doesn't deduplicate ads across pages.

9. **Caption inconsistency** — One photo caption hallucinated "Mike Whitehouse" where the article text says "Steve Whitehead" (page 3).

## Code-Level Recommendations

### Priority 1 — Page Number Detection

**Problem**: `convert_scans.py` page number extraction fails for 25% of pages.
**Recommendation**: Use the TIFF filename as a reliable fallback. Filenames follow the pattern `NNNN_Page N.tif` — parse the page number from the filename when Gemini's detection returns "null" or conflicts with the filename. This is a 5-line fix that would eliminate all 3 misdetections.

### Priority 2 — Same-Page Merge De-duplication

**Problem**: When two extractions share a page number (e.g., pages 10 and 11 both detected as "10"), the merge pass concatenates instead of de-duplicating.
**Recommendation**: Before concatenating merge group members, compute text similarity (e.g., sequence matcher ratio). If >70% similar, keep the longer/more complete version rather than concatenating. Also detect and remove `[illegible]` gaps when a clean version exists.

### Priority 3 — Continuation Marker Cleanup

**Problem**: Partial regex stripping leaves `( Page)` and `()` remnants.
**Recommendation**: After the existing continuation marker stripping, add a post-processing pass that removes empty or near-empty parenthetical expressions like `( Page)`, `(Page)`, `()`, `( )` from the body text.

### Priority 4 — Byline Extraction

**Problem**: Bylines are captured as body text but never populate the `byline` field.
**Recommendation**: Add a post-processing step that scans the first 2-3 lines of each article body for patterns like `By [Name]`, `By [Name] / [Title]`, `By [Name], [Title]` and moves them to the `byline` field.

### Priority 5 — Image Path Population

**Problem**: Images are saved to disk and matched in diagnostics, but `image_files` arrays contain empty strings.
**Recommendation**: After visual matching, populate each article's `image_files` array with the actual paths of matched images (e.g., `images/page1_region0.png`).

### Priority 6 — Literal Newline Fix

**Problem**: Page 5 articles contain `\n` as literal text.
**Recommendation**: Investigate why the "null" page produces literal escape sequences. Likely a JSON serialization issue in the per-page extraction step. Add a cleanup pass: `body = body.replace('\\n', '\n')`.

### Priority 7 — Category Prompt Refinement

**Problem**: 3 of 51 categories wrong (reviews classified as Opinion, obituary as Features).
**Recommendation**: Add explicit rules to the category prompt:
- "Film, book, music, and theater *reviews* are **Arts**, not Opinion"
- "Syndicated humor/entertainment columns are **Features**, not Opinion"
- "Obituaries and death notices without extended narrative are **News**, not Features"

### Priority 8 — Ad De-duplication

**Problem**: 4 ads appear twice (from pages 10 and 11).
**Recommendation**: After cross-page merge, run a simple text-similarity check on ads and deduplicate those with >80% overlap, keeping the better extraction.
