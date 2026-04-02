# Pipeline Reference: Phase-by-Phase Instructions

Detailed instructions for each phase of the OCR pipeline. Read `schema.md` first for the output contract.

---

## Phase 1 & 2: Preprocess + Detect (Script)

Run:
```bash
cd <project-root>
source ocr/.venv/bin/activate
python <skill-path>/scripts/preprocess.py <scan-folder> --output <working-dir>
```

**What the script does:**
1. Discovers all image files (TIF, TIFF, JPG, JPEG, PNG) in the scan folder
2. Sorts them by filename into page order
3. Checks quality: skips blank pages, warns on low-res or inverted scans
4. Preprocesses each page: EXIF transpose → grayscale → deskew → contrast boost → sharpen
5. Converts to JPG (for Claude viewing) and saves to `<working-dir>/pages/`
6. Runs YOLO detection on each preprocessed page to find image regions
7. Crops detected regions with 2% padding, saves to `<working-dir>/images/`
8. Writes `<working-dir>/detection_manifest.json`

**Detection manifest format:**
```json
{
  "pages": [
    {
      "page_number": "1",
      "page_file": "pages/0001_Page 1.jpg",
      "regions": [
        {
          "index": 0,
          "bbox": [y1, x1, y2, x2],
          "cropped_file": "images/0001_Page 1_img1.jpg"
        }
      ]
    }
  ],
  "total_pages": 12,
  "total_regions": 31,
  "skipped_pages": []
}
```

**Troubleshooting:**
- "YOLO model not found": The model auto-downloads from HuggingFace on first run. Ensure internet access.
- "No images found": Check that the scan folder contains files with supported extensions.
- "venv not found": Create it with `python -m venv ocr/.venv && pip install -r ocr/requirements.txt`.

---

## Phase 3: Per-Page OCR (Claude's Core Work)

For each page in the detection manifest:

### Step 1: Read the page

View the page scan image from `<working-dir>/pages/`. Take a moment to understand the layout:
- How many columns does this page have?
- Where are the article boundaries (headlines, rules, whitespace)?
- Where are the ads (usually bottom of page, sometimes side columns)?
- Are there standalone images or other content (mastheads, tables)?

### Step 2: Read each article

For each article on the page, extract:

**Headline:** The bold or large-text title at the top of the article. Capture exactly as printed, including any subtitle or deck head on a separate line.

**Author/byline:** Look for "By [Name]" or "[Name], [Position]" near the headline or start of body. If present, extract both `author` and `writer_position`. Many articles have no byline — use empty strings.

**Category:** Determine which section this article belongs to. Look for section headers on the page ("Sports", "Opinion", etc.). If no section header is visible:
- Sports page articles → "Sports"
- Editorial page articles with opinion content → "Opinion"
- Arts/entertainment/cultural content → "Arts & Entertainment"
- National/world news → "News"
- Default for campus-related content → "Campus News"

**Body text:** Read the full article text carefully.
- Read each column top to bottom. NEVER read across columns.
- Preserve paragraph breaks as `\n\n`.
- Preserve exact spelling, including archaic terms and 1960s phrasing.
- If text is genuinely illegible, mark it as `[illegible]`.
- Do not "correct" unusual but intentional phrasing.
- Watch for proper nouns — names of people, places, organizations must be exact.

**Continuation markers:** Check the end and beginning of articles for markers like:
- "(Continued on page X)" → set `continues_on` to the page number
- "(Continued from page X)" → set `continued_from` to the page number
- Variations: "See page X", "Turn to page X", "(Con't on p. X)"
- If the marker says "Back Page" or "next page" without a number → use `"?"` for now (will normalize in Phase 4)
- Strip the continuation marker text from the body — it's metadata, not article content.

**Images:** For each YOLO-cropped image on this page:
- Look at where the image is positioned relative to articles
- Read the caption text printed near/below the image
- Determine which article the image belongs to (or if it's a standalone/ad image)
- Record: caption text, position descriptor, and the image file path from the detection manifest
- If an image has a caption but belongs to no article, it goes in other_content

### Step 3: Read each ad

Ads are typically in the bottom half of the page, in side columns, or on dedicated ad pages. For each ad:

**Identify the business:** Look for the largest or most prominent business name.

**Extract body text:** All text content of the ad.

**Inline enrichment:** While you're looking at the ad, also determine:
- `category` — what type of business/service (see schema.md for valid categories)
- `ad_type` — "display" (graphical, larger) or "classified" (small text-only, usually grouped)
- `display_text` — a one-sentence summary of what the ad is offering
- `phone` — extract phone number if visible, empty string if not
- `address` — extract street address if visible, empty string if not
- `price` — extract any pricing info if visible, empty string if not

**Ad images:** Some ads have logos, illustrations, or product images. If a YOLO-cropped region belongs to an ad (not an article), assign it to that ad's image_files.

### Step 4: Capture other content

Anything on the page that's neither a full article nor an ad:
- **Masthead:** Usually page 1 — the newspaper name, volume, date, price. Extract as `publication_info` (top-level field, not per-page).
- **Section headers:** "Sports", "Campus News", etc. — these help categorize articles but don't need their own entry.
- **Standings tables:** Conference standings, sports records — capture as other_content with title and the table as body text.
- **Notices:** Brief announcements, schedule changes, chapel schedules.
- **Standalone photos:** Images with captions that don't belong to any article. Title can be empty; body is the caption text.

### Step 5: Save page results

Write the page's results as JSON to `<working-dir>/page_results/page_<N>.json`. Format:

```json
{
  "page_number": "1",
  "articles": [...],
  "ads": [...],
  "enriched_ads": [...],
  "other_content": [...],
  "publication_info": "Ohio Wesleyan Transcript Vol. 93 — No. 13..."
}
```

---

## Phase 4: Cross-Page Merge

After all pages are processed, review all page results together.

### Step 1: Identify continuation pairs

Scan all articles across all pages for continuation matches:

**Strong matches (merge confidently):**
- Article A on page X has `continues_on: "Y"` AND article B on page Y has `continued_from: "X"` → merge A+B
- Both articles have the same or very similar headline

**Weak matches (merge carefully):**
- One-sided: Article A says `continues_on: "Y"` but no article on page Y says `continued_from: "X"` — look for a headline match or content continuity
- Article body ends mid-sentence on one page and another article on the target page starts mid-sentence

### Step 2: Merge matched articles

For each matched pair/group:

1. **Body:** Concatenate body text with the earlier page first. Separate with `\n\n`. Strip continuation markers from both ends.
2. **Headline:** Use the headline from the first (earliest) page. If it's truncated and the continuation page has a fuller version, use that instead.
3. **Author/position:** Take from whichever page has them. If both have different values, prefer the first page.
4. **Category:** Take from whichever page has it. If conflicting, use your judgment based on content.
5. **source_pages:** Collect all page numbers as strings in order: `["1", "12"]`.
6. **Images:** Merge from all pages, maintaining order (earlier pages first).
7. **Continuation metadata:** Keep the original markers for reference. Normalize non-numeric values to `"?"`.

### Step 3: Build final lists

1. Collect all non-continuation articles as single-page entries with `source_pages: ["N"]`.
2. Deduplicate ads that appeared on multiple pages (same business_name and similar body text).
3. Deduplicate other_content items.
4. Check for orphaned YOLO images — any cropped image not assigned to an article or ad becomes an other_content entry.
5. Ensure ads[] and enriched_ads[] are in the same order with matching business_names.

### Step 4: Normalize

- All `continues_on`/`continued_from` values: `""`, numeric, or `"?"` only
- All `images[]` and `image_files[]` same length on every article
- All `image_files` paths are relative: `images/<filename>.jpg`

Save to `<working-dir>/merged_edition.json`.

---

## Phase 5: Assemble (Script)

```bash
python <skill-path>/scripts/assemble.py <working-dir> --date YYYY-MM-DD --dest public/editions/YYYY-MM-DD/
```

This script:
1. Reads `merged_edition.json`
2. Copies all referenced images to `<dest>/images/`
3. Builds the final `edition.json` with top-level `edition_date` and `publication_info`
4. Writes with 2-space indent, UTF-8 encoding, `ensure_ascii=False`

---

## Phase 6: Validate (Script)

```bash
python <skill-path>/scripts/validate.py public/editions/YYYY-MM-DD/edition.json
```

Runs all schema checks from `schema.md` § "Validation Checklist". Reports pass/fail for each check. If any check fails, fix the issue in `merged_edition.json` and re-run assembly + validation.

---

## Tips for Tricky Situations

### Multi-column layouts
Most newspaper pages have 4-6 columns. The key is to identify column boundaries (usually thin vertical lines or consistent whitespace gaps) and then read each column independently, top to bottom. An article may span multiple columns — follow the text flow from the bottom of one column to the top of the next.

### Headlines spanning columns
A wide headline that spans multiple columns indicates a major story. The article body typically starts in the leftmost column below the headline and flows across columns.

### Classified ads
These are dense, small-text ads grouped together. Each classified is usually one business or individual. Separate them by visual breaks (blank lines, dashes, or bold names). They're all `ad_type: "classified"`.

### Photo-only articles
Sometimes a large photo with a detailed caption IS the article — no body text beyond the caption. Create an article entry with an empty or minimal body and the full caption in images[]. The Phi Kappa Psi fraternity house photo in the 1960-01-13 edition is an example.

### Garbled text at merge seams
When merging cross-page articles, the transition point can be messy. Read both pages carefully around the continuation markers. If text is clearly garbled or duplicated at the seam, clean it up. Remove any repeated sentences or broken words.
