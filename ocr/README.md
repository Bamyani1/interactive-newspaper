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
- **db/** - Database models and scripts (PostgreSQL/Supabase) - currently unused
- **editions/** - Input: TIFF page scans
- **output/** - Output: Structured JSON editions
- **models/** - ML model cache (YOLO weights, gitignored)

## Output Format

Processed editions saved to `output/YYYY-MM-DD/edition.json`:
```json
{
  "edition_date": "1989-04-12",
  "articles": [...],
  "ads": [...],
  "other_content": [...]
}
```

Frontend loads these via API routes in `src/app/api/editions/`.

## Database (Optional)

The `db/` directory contains PostgreSQL/Supabase integration for persistent storage. Currently unused by the frontend, which loads directly from JSON files in `ocr/output/`.
