# Gold Edition Audit Log — 1960-01-13

**Audit date:** 2026-04-01
**File audited:** `gold-edition.json` (post-Phase 1 gold creation, pre-audit)
**Audited file saved as:** `gold-edition.json` (overwritten in place)

---

## Audit Methodology

Independent third-party page-by-page review of every article, ad, enriched ad, and other_content entry. Each page's images were visually inspected and cross-referenced against captions and image_files assignments. All continuation fields were validated against the pipeline's normalization rules in `ocr/src/transcript_ocr/merging/continuation.py`. Schema compliance was verified against the Pydantic models in `ocr/src/transcript_ocr/contracts/content_models.py`.

---

## Corrections Applied by This Audit (Phase 2)

| # | Location | Field | Old Value | New Value | Reason |
|---|----------|-------|-----------|-----------|--------|
| 1 | `articles[0]` ("Court Fines 2 Men For Illegal Calls") | `continues_on` | `"Back Page"` | `"?"` | Pipeline normalization rule (continuation.py lines 82–86): non-numeric, non-"?" values → `"?"`. "Back Page" is non-numeric. |
| 2 | `articles[4]` ("Special Grant Goes To Kelly") | `continues_on` | `"Back Page"` | `"?"` | Same rule as above. |

**Total new corrections:** 2

---

## Previously Applied Corrections (Phase 1 — Gold Creation)

These 13 corrections were already present in the gold file before this audit and were verified as correct:

| # | Location | Type | Description |
|---|----------|------|-------------|
| 1 | `articles[?]` image caption | OCR typo | "accordirly" → "accordingly" |
| 2 | `articles[?]` body | OCR typo | "chosed on the basis" → "chosen on the basis" |
| 3 | `articles[?]` body | OCR typo | "as week as" → "as weak as" |
| 4 | `articles[?]` body | OCR typo | "inlvolved" → "involved" |
| 5 | `articles[?]` body | OCR typo | "Oucome Fortunate" → "Outcome Fortunate" |
| 6 | `articles[32]` headline | OCR error | Corrected to `"'Messiah' Available"` |
| 7 | `articles[1]` category | Miscategorization | Changed to `"Campus News"` (PHI KAPPA PSI article) |
| 8 | `articles[18]` category | Miscategorization | Changed to `"Arts & Entertainment"` (On Campus Shulman) |
| 9 | `articles[37]` images | Misalignment | Swapped images[0] and images[1] (Tom Eibel: action shot → index 0, portrait → index 1) |
| 10–11 | `enriched_ads` (multiple) | Encoding | `│` (U+2502 box-drawing) → `●` (U+25CF bullet) |
| 12 | `enriched_ads` (Kimberly-Clark) | Encoding | `\u0002` (control char) → `¢` (U+00A2 cent sign) |
| 13 | `other_content` | Duplicate | Removed duplicate entry |

---

## Items Reviewed and Confirmed Correct

### Articles (46 total)
- All 46 articles verified for: headline, author, category, body text (spot-checked), continuation fields, images/image_files alignment, source_pages
- All categories valid per `ARTICLE_CATEGORIES` enum
- All `continues_on`/`continued_from` values comply with pipeline normalization rules
- Images/image_files arrays are index-aligned across all articles

### Image Verification (all pages)
- **Page 1:** 3 images verified (campus scene, Prof. Kelly portrait, student photo)
- **Page 2:** No images
- **Page 3:** 2 images verified (photos matching article subjects)
- **Page 4:** 1 image verified
- **Page 5:** 2 images verified
- **Page 6:** 1 image verified
- **Page 7:** 2 images verified
- **Page 8:** 1 image verified
- **Page 9:** 2 images verified (Tom Eibel action shot #54, portrait #55 — swap confirmed correct)
- **Page 10:** 1 image verified (Jim Brown swimming photo)
- **Page 11:** 1 image verified (basketball rebound — Otterbein's Alf Washington, #12 and #55 visible, caption matches)
- **Page 12:** 1 image verified (Dunlop tire ad image, correctly assigned to Ad 52)

### Ads (53 total)
- All 53 ads have required fields: `business_name`, `body`, `image_files`

### Enriched Ads (53 total)
- All 53 enriched ads have all 9 required fields per `EnrichedAd` Pydantic model
- All categories valid per `AD_ENRICHMENT_CATEGORIES`
- All `ad_type` values are `"display"` or `"classified"`

### Other Content (19 total)
- All entries have required `body` field
- `title` field present where applicable

---

## Known Limitations (Not Correctable Without Original TIF Scans)

These issues were identified but cannot be fixed because the original high-resolution scans are not available for re-reading:

1. **Articles 0, 4, 14:** Garbled merge text from cross-page continuation — the pipeline merged text from pages 1 and 12 but some transition text is garbled. Without original scans, the exact intended text cannot be recovered.
2. **Article 36** (Jewelry/Pinnings): Multi-column text appears garbled in places due to OCR column-detection issues. Cannot verify exact original text without scans.

---

## Final Validation Summary

| Check | Result |
|-------|--------|
| Article schema compliance | ✓ PASS |
| Article category validation | ✓ PASS |
| Continuation field normalization | ✓ PASS (2 fixes applied) |
| Images/image_files alignment | ✓ PASS |
| Ad schema compliance | ✓ PASS |
| Enriched ad schema compliance | ✓ PASS |
| Enriched ad category validation | ✓ PASS |
| Other content schema compliance | ✓ PASS |
| Ads count = Enriched ads count | ✓ PASS (53 = 53) |
| No control characters in article text | ✓ PASS |
| No encoding anomalies in enriched ads | ✓ PASS |

**Final counts:** 46 articles, 53 ads, 53 enriched ads, 19 other content items
