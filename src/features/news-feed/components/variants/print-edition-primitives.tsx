"use client";
import React from "react";
import Image from "next/image";

export { Lightbox, ImageGallery } from "@/src/components/ui/lightbox";

/*
 * PERIOD-MATCHING CARVE-OUT
 *
 * Inline font sizes (15/14/12/11/10 px, 3.5em, clamp(20/3vw/28px)) and the
 * `color: "#fff"` in HeaderBar below are INTENTIONAL. They reproduce the
 * typographic proportions of a printed 1960s broadsheet, not a digital
 * design system. Do not blanket-migrate these to tokens without reviewing
 * the printed output.
 *
 * See docs/design/carve-outs.md item 3.
 */

// ─── Helpers ───────────────────────────────────────────────────────

/** Extract clean text paragraphs from HTML-formatted fullText. */
export function extractParagraphs(html: string): string[] {
  return html
    .split(/<\/?p[^>]*>/i)
    .map((s) => s.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
}

/** Longer articles get 3 columns, shorter ones get 2. */
export const LONG_ARTICLE_THRESHOLD = 2000;

// ─── Sub-components ────────────────────────────────────────────────

/** Drop cap for the first paragraph of the hero article. */
export function DropCap({ text }: { text: string }) {
  if (!text) return null;
  const first = text.charAt(0);
  const rest = text.slice(1);
  return (
    <p
      className="mb-3 text-[var(--color-text-primary)]"
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "15px",
        lineHeight: 1.7,
        textAlign: "justify",
        hyphens: "auto",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          fontFamily: "var(--font-header)",
          float: "left",
          fontSize: "3.5em",
          fontWeight: 700,
          lineHeight: 0.8,
          marginRight: "0.08em",
          marginTop: "0.05em",
          color: "var(--color-accent)",
        }}
      >
        {first}
      </span>
      {rest}
    </p>
  );
}

/** Thick-thin double rule section divider. */
export function DoubleRule() {
  return (
    <div className="mb-6" aria-hidden="true">
      <div style={{ borderTop: "2px solid var(--color-accent)" }} />
      <div style={{ height: "3px" }} />
      <div style={{ borderTop: "1px solid var(--color-accent-hover)" }} />
    </div>
  );
}

/** Typographic ornament row replacing emoji decorations. */
export function OrnamentRow({ variant }: { variant: "top" | "bottom" }) {
  if (variant === "top") {
    return (
      <div
        className="flex justify-center items-center gap-6 mb-5 select-none text-[var(--color-text-secondary)]"
        aria-hidden="true"
        style={{
          fontFamily: "var(--font-header)",
          fontSize: "14px",
          letterSpacing: "0.3em",
        }}
      >
        <span>◆</span>
        <span>◆</span>
        <span>◆</span>
      </div>
    );
  }

  return (
    <div
      className="flex justify-center items-center gap-3 select-none text-[var(--color-text-secondary)]"
      aria-hidden="true"
      style={{ fontFamily: "var(--font-header)", fontSize: "14px" }}
    >
      <span
        className="flex-1"
        style={{ borderTop: "1px solid var(--color-accent-hover)" }}
      />
      <span style={{ letterSpacing: "0.2em" }}>— § —</span>
      <span
        className="flex-1"
        style={{ borderTop: "1px solid var(--color-accent-hover)" }}
      />
    </div>
  );
}

/** Kicker label (replaces colored badge chips). */
export function Kicker({ category }: { category: string }) {
  return (
    <span
      className="inline-block mb-4 px-2.5 py-1"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.15em",
        color: "#fff",
        backgroundColor: "var(--color-accent)",
      }}
    >
      {category}
    </span>
  );
}

/** Byline in mono uppercase, with optional writer position. */
export function Byline({
  byline,
  writerPosition,
  centered,
}: {
  byline?: string | null;
  writerPosition?: string | null;
  centered?: boolean;
}) {
  if (!byline) return null;

  return (
    <div
      className={centered ? "text-center" : ""}
      style={{ marginBottom: centered ? "1rem" : "0.75rem" }}
    >
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          fontWeight: 400,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--color-accent)",
        }}
      >
        By {byline}
      </p>
      {writerPosition && (
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            fontWeight: 400,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--color-text-secondary)",
            marginTop: "0.15rem",
          }}
        >
          {writerPosition}
        </p>
      )}
    </div>
  );
}

// Each ArticleImage sits in a CSS column inside the main feed area
// (feed area = viewport minus the two sidebars on desktop).
const ARTICLE_IMAGE_SIZES = "(max-width: 768px) 100vw, (max-width: 1280px) 30vw, 25vw";

/** Article image with consistent sizing — placed outside CSS columns. */
export function ArticleImage({
  src,
  alt,
  caption,
  onClick,
  priority,
  width = 240,
  maxWidth = "100%",
}: {
  src: string;
  alt: string;
  caption?: string | null;
  onClick: () => void;
  priority?: boolean;
  width?: number | "full";
  maxWidth?: string;
}) {
  return (
    <div style={{ width: width === "full" ? "100%" : `${width}px`, maxWidth, flexShrink: 0, margin: "0 auto" }}>
      <div
        className="relative border-3 border-[var(--color-text-primary)] overflow-hidden cursor-pointer"
        style={{ width: "100%", aspectRatio: "4/3" }}
        onClick={onClick}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes={ARTICLE_IMAGE_SIZES}
          className="object-cover"
          style={{ objectPosition: "center 20%" }}
          priority={priority}
        />
      </div>
      {caption && (
        <p
          className="mt-1"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            fontStyle: "italic",
            color: "var(--color-text-secondary)",
          }}
        >
          {caption}
        </p>
      )}
    </div>
  );
}

/**
 * Compute insertion positions for images interleaved between paragraphs.
 * Returns an array of length N where positions[i] is the paragraph index
 * BEFORE which image i should be inserted (range 0..P inclusive).
 * Returns [] when interleaving is not applicable — caller should stack
 * images at the top instead.
 *
 * Rules:
 *   - N < 2 or P < 1 → []  (single-image or no-body articles use top-stack)
 *   - First image is always anchored at position 0 (top of body)
 *   - Remaining images distribute via round(i * P / N), shifted forward on
 *     collision so two images never share an anchor (until clamped to P)
 */
export function computeImagePositions(N: number, P: number): number[] {
  if (N < 2 || P < 1) return [];
  const positions: number[] = [];
  let minNext = 0;
  for (let i = 0; i < N; i++) {
    let pos = i === 0 ? 0 : Math.round((i * P) / N);
    if (pos < minNext) pos = minNext;
    if (pos > P) pos = P;
    positions.push(pos);
    minNext = pos + 1;
  }
  return positions;
}

/** Multi-column text block for body paragraphs. */
export function ColumnText({
  paragraphs,
  columns,
  fontSize = "14px",
  dropCap,
  image,
  header,
}: {
  paragraphs: string[];
  columns: 2 | 3;
  fontSize?: string;
  dropCap?: boolean;
  image?: React.ReactNode | React.ReactNode[];
  /** Rendered inside the column flow (col 1) so col 2+ starts level with it. */
  header?: React.ReactNode;
}) {
  const images = image ? (Array.isArray(image) ? image : [image]) : [];
  if (paragraphs.length === 0 && images.length === 0 && !header) return null;

  const bodyText = paragraphs.map((p, i) =>
    dropCap && i === 0 ? (
      <DropCap key={i} text={p} />
    ) : (
      <p key={i} className="mb-3">
        {p}
      </p>
    )
  );

  const N = images.length;
  const P = bodyText.length;
  const positions = computeImagePositions(N, P);
  const canInterleave = positions.length > 0;

  const wrapImage = (img: React.ReactNode, i: number) => (
    <div key={`img-${i}`} style={{ breakInside: "avoid", marginBottom: "0.75rem" }}>
      {img}
    </div>
  );

  const flow: React.ReactNode[] = [];
  if (!canInterleave) {
    images.forEach((img, i) => flow.push(wrapImage(img, i)));
    bodyText.forEach((p) => flow.push(p));
  } else {
    let imgIdx = 0;
    for (let p = 0; p < P; p++) {
      while (imgIdx < N && positions[imgIdx] === p) {
        flow.push(wrapImage(images[imgIdx], imgIdx));
        imgIdx++;
      }
      flow.push(bodyText[p]);
    }
    while (imgIdx < N) {
      flow.push(wrapImage(images[imgIdx], imgIdx));
      imgIdx++;
    }
  }

  return (
    <div
      className="text-[var(--color-text-primary)]"
      style={{
        fontFamily: "var(--font-body)",
        fontSize,
        lineHeight: 1.7,
        columns: columns === 3 ? "3 200px" : "2 220px",
        columnGap: "1.5rem",
        columnRule: "1px solid var(--stroke-accent-soft)",
        textAlign: "justify",
        hyphens: "auto",
      }}
    >
      {header && (
        <div style={{ breakInside: "avoid", textAlign: "left", hyphens: "manual" }}>
          {header}
        </div>
      )}
      {flow}
    </div>
  );
}

// PhotoFeature image is a 40% column on the right of the feed area.
const PHOTO_FEATURE_SIZES = "(max-width: 768px) 40vw, (max-width: 1280px) 22vw, 18vw";

/** Side-by-side photo-feature layout for articles with image but no body text. */
export function PhotoFeature({
  headline,
  imageSrc,
  alt,
  caption,
  byline,
  onImageClick,
  priority,
}: {
  headline: string;
  imageSrc: string;
  alt: string;
  caption?: string | null;
  byline?: string | null;
  onImageClick: () => void;
  priority?: boolean;
}) {
  return (
    <div className="flex gap-6 items-start">
      {/* Left: Title + Caption */}
      <div className="flex-1">
        <h2
          className="text-[var(--color-text-primary)] mb-3"
          style={{
            fontFamily: "var(--font-header)",
            fontSize: "clamp(20px, 3vw, 28px)",
            fontWeight: 700,
            lineHeight: 1.2,
          }}
        >
          {headline}
        </h2>

        {byline && <Byline byline={byline} />}

        {caption && (
          <>
            <div
              aria-hidden="true"
              className="my-3"
              style={{
                width: "3em",
                borderTop: "1px solid var(--color-accent-hover)",
              }}
            />
            <p
              className="text-[var(--color-text-secondary)]"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "14px",
                fontStyle: "italic",
                lineHeight: 1.7,
                textAlign: "justify",
                hyphens: "auto",
              }}
            >
              {caption}
            </p>
          </>
        )}
      </div>

      {/* Right: Image */}
      <div
        className="relative flex-shrink-0 border-3 border-[var(--color-text-primary)] overflow-hidden cursor-pointer"
        style={{ width: "40%", aspectRatio: "4/3" }}
        onClick={onImageClick}
      >
        <Image
          src={imageSrc}
          alt={alt}
          fill
          sizes={PHOTO_FEATURE_SIZES}
          className="object-cover"
          style={{ objectPosition: "center 20%" }}
          priority={priority}
        />
      </div>
    </div>
  );
}

