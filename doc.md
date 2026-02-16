# The Transcript Archive

## What It Is
An interactive archive of OWU's historic student newspaper from the 1980s with vintage aesthetics. Built with Next.js 16, featuring:
- Edition browser with date navigation
- Interactive 1936 campus map with deep zoom
- Vintage music player
- Period-accurate styling

## How to Run

### Prerequisites
- Node.js 18.x or higher
- npm 9.x or higher

### Development
```bash
npm install
npm run dev          # Start dev server at http://localhost:3000
```

### Production
```bash
npm run build        # Create optimized build
npm start            # Run production build
```

### Code Quality
```bash
npm run lint         # ESLint checks
npm run test         # Run tests with Vitest
```

## How to Deploy

### Vercel (Recommended)
1. Connect repository to Vercel
2. Deploy from `main` branch
3. No environment variables required
4. Edition data deploys automatically from `public/editions/`

### Other Platforms
- Static export: Compatible with any static host
- Server required: For API routes (edition loading)
- No database needed: All data served from JSON files

## Directory Map

```
.
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API routes (edition loading)
│   │   ├── edition/            # Main archive browser
│   │   ├── campus-map/         # Interactive map page
│   │   ├── about/              # About page
│   │   ├── contact/            # Contact page
│   │   └── page.tsx            # Landing page
│   ├── features/               # Feature modules
│   │   ├── archive/            # Core state (date/era)
│   │   ├── music-player/       # Vintage audio player
│   │   ├── news-feed/          # Article feed & display
│   │   ├── navigation/         # Left sidebar
│   │   ├── context-panel/      # Right sidebar widgets
│   │   ├── time-controls/      # Header date picker
│   │   └── theme/              # Theming system
│   ├── components/             # Shared UI components
│   ├── lib/                    # Utilities
│   │   └── ocr-adapter.ts      # Edition data loader
│   └── types/                  # TypeScript types
│
├── public/
│   ├── editions/               # Processed newspaper data (JSON)
│   │   └── YYYY-MM-DD/
│   │       ├── edition.json    # Article data
│   │       └── images/         # Edition images
│   ├── backgrounds/            # Landing page assets
│   └── tiles/                  # Campus map deep zoom tiles
│
├── ocr/                        # OCR Processing Pipeline (dev-only)
│   ├── convert_scans.py        # Main processing script
│   ├── viewer.py               # Local edition viewer
│   ├── requirements.txt        # Python dependencies
│   └── README.md               # Processing documentation
│
└── tests/                      # Test suite
```

## Key Flows

### Edition Browsing
1. User navigates to `/edition`
2. API route `/api/editions` lists available editions from `public/editions/`
3. User selects date → `/api/editions/[date]` loads edition JSON
4. `ocr-adapter.ts` transforms OCR data to frontend `Article` type
5. News feed renders articles with category classification

### Article Display
- OCR text converted to HTML paragraphs
- Images served via `/api/editions/[date]/images/[...path]`
- Categories auto-classified by headline/byline heuristics
- Hero/featured articles prioritized by image presence

### Music Player
- Static playlists from `src/features/music-player/data/musicData.ts`
- LocalStorage persistence for playback state
- Era-appropriate tracks (1980s)

### Campus Map
- Deep zoom imagery using OpenSeadragon
- Tiles in `public/tiles/campus-map.dzi`
- Interactive hotspots and guided tours

## Dependencies

### Frontend
- Next.js 16.1.4 (App Router)
- React 19.2.0
- Tailwind CSS 4.x
- Framer Motion (animations)
- GSAP (advanced animations)
- Lucide React (icons)

### Development
- TypeScript 5.x
- ESLint 9.x
- Vitest 3.x (testing)
- Testing Library (React)

### OCR Pipeline (dev-only, not deployed)
- Python 3.x
- Google Cloud Vision API (OCR)
- Gemini API (article curation)
- YOLO (image extraction)

## OCR Processing (Optional)

To process new newspaper editions:

```bash
cd ocr
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Configure API keys (see ocr/README.md)
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
export GEMINI_API_KEY="your-api-key"

# Process an edition
python convert_scans.py --date YYYY-MM-DD
```

Output goes to `public/editions/{date}/edition.json` and is ready for deployment.

**Note:** OCR processing is development-only. The pipeline code exists in the repo but is not deployed to Vercel. Production only needs the processed JSON files.

## Gotchas

### Data Location
- ✅ Edition data MUST be in `public/editions/` to deploy
- ❌ Previously in `ocr/output/` which is gitignored
- Processed editions can be committed selectively

### Image Paths
- Images referenced in `edition.json` are relative
- Frontend converts to `/api/editions/{date}/images/{filename}`
- Actual image files not yet implemented (placeholder system)

### Database
- No database needed for ~50 editions
- JSON files work perfectly for this scale
- ISR (revalidate: 60s) caches edition data

### API Keys (OCR Only)
- Google Cloud Vision: ~$1.50 per 1000 pages
- Gemini 1.5 Flash: Free (1500 requests/day)
- Only needed if processing new editions
- Not required for running the demo

### Build
- Keep total editions under ~100MB for fast Vercel deploys
- Build time with ~50 editions: <2 minutes
- No serverless function size issues (data is static)

## Troubleshooting

### "Edition not found"
- Check `public/editions/{date}/edition.json` exists
- Verify date format: YYYY-MM-DD
- Check `ocr-adapter.ts` path configuration

### Campus map not loading
- Verify `public/tiles/campus-map.dzi` exists
- Check browser console for tile loading errors

### Build errors
```bash
# Clear caches
rm -rf .next node_modules
npm install
npm run build
```

### OCR processing fails
- See `ocr/README.md` for detailed troubleshooting
- Verify API credentials are configured
- Check Python dependencies are installed

---

**Built with ❤️ for OWU's historical archive**
