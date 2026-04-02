Build a `/golden` route that visually renders `gold/1960-01-13/gold-edition.json` as a standalone newspaper viewer. This is a gold-standard reference file — someone visiting `/golden` should be able to inspect every article, ad, and content item at a glance.

Before writing any code:

1. Read `CLAUDE.md` for project conventions, tech stack, and path aliases.
2. Read `gold/1960-01-13/gold-edition.json` to understand the exact data shape and field names.
3. Read `src/styles/tokens/colors.css` and a few existing components in `src/features/news-feed/components/` to match the app's visual style.
4. Read `src/app/edition/[date]/page.tsx` to understand the existing page patterns.

Then create these files:

**`src/app/golden/page.tsx`** — Server component. Read the gold JSON from the filesystem using `fs` and `path` with `process.cwd()`. Pass the parsed data to a client component. No API route, no database.

**`src/features/golden/components/GoldenViewer.tsx`** — "use client" component receiving the full gold edition as props. Render:

- A masthead with edition date, publication info, and total counts (articles, ads, other content).
- A sticky tab bar: Articles, Ads, Other Content, Audit Stats.
- **Articles tab**: Group by category. Each card shows headline, author/writer_position if present, category badge, source pages, continuation info if any, body text (collapsed to 3 lines by default with "Read more" toggle), and images with captions. Image files in the JSON are relative paths like `images/0001_Page 1_img1.jpg`. The actual image files live in `gold/1960-01-13/images/` (31 jpg files). You will need to make these servable — either copy them into `public/golden/images/` or set up a static route. Resolve `<img>` src paths accordingly.
- **Ads tab**: Split into Display Ads and Classified Ads using the enriched_ads `ad_type` field. Each card shows business name, body, enriched metadata (category badge, phone, address, price, display_text), and images. Same image resolution as articles.
- **Other Content tab**: Simple cards with title and body.
- **Audit Stats tab**: Summary statistics — article count per category, ads by category, total images, articles with continuations, articles with images. Render as a clean stat grid or data table.

**`src/features/golden/index.ts`** — Barrel export.

Constraints:

- Do NOT modify any existing files. All new code.
- Do NOT add npm dependencies. Use only what's installed (check package.json).
- Match the app's existing visual style — use the project's CSS custom properties and Tailwind utilities. Vintage newspaper aesthetic.
- All article bodies MUST be collapsed by default. Some are very long.
- Use Framer Motion sparingly — tab transitions and expand/collapse only.
- Responsive: single column on mobile, centered max-w-4xl on desktop.
- Keep it simple. One page, tab navigation, no sub-routes.

After creating the files, run `npx next build`. If it fails, fix errors and rebuild until it passes.
