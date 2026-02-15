# OCR Pipeline

This directory contains the OCR processing pipeline for extracting structured data from newspaper page scans.

## Setup

```bash
cd ocr
python -m venv .venv
source .venv/bin/activate  # or `.venv\Scripts\activate` on Windows
pip install -r requirements.txt
```

## Configuration

Copy `.env.example` from root and create `ocr/.env`:
- `GEMINI_API_KEY` - For article curation (Google AI Studio)
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to GCP credentials JSON

## Usage

```bash
# Process a single edition
python convert_scans.py --date YYYY-MM-DD

# View processed output
python viewer.py
```

## Architecture

- **convert_scans.py** - Main pipeline (OCR → extraction → curation → assembly)
- **editions/** - Input: TIFF page scans (gitignored)
- **models/** - ML model cache (YOLO weights, gitignored)
- Output: `../public/editions/YYYY-MM-DD/` - Deployed with the app

## Output Format

Processed editions are saved to `../public/editions/YYYY-MM-DD/edition.json`:
```json
{
  "edition_date": "1989-04-12",
  "articles": [...],
  "ads": [...],
  "other_content": [...]
}
```

Edition data in `public/editions/` is automatically deployed to Vercel and loaded by the frontend via API routes in `src/app/api/editions/`.
