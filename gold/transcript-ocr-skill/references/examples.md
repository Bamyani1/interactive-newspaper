# Examples and Edge Cases

Real examples from the 1960-01-13 gold-standard edition. Study these to understand what correct output looks like.

---

## Example 1: Simple single-page article (no images, no continuation)

```json
{
  "headline": "OEA Veep Post Goes To Alter",
  "author": "",
  "writer_position": "",
  "category": "Campus News",
  "continues_on": "",
  "continued_from": "",
  "body": "C. Francis Alter, associate professor of education, was elected vice-president of the Department of Higher Education of the Ohio Education Association at its annual December meeting in Toledo, O.\n\nProf. Alter will be vice-president of the department, which has about 600 members, for one year. It is one of seven departments in the O.E.A.\n\nProf. Alter has been on the OWU staff since 1949.",
  "images": [],
  "image_files": [],
  "source_pages": ["12"]
}
```

**Key points:** Empty strings for author, writer_position, continues_on, continued_from. Empty arrays for images and image_files. Single-page article has source_pages with one entry.

---

## Example 2: Article with an image

```json
{
  "headline": "Special Grant Goes To Kelly",
  "author": "",
  "writer_position": "",
  "category": "Campus News",
  "continues_on": "?",
  "continued_from": "1",
  "body": "J. B. Kelly, associate professor of history and political science, received a special grant-in-aid for research from the Social Science Research Council in New York last week.\n\nProf. Kelly will travel to London next August to collect material for a diplomatic history of Iran in the 1800-1914 period.",
  "images": [
    {
      "caption": "J. B. Kelly",
      "position": "upper-right"
    }
  ],
  "image_files": ["images/0001_Page 1_img2.jpg"],
  "source_pages": ["1", "12"]
}
```

**Key points:** `images[0]` and `image_files[0]` are index-aligned — the caption describes the image at that path. This article spans pages 1 and 12 (continued from page 1, continues to "?" because the original marker said "Back Page" which is non-numeric).

---

## Example 3: Photo-only article (caption IS the content)

```json
{
  "headline": "PHI KAPPA PSI fraternity's new house is shown nearing completion.",
  "author": "",
  "writer_position": "",
  "category": "Campus News",
  "continues_on": "",
  "continued_from": "",
  "body": "",
  "images": [
    {
      "caption": "PHI KAPPA PSI fraternity's new house is shown nearing completion. The lodge, third to be built on the Williams Campus, is expected to be ready for occupancy by the semester break, accordingly to Phi Psi spokesmen. It will house 52 men. (Photo by Schwindt)",
      "position": "upper-center"
    }
  ],
  "image_files": ["images/0001_Page 1_img1.jpg"],
  "source_pages": ["1"]
}
```

**Key points:** Body is empty. The entire "article" is a photo with a detailed caption. The headline is essentially the first sentence of the caption. Photo credit "(Photo by Schwindt)" is part of the caption.

---

## Example 4: Display ad with image

```json
// ads[] entry:
{
  "business_name": "Dunlop Tire and Battery",
  "body": "IMPORTED TIRES\nFOR SPORTS CARS\nFOR PASSENGER CARS\nDUNLOP\nTIRE AND BATTERY\n46 E. Winter St.\nphone 26841",
  "image_files": ["images/0012_Page 12_img1.jpg"]
}

// Corresponding enriched_ads[] entry (same index):
{
  "business_name": "Dunlop Tire and Battery",
  "body": "IMPORTED TIRES\nFOR SPORTS CARS\nFOR PASSENGER CARS\nDUNLOP\nTIRE AND BATTERY\n46 E. Winter St.\nphone 26841",
  "image_files": ["images/0012_Page 12_img1.jpg"],
  "category": "Automotive",
  "ad_type": "display",
  "display_text": "Dunlop Tire and Battery: Imported tires for sports cars and passenger cars at 46 E. Winter St.",
  "phone": "26841",
  "address": "46 E. Winter St.",
  "price": ""
}
```

**Key points:** ads[] and enriched_ads[] entries at the same index share business_name, body, and image_files exactly. The enriched version adds category, ad_type, display_text, phone, address, price.

---

## Example 5: Ad with multiple images

```json
{
  "business_name": "Viceroy Filter Tip Cigarettes",
  "body": "...",
  "image_files": [
    "images/0008_Page 8_img1.jpg",
    "images/0008_Page 8_img2.jpg",
    "images/0008_Page 8_img3.jpg",
    "images/0008_Page 8_img4.jpg",
    "images/0008_Page 8_img5.jpg"
  ]
}
```

**Key points:** A single ad can have many images (this full-page cigarette ad has 5). All are listed in image_files.

---

## Example 6: Other content entries

```json
{"title": "COURSE DROPPED", "body": "The Administration has decided to discontinue OWU'S Middle Eastern studies program..."}
{"title": "FINALS TIME", "body": "Due to finals, the Transcript will not publish an issue next week..."}
{"title": "Chapel Slate", "body": "Friday: Mrs. Magna Trocman, Fellowship of Reconciliation..."}
{"title": "OC Standings", "body": "1. Wittenberg 4 0\n2. Wooster 3 0\n3. OWU 3 1..."}
{"title": "", "body": "CIRCLE K MEN Terry Swango, Tom Grissom and Don Craig (l. to r.) paint the office of the Delaware Cancer Society Building as one of the service group's community projects. (Photo by Stouffer)"}
```

**Key points:** Title is optional (can be empty string). The last example is a standalone photo caption — no title, body is the caption text. This is how orphaned images should be handled.

---

## Known Failure Modes from the Previous Pipeline

These are real errors that the Gemini-based pipeline made. Learn from them:

### 1. OCR text errors
- "accordirly" should be "accordingly"
- "chosed on the basis" should be "chosen on the basis"
- "as week as" should be "as weak as"
- "inlvolved" should be "involved"
- "Oucome Fortunate" should be "Outcome Fortunate"

**Lesson:** Use context to catch obvious misspellings. "Week" vs "weak" is distinguishable by context (sentence about being weak/feeble, not about time).

### 2. Wrong article categories
- PHI KAPPA PSI fraternity article was categorized as "News" → should be "Campus News" (it's about campus construction)
- "On Campus" column by Max Shulman was categorized as "Opinion" → should be "Arts & Entertainment" (it's a humor/entertainment column)

**Lesson:** Don't just look at the headline — read the content and look for section headers on the page.

### 3. Image-caption mismatch
- Tom Eibel basketball article had two photos: an action shot (#54) and a portrait (#55). The action shot's caption was paired with the portrait and vice versa.

**Lesson:** Look at the actual image content, not just the image's position. If a caption describes "action during the game" and the image is clearly a posed portrait, something is wrong.

### 4. Continuation normalization
- `continues_on: "Back Page"` should be `continues_on: "?"` — "Back Page" is not numeric.

**Lesson:** Always normalize. If it's not a digit string and not empty, it's "?".

### 5. Encoding issues
- Box-drawing character │ (U+2502) appeared instead of bullet ● (U+25CF) in ad text
- Control character \u0002 appeared instead of ¢ (cent sign) in ad pricing

**Lesson:** Use the character that makes contextual sense. A bullet point in an ad listing? Use ●. A price with "5¢"? Use ¢.

### 6. Duplicate content
- Same other_content entry appeared twice (extracted from overlapping YOLO regions on the same page)

**Lesson:** Deduplicate after extraction. If two entries have the same body text (or >90% overlap), keep one.

### 7. Orphaned images
- Page 3 had a Circle K painting photo that wasn't assigned to any article. It should have been captured as other_content.

**Lesson:** After assigning images to articles and ads, check for unassigned YOLO regions. Create other_content entries for them.

### 8. Garbled cross-page merges
- Articles 0, 4, and 14 had garbled text at the merge seam — where page 1 text joins page 12 text.

**Lesson:** At merge points, carefully read both sides. Look for repeated words, broken sentences, or nonsensical transitions. Clean them up.
