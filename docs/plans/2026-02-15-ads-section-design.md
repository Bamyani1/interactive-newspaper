# Ads Section Design

## Problem

The Ads section doesn't render correctly. Ads are converted to Article objects (losing ad-specific context), then reconverted back to VintageAd objects with most fields undefined. The 3 existing templates have hardcoded movie-theater text applied to all ad types.

## Goals

1. Fix the ads pipeline so ads render reliably
2. Create 10 authentic 1980s newspaper ad template designs
3. Assign ads to templates using body-length tiers + index cycling
4. Verify every ad renders correctly across all designs

## Design Decisions

- **Data strategy**: Template-side only. Keep JSON simple (business_name + body). No LLM enrichment or field parsing.
- **Assignment logic**: Body length tiers + index cycling within tiers. Deterministic and predictable.
- **Visual style**: Authentic 1980s small-town newspaper ads (dot-matrix borders, dense type, coupon dashes, starburst badges).
- **Pipeline fix**: Pass ads separately through the route response instead of converting to/from Article objects.

## Section 1: Pipeline Fix

### VintageAd Type (simplified)

```typescript
export interface VintageAd {
  title: string;  // from business_name
  body: string;   // raw body text (NOT HTML)
}
```

### Changes

**`src/app/api/editions/[date]/route.ts`**: Return ads as separate field:
```typescript
return NextResponse.json({
  edition: { ... },
  articles,  // real articles only, no ads
  ads: edition.ads.map(ad => ({
    title: ad.business_name,
    body: ad.body,
  })),
});
```

**`src/lib/ocr-adapter.ts`**: Remove ad-to-Article conversion (lines 182-199). Remove "Ads" articles from `transformArticles()`.

**`src/features/news-feed/hooks/useEditionArticles.ts`**: Add `ads: VintageAd[]` to hook response. Pick up `ads` from API response.

**`src/features/news-feed/components/NewsFeed.tsx`**: Remove the `useMemo` that filters articles by category "Ads" (lines 94-107). Receive ads directly from the hook.

**`src/types/index.ts`**: Remove `subtitle`, `price`, `footer`, `tag`, `imageUrl` from VintageAd type.

## Section 2: 10 Ad Templates

### Assignment Logic

Sort ads into 3 tiers by body text length, then cycle templates within each tier:

| Tier | Body length | Templates |
|------|-------------|-----------|
| Short | < 80 chars | tiny-liner, boxed-notice, mini-display |
| Medium | 80-350 chars | retail-coupon, service-card, bulletin, marquee |
| Long | > 350 chars | broadsheet, editorial-style, showcase |

Assignment function: `assignTemplate(ad, indexWithinTier) => templateName`

### Template Descriptions

1. **tiny-liner** (Short) - Single-line classified. Business name bold + body in compact monospace. Thin rules top/bottom.
2. **boxed-notice** (Short) - Small boxed notice with thick border. Name centered, body below. No decoration.
3. **mini-display** (Short) - Dotted border, name in all-caps with letter-spacing, body centered.
4. **retail-coupon** (Medium) - Dashed scissor-cut border, "COUPON" badge, dashed tear-line at bottom.
5. **service-card** (Medium) - Clean card with double-line top border, name in serif, body left-aligned.
6. **bulletin** (Medium) - Pinboard style, slightly rotated, push-pin decoration. Informal feel.
7. **marquee** (Medium) - Star decorations, name in large caps, decorative dot/star border.
8. **broadsheet** (Long) - Full 2-column span, heavy top border, drop-cap first letter, newspaper column feel.
9. **editorial-style** (Long) - "ADVERTISEMENT" label at top, flows like editorial copy. 2-column span.
10. **showcase** (Long) - Bold centered layout with ornamental ASCII-style corners, stacked typography. 2-column span.

### Styling Constraints

All templates use existing CSS custom properties:
- Colors: `--color-text-primary`, `--color-bg-secondary`, `--color-accent`, `--color-border-default`, `--color-text-secondary`, `--color-text-inverse`
- Fonts: `font-header`, `font-typewriter`, `font-serif`

## Section 3: AdsBoard Layout

### Grid

- 1 column on mobile, 2 columns on `sm:` and up
- Short/Medium tier ads: 1 column each
- Long tier ads: `col-span-2` (full width)

### Component Structure

```
AdsBoard (grid container + header)
  ads.map(ad => {
    variant = assignTemplate(ad, indexWithinTier)
    <VintageAd ad={ad} variant={variant} />
  })
```

VintageAd uses switch/lookup on variant string to render the correct template.

### What Gets Removed

- Hardcoded "Held Over!" and "most exciting film of the year!" text
- `subtitle`, `price`, `footer`, `tag` rendering in templates
- Mock data fallback for ads (empty array in mockData.ts)
- Ad-to-Article and Article-to-Ad conversions

### Verification

- All 18 ads in current edition render without errors
- No overflow, missing text, or broken borders
- Assignment function is pure/deterministic: same ad always gets same template
- Extreme body lengths handled gracefully (line-clamp for very long text)
- Works in both light and dark themes via CSS custom properties

## Files Modified

| File | Change |
|------|--------|
| `src/types/index.ts` | Simplify VintageAd interface |
| `src/lib/ocr-adapter.ts` | Remove ad-to-Article conversion |
| `src/app/api/editions/[date]/route.ts` | Return ads separately |
| `src/features/news-feed/hooks/useEditionArticles.ts` | Expose ads from hook |
| `src/features/news-feed/components/NewsFeed.tsx` | Use ads from hook directly |
| `src/features/news-feed/components/VintageAd.tsx` | Replace 3 variants with 10 templates |
| `src/features/news-feed/components/AdsBoard.tsx` | Update assignment logic + grid layout |
