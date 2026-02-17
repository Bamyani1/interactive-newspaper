# OCR Pipeline for Historical Newspapers

This pipeline processes scanned newspaper pages (TIFF format) into structured JSON with extracted articles and images.

## Architecture

**Two-stage processing:**
1. **DocLayout-YOLO**: Detects image/photo regions in each page
2. **Google Gemini Flash**: Extracts article text, metadata, and categorization

## Setup

### 1. Create Virtual Environment
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure API Key
Create `.env` file:
```bash
GOOGLE_API_KEY=your_gemini_api_key_here
```

Get your key from: https://aistudio.google.com/apikey

### 3. First Run (Auto-downloads YOLO model)
On first execution, the DocLayout-YOLO model (~300MB) will download from HuggingFace to `models/` directory.

## Usage

### Process Single Edition
```bash
source .venv/bin/activate
python convert_scans.py "scans/YYYY-MM-DD"
```

**Output** is split between two directories:

App-serving data (in `public/editions/YYYY-MM-DD/`):
- `edition.json` - Structured article data (~200-300KB)
- `images/` - Extracted editorial images (~2MB, 10-20 photos)

OCR intermediates (in `ocr/output/YYYY-MM-DD/`):
- `diagnostics.json` - Processing metrics
- `*.md` - Per-page markdown outputs
- `summary.md` - Merged edition markdown

**Duration**: ~2.5 minutes per page (8-page edition = ~20 minutes)

**Cost**: ~60K tokens per page = $0.01 per edition @ Gemini Flash rates

### Batch Process All Editions

Place raw scan folders in `ocr/scans/YYYY-MM-DD/`, then run with no arguments:

```bash
source .venv/bin/activate
python convert_scans.py
```

This processes all editions in `ocr/scans/` and writes app data to `public/editions/` and intermediates to `ocr/output/`.

**For 50 editions:**
- Duration: ~16-17 hours
- Cost: ~$0.60-1.00
- Skips already-processed editions (resume-safe)

### Validate Results
```bash
source .venv/bin/activate
python validate_batch.py
```

Checks all editions for:
- Valid JSON structure
- Article presence
- Image files
- Diagnostics data

## Output Schema

### edition.json Structure
```json
{
  "date": "1988-04-13",
  "publication": "The Transcript",
  "location": "Delaware, OH",
  "articles": [
    {
      "id": "1988-04-13-001",
      "headline": "Article Title",
      "category": "News|Sports|Arts|Opinion",
      "content": "Full article text...",
      "byline": "Author Name",
      "image": "images/0001_Page 1_img1.jpg",
      "page": 1
    }
  ]
}
```

### Diagnostics
```json
{
  "pages_attempted": 8,
  "pages_processed": 8,
  "total_images_extracted": 15,
  "total_articles": 42,
  "processing_time_seconds": 1245,
  "gemini_tokens_used": 485000
}
```

## Files

- `convert_scans.py` - Main OCR script
- `batch_process.sh` - Process all editions with progress tracking
- `validate_batch.py` - Validate processing results
- `monitor_progress.sh` - Real-time progress monitor
- `requirements.txt` - Python dependencies
- `.env` - API credentials (git-ignored)
- `models/` - YOLO model cache (git-ignored)
- `scans/` - Raw TIF scan inputs, organized by date (git-ignored)
- `output/` - OCR intermediates: diagnostics, markdown (git-ignored)

## Model Info

**DocLayout-YOLO**: `juliozhao/DocLayout-YOLO-DocStructBench`
- Purpose: Detect figures/photos in document layouts
- Size: ~300MB
- Auto-downloaded on first run
- Cached in `models/` directory

**Google Gemini**: `gemini-3-flash-preview`
- Purpose: OCR + article extraction + categorization
- Rate: $0.000025 per 1K tokens
- Avg: ~60K tokens per newspaper page

## Performance

**Single Edition (8 pages):**
- Time: ~20-25 minutes
- Tokens: ~480K (~$0.01)
- Output: 40-50 articles, 10-20 images

**50 Editions (400 pages):**
- Time: ~16-17 hours
- Tokens: ~24M (~$0.60)
- Output: ~2,000 articles, ~500 images

## Troubleshooting

### "Model not found" error
- First run downloads model automatically
- Check internet connection
- Verify `models/` directory is writable

### API errors
- Check `.env` has valid `GOOGLE_API_KEY`
- Verify API key at https://aistudio.google.com/apikey
- Check rate limits (Gemini Flash is generous)

### Out of memory
- Reduce concurrent processing
- Process editions sequentially
- Close other applications

### Missing images
- Check YOLO confidence threshold (`_YOLO_CONF_THRESHOLD = 0.5`)
- Verify source TIFFs are readable
- Check `diagnostics.json` for errors

## Integration

Processed editions are served by Next.js API routes:
- `/api/editions` - List all editions
- `/api/editions/[date]` - Get specific edition
- `/api/editions/[date]/images/[...path]` - Serve images

Frontend reads `edition.json` files directly from `public/editions/*/`.
