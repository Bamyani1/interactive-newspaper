# The Transcript Archive

> An interactive archive of OWU's historic student newspaper — browse editions from the 1980s with a vintage aesthetic.

![Next.js](https://img.shields.io/badge/Next.js-16.0.7-black)
![React](https://img.shields.io/badge/React-19.2.0-61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- 📰 **Archive Explorer** — Navigate through historical newspaper editions by date
- 🗺️ **Interactive Campus Map** — Explore the 1936 OWU campus with zoomable imagery and guided tours
- 🎵 **Vintage Music Player** — Era-appropriate audio accompaniment
- 🎨 **Authentic Aesthetics** — Period-accurate styling with sepia tones and newspaper typography
- 📱 **Responsive Design** — Optimized for desktop with mobile support

## Prerequisites

- **Node.js**: v18.x or higher
- **npm**: v9.x or higher (or use pnpm/yarn)

## Installation

```bash
# Clone the repository
git clone https://github.com/your-username/transcript-archive.git
cd transcript-archive

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## How to Run

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Create optimized production build |
| `npm run start` | Run the production build locally |
| `npm run lint` | Run ESLint to check code quality |

## Configuration

### Environment Variables

No environment variables are required for basic operation. Create a `.env.local` file for custom configuration:

```bash
# Example (optional)
NEXT_PUBLIC_ANALYTICS_ID=your-analytics-id
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_ANALYTICS_ID` | No | Analytics tracking ID |

### Remote Images

The app is configured to allow images from `placehold.co`. Add additional domains in `next.config.ts`.

## Project Structure

```
.
├── app/                          # Next.js App Router
│   ├── api/                      # API routes
│   │   ├── playback/             # Music playback state
│   │   ├── playlists/            # Playlist CRUD
│   │   └── tracks/               # Track listing
│   ├── campus-map/               # Interactive campus map page
│   ├── edition/                  # Main archive browser page
│   ├── globals.css               # Global styles & CSS variables
│   ├── layout.tsx                # Root layout with providers
│   └── page.tsx                  # Landing page
│
├── public/                       # Static assets
│   ├── editions/1986/            # Oct 24, 1986 edition data
│   └── tiles/                    # Deep zoom image tiles
│
└── src/features/                 # Feature-Based Architecture
    ├── archive/                  # Core state management (date/era)
    ├── campus-map/               # Interactive map components
    ├── context-panel/            # Right sidebar widgets
    ├── music-player/             # Vintage music player
    ├── navigation/               # Left sidebar navigation
    ├── news-feed/                # Main article feed
    ├── shared/                   # Shared types and utilities
    └── time-controls/            # Header date picker
```

## Development Workflow

### Code Quality

```bash
# Lint code
npm run lint

# Type check (no emit)
npx tsc --noEmit

# Build for production
npm run build
```

### Adding New Editions

1. Add scanned pages to `public/editions/{year}/scanned-newspaper/`
2. Add extracted text to `public/editions/{year}/extracted-text/`
3. Extend `src/features/news-feed/data/mockData.ts` with article metadata

### Feature Folder Pattern

New features should follow the existing structure:

```
src/features/{feature-name}/
├── components/       # React components
├── context/          # React Context (if needed)
├── data/             # Static data or mocks
├── hooks/            # Custom hooks
├── types/            # TypeScript interfaces
└── index.ts          # Barrel file (public API)
```

## Troubleshooting

### Build Errors

**`sharp` installation fails:**
```bash
npm rebuild sharp
```

**Port 3000 in use:**
```bash
npm run dev -- --port 3001
```

### Development Issues

- **Map not loading**: Ensure `public/tiles/campus-map.dzi` exists
- **Styles broken**: Check that `globals.css` is imported in `layout.tsx`

## Security Notes

- No secrets or API keys are required for operation
- All data is static — no external API calls
- User preferences stored in `localStorage` only

## Contributing

We follow **Conventional Commits** for a clean git history.

### Commit Format

```
<type>(<scope>): <description>
```

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting changes |
| `refactor` | Code restructuring |
| `chore` | Build/tooling changes |

### Before Submitting a PR

- [ ] Run `npm run build` successfully
- [ ] Run `npm run lint` with no errors
- [ ] Test changes locally in browser
- [ ] Use feature folder structure for new features

## License

MIT License — see [LICENSE](LICENSE) for details.

---
