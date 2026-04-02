# Edition JSON Schema Reference

This document defines the exact output schema for `edition.json`. Every field, every type, every valid value. The skill's output must match this schema exactly — it is validated by `scripts/validate.py` after assembly.

Source of truth: `ocr/src/transcript_ocr/contracts/content_models.py` (Pydantic models).

---

## Top-Level Structure

```json
{
  "edition_date": "string — YYYY-MM-DD format",
  "publication_info": "string — masthead text (newspaper name, volume, number, city, date, price)",
  "articles": "MergedArticle[] — all articles, merged if multi-page",
  "ads": "Ad[] — raw ad extractions",
  "enriched_ads": "EnrichedAd[] — same ads with metadata, SAME count and order as ads[]",
  "other_content": "OtherContent[] — non-article, non-ad content"
}
```

`edition_date` and `publication_info` are NOT in the Pydantic `EditionContent` model but are required in the output JSON. They are added during assembly.

---

## MergedArticle

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `headline` | string | required | Exact headline text as printed in the newspaper |
| `author` | string | `""` | Byline name. Empty string if no byline |
| `writer_position` | string | `""` | Role title (e.g., "Sports Editor", "Transcript Editor"). Empty if none |
| `category` | string | `"Campus News"` | **Exactly one of:** `"Campus News"`, `"News"`, `"Sports"`, `"Arts & Entertainment"`, `"Opinion"` |
| `continues_on` | string | `""` | Page number where article continues. `""` if doesn't continue. Numeric string, `"?"`, or `""` only |
| `continued_from` | string | `""` | Page number where article is continued from. Same rules as continues_on |
| `body` | string | required | Full article text. Paragraphs separated by `\n\n` |
| `images` | ArticleImage[] | `[]` | Caption and position for each image |
| `image_files` | string[] | `[]` | Relative paths to image files. **Must be same length as images[]** |
| `source_pages` | string[] | `[]` | Page numbers as strings: `["1"]`, `["1", "12"]`, etc. |

### Category Assignment Guide

- **Campus News**: Student activities, Greek life, campus events, clubs, academic programs, faculty appointments, student government, campus facilities
- **News**: Off-campus news, national/international stories, wire service content
- **Sports**: Athletics, game results, player profiles, coach interviews, intramurals
- **Arts & Entertainment**: Music, theater, film, book reviews, art exhibitions, cultural columns, entertainment features
- **Opinion**: Editorials, letters to the editor, opinion columns, editorial cartoons

### Continuation Field Rules

Values must be one of:
- `""` — empty string (no continuation)
- A numeric string like `"1"`, `"5"`, `"12"` — the page number
- `"?"` — continuation exists but page number is unclear

**Normalization:** Any non-numeric text (like "Back Page", "next page", "See Page Five") must become `"?"`. This matches the pipeline's normalization rule in `merging/continuation.py` lines 82-86.

---

## ArticleImage

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `caption` | string | required | Full caption text including photo credit (e.g., "(Photo by Smith)") |
| `position` | string | `""` | Spatial position on page: `"upper-center"`, `"center-left"`, `"lower-right"`, etc. Empty if unknown |

---

## Ad

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `business_name` | string | required | Business or advertiser name |
| `body` | string | required | Full ad text |
| `image_files` | string[] | `[]` | Relative paths to ad images |

---

## EnrichedAd

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `business_name` | string | required | **Must match corresponding Ad[i].business_name** |
| `body` | string | required | **Must match corresponding Ad[i].body** |
| `image_files` | string[] | required | **Must match corresponding Ad[i].image_files** |
| `category` | string | required | **Exactly one of:** `"Food & Drink"`, `"Entertainment"`, `"Services"`, `"Retail"`, `"Greek Life"`, `"Jobs"`, `"Housing"`, `"Education"`, `"Events"`, `"Other"` |
| `ad_type` | string | required | `"display"` or `"classified"` |
| `display_text` | string | required | Human-readable summary of what the ad offers |
| `phone` | string | required | Phone number if present, `""` if not |
| `address` | string | required | Address if present, `""` if not |
| `price` | string | required | Price info if present, `""` if not |

### Ad ↔ EnrichedAd Relationship

- `ads` and `enriched_ads` arrays must have the **same length**
- `ads[i]` and `enriched_ads[i]` must refer to the **same ad** (matching business_name, body, image_files)
- Think of enriched_ads as ads + metadata overlay

### Ad Category Guide

- **Food & Drink**: Restaurants, cafés, diners, groceries, bakeries, beverages
- **Entertainment**: Movie theaters, bowling alleys, music venues, recreation
- **Services**: Laundry, dry cleaning, repair shops, banks, insurance, barbers
- **Retail**: Clothing, jewelry, department stores, bookstores, general merchandise
- **Greek Life**: Fraternity/sorority-specific ads
- **Jobs**: Employment, help wanted, career opportunities
- **Housing**: Apartments, rooms for rent, real estate
- **Education**: Schools, tutoring, educational programs, graduate programs
- **Events**: Dances, concerts, special events, gatherings
- **Other**: Anything that doesn't fit the above categories

---

## OtherContent

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | string | `""` | Title or heading. Optional — empty string if none |
| `body` | string | required | Content text. Must be non-empty |

### What qualifies as OtherContent

- Mastheads and publication info banners
- Column headers and section dividers
- Standings tables (e.g., conference sports standings)
- Brief notices and announcements
- Standalone photos with captions that don't belong to any article
- Weather information
- Schedule listings (e.g., chapel schedules)
- Filler content and space fillers

---

## Image File Path Convention

All image file paths in the JSON must be **relative** from the edition directory:
```
images/0001_Page 1_img1.jpg
images/0003_Page 3_img2.jpg
```

File naming pattern: `{page_number_padded}_Page {N}_img{M}.jpg`
- Page number padded to 4 digits: `0001`, `0002`, etc.
- Image number starts at 1: `img1`, `img2`, etc.

---

## Validation Checklist

The `scripts/validate.py` script checks all of the following. Make sure your output passes:

1. `edition_date` is a valid ISO date string
2. `publication_info` is non-empty
3. At least 1 article exists
4. Every article category is from the valid set
5. Every continuation field is `""`, numeric, or `"?"`
6. `images[]` and `image_files[]` are same length on every article
7. Every referenced image file exists on disk
8. `len(ads) == len(enriched_ads)`
9. `ads[i].business_name == enriched_ads[i].business_name` for all i
10. Every enriched_ad category is from the valid set
11. Every enriched_ad ad_type is `"display"` or `"classified"`
12. No control characters (U+0000–U+001F except \n and \t) in any text field
13. Every OtherContent has a non-empty body
