export interface LayoutDesign {
  id: string;
  name: string;
  description: string;
}

export const LAYOUT_DESIGNS: LayoutDesign[] = [
  { id: "default",        name: "Broadsheet Classic",  description: "Hero image left + content right, hanging featured cards with pins" },
  { id: "tabloid-stack",  name: "Tabloid Stack",       description: "Full-width hero above text, horizontal text-only featured rows" },
  { id: "front-page",     name: "Front Page",          description: "3-column newspaper grid with column rules" },
  { id: "magazine-spread", name: "Magazine Spread",     description: "Full-width hero background with overlaid text, captioned thumbnails" },
  { id: "telegraph",      name: "Telegraph Wire",      description: "Monospace teleprinter aesthetic, no images, wire dispatch style" },
  { id: "mosaic",         name: "Photo Mosaic",        description: "2×2 grid of equal image tiles with headline overlays on hover" },
  { id: "broadside",      name: "Broadside Poster",    description: "Enormous centered headline, narrow column, minimal title rows" },
  { id: "ledger-list",    name: "Ledger List",         description: "Flat ruled list like a financial register — no images" },
  { id: "scrapbook",      name: "Scrapbook",           description: "Overlapping rotated cards, tape/pin decorations, collage feel" },
  { id: "column-split",   name: "Column Split",        description: "Hero takes left 60%, featured stack vertically on right 40%" },
  { id: "print-edition",  name: "Print Edition",       description: "Warm newspaper print layout with multi-column justified text and vintage amber styling" },
];
