# OCR Pipeline for Historical Newspapers

This pipeline processes scanned newspaper pages (TIFF format) into structured JSON with extracted articles and images.

## Architecture

**Five-phase pipeline:**
1. **Phase 1 — DocAI extraction**: Preprocesses pages + detects image regions via DocLayout-YOLO
2. **Phase 2 — Gemini structuring**: Extracts article text, metadata, and categorization per page
3. **Phase 3 — Cross-page merge**: Merges continued articles across pages into `edition.json`
4. **Phase 4 — Ad enrichment**: Enriches ad metadata via Gemini
5. **Phase 5 — Summary + diagnostics**: Writes issue reports and diagnostics JSON

## Setup

### 1. Create Virtual Environment
```bash
cd ocr/
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure API Key
Add to `.env.local` in the project root:
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
python convert_scans.py "inbox/YYYY-MM-DD Newspaper Name"
```

### Full Pipeline (recommended)
```bash
scripts/ocr/process-edition.sh "ocr/inbox/YYYY-MM-DD Newspaper Name" --run-id my-run
```

This runs OCR → image cleanup → R2 upload → database seed in one step.

### Batch Process All Editions

Place raw scan folders in `ocr/inbox/`, then run with no arguments:

```bash
source .venv/bin/activate
python convert_scans.py
```

### Ad Enrichment (standalone)
```bash
python enrich_ads.py --date 1980-04-17
```

**Output** is split between two directories:

App-serving data (in `public/editions/YYYY-MM-DD/`):
- `edition.json` — Structured article data
- `images/` — Extracted editorial images

OCR intermediates (in `ocr/runs/YYYY-MM-DD/`):
- `diagnostics.json` — Processing metrics
- `summary.md` — Merged edition markdown
- `snapshots/` — Pipeline stage snapshots

**Duration**: ~2.5 minutes per page (8-page edition = ~20 minutes)

**Cost**: ~60K tokens per page = $0.01 per edition @ Gemini Flash rates

## Entry Points

| File | Purpose |
|------|---------|
| `convert_scans.py` | Main OCR entry point (thin wrapper → `transcript_ocr.cli.convert_scans`) |
| `enrich_ads.py` | Standalone ad enrichment (thin wrapper → `transcript_ocr.cli.enrich_ads`) |

## Files

- `convert_scans.py` — Main OCR entry point
- `enrich_ads.py` — Post-OCR ad enrichment
- `requirements.txt` — Python dependencies
- `models/` — YOLO model cache (git-ignored, auto-downloaded)
- `inbox/` — Drop new scan folders here (git-ignored)
- `done/` — Completed scans moved here (git-ignored)
- `runs/` — OCR intermediates: diagnostics, snapshots (git-ignored)
- `src/transcript_ocr/` — Python package with all pipeline logic

## Model Info

**DocLayout-YOLO**: `juliozhao/DocLayout-YOLO-DocStructBench`
- Purpose: Detect figures/photos in document layouts
- Size: ~300MB
- Auto-downloaded on first run
- Cached in `models/` directory

**Google Gemini**: `gemini-2.5-flash-preview-05-20`
- Purpose: OCR + article extraction + categorization + ad enrichment
- Avg: ~60K tokens per newspaper page

## Troubleshooting

### "Model not found" error
- First run downloads model automatically
- Check internet connection
- Verify `models/` directory is writable

### API errors
- Check `.env.local` has valid `GOOGLE_API_KEY`
- Verify API key at https://aistudio.google.com/apikey
- Check rate limits (Gemini Flash is generous)

### Missing images
- Check YOLO confidence threshold in `config/constants.py`
- Verify source TIFFs are readable
- Check `diagnostics.json` for errors
