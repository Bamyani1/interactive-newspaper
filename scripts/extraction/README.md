# Text & Image Extraction Pipeline

A Python pipeline for extracting articles from scanned newspaper pages using OCR and LLM-based article segmentation.

## Overview

```
PHASE 1: EXTRACTION
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ TIFF Scans  │────►│ Google Vision│────►│ Raw OCR Text        │
│ (per page)  │     │ API          │     │ (page_01.txt, etc.) │
└─────────────┘     └──────────────┘     └─────────────────────┘

┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ TIFF Scans  │────►│ YOLO         │────►│ Cropped Images      │
│ (per page)  │     │ DocLayNet    │     │ (p1-i1.jpg, etc.)   │
└─────────────┘     └──────────────┘     └─────────────────────┘

PHASE 2: CURATION
┌─────────────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ Raw OCR Text        │────►│ Gemini 1.5   │────►│ Structured Articles │
│ + Image Metadata    │     │ Flash (free) │     │ (JSON per page)     │
└─────────────────────┘     └──────────────┘     └─────────────────────┘

PHASE 3: ASSEMBLY
┌─────────────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ Structured Articles │────►│ Merge &      │────►│ edition.json        │
│ + Images            │     │ Validate     │     │ (frontend-ready)    │
└─────────────────────┘     └──────────────┘     └─────────────────────┘
```

## Installation

```bash
cd scripts/extraction
pip install -r requirements.txt
```

## Configuration

### Required Environment Variables

```bash
# Google Cloud Vision API credentials
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/credentials.json"

# Gemini API key (free at https://makersuite.google.com/app/apikey)
export GEMINI_API_KEY="your-api-key"
```

## Usage

### Process a Single Edition

```bash
# Run full pipeline
python pipeline.py --edition 1986-10-17

# Run individual phases
python extract.py --edition 1986-10-17
python curate.py --edition 1986-10-17
python assemble.py --edition 1986-10-17

# Skip phases (useful for re-processing)
python pipeline.py --edition 1986-10-17 --skip-extract
python pipeline.py --edition 1986-10-17 --skip-curate
```

### Process Multiple Editions

Create a file `editions.txt`:
```
1986-10-17
1986-10-24
1987-01-15
```

```bash
python pipeline.py --batch editions.txt
```

### Process Single Page (for testing)

```bash
python curate.py --edition 1986-10-17 --page 1
```

## Output Structure

```
data/ocr-output/1986-10-17/
├── pages/
│   ├── page_01.txt           # Raw OCR text
│   ├── page_01_articles.json # Curated articles
│   ├── page_02.txt
│   ├── page_02_articles.json
│   └── ...
└── edition.json              # Final frontend-ready output

public/editions/1986-10-17/
├── *.tif                     # Original scans (input)
└── extracted-images/
    ├── p1-i1.jpg            # Extracted images
    ├── p1-i2.jpg
    └── images-metadata.json # Image bounding boxes
```

## Output Format

The final `edition.json` contains articles matching the frontend `Article` interface:

```typescript
interface Article {
  id: string;              // "1986-10-17-p1-soccer-champ"
  date: string;            // "1986-10-17"
  category: string;        // "Sports"
  headline: string;        // "Booters bag title, edge Kenyon 1-0"
  summary: string;         // "The Ohio Wesleyan men's soccer team..."
  fullText: string;        // "<p>Champs!</p><p>The Ohio Wesleyan..."
  imageUrl: string | null; // "/editions/1986-10-17/extracted-images/p1-i1.jpg"
  byline: string | null;   // "RICK BALD, Staff Writer"
  page: number;            // 1
  isHero: boolean;         // true (lead story on page 1)
  isFeatured: boolean;     // true (has image, substantial length)
  imageCaption: string;    // Caption text if available
  continuesOnPage: number | null;
}
```

## Cost Estimate

| Service | Cost | Notes |
|---------|------|-------|
| Google Vision API | ~$1.50 per 1000 pages | [Pricing](https://cloud.google.com/vision/pricing) |
| Gemini 1.5 Flash | **Free** | 1500 requests/day, 1M tokens/min |
| YOLO | **Free** | Runs locally |

For a typical edition (~12 pages):
- Vision API: ~$0.02
- Gemini: $0 (within free tier)

## Troubleshooting

### "GEMINI_API_KEY not set"
Get a free API key at https://makersuite.google.com/app/apikey

### "Vision API error"
Ensure `GOOGLE_APPLICATION_CREDENTIALS` points to a valid service account JSON file with Vision API enabled.

### "No TIFF files found"
Place your scanned pages as `.tif` or `.tiff` files in `public/editions/{edition-id}/`

### JSON parse errors from Gemini
The pipeline attempts to extract JSON from Gemini's response. If you see parse errors, check the raw response in the console output. The prompt may need adjustment for your specific newspaper format.
