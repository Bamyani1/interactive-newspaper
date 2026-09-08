"use client";

import React, { useState } from "react";
import Image from "next/image";
import type { TurnImage } from "../lib/dedup-source-images";

interface PhotosPanelProps {
  images: TurnImage[];
  onOpenUrl: (src: string) => void;
}

const TILE_CAP = 12;
const TILE_SIZES = "(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px";

/**
 * Visual-mode footer: a grid of dedupped photos drawn from the turn's
 * source articles, shown *after* the answer as supplementary content
 * — labelled "More pictures" because any photos the LLM already
 * embedded inline have been filtered out by the caller. Clicking a
 * tile asks the parent turn to open its Lightbox at that src; the
 * parent resolves the src to the canonical turn-wide index.
 *
 * The grid caps at TILE_CAP until expanded. The heading counts what is on
 * screen rather than the total while collapsed: it used to claim "More
 * pictures — 34" above twelve tiles, and "Show all" was one-way, so a
 * reader who expanded a long set had no way back to the short grid.
 */
export const PhotosPanel: React.FC<PhotosPanelProps> = ({ images, onOpenUrl }) => {
  const [showAll, setShowAll] = useState(false);
  if (images.length === 0) return null;

  const hasOverflow = images.length > TILE_CAP;
  const visible = showAll || !hasOverflow ? images : images.slice(0, TILE_CAP);

  return (
    <section className="ask-photos-panel" aria-label="More photos from this research">
      <div className="ask-photos-panel-head">
        <h3 className="ask-photos-panel-label">
          More pictures —{" "}
          {visible.length === images.length
            ? images.length
            : `${visible.length} of ${images.length}`}
        </h3>
        {hasOverflow ? (
          <button
            type="button"
            className="ask-photos-panel-overflow"
            onClick={() => setShowAll((prev) => !prev)}
            aria-expanded={showAll}
          >
            {showAll ? "Show fewer" : `Show all ${images.length} pictures`}
          </button>
        ) : null}
      </div>
      <ul className="ask-photos-grid" role="list">
        {visible.map((img) => (
          <li key={img.src} className="ask-photos-tile">
            <button
              type="button"
              className="ask-photos-tile-btn"
              onClick={() => onOpenUrl(img.src)}
              aria-label={
                img.caption
                  ? `Open photo: ${img.caption}`
                  : `Open photo from source ${img.sourceIndex}`
              }
            >
              <span className="ask-photos-tile-frame">
                <Image
                  src={img.src}
                  alt={img.caption ?? ""}
                  fill
                  sizes={TILE_SIZES}
                  className="object-cover"
                  style={{ objectPosition: "center 20%" }}
                />
              </span>
            </button>
            {img.caption ? <p className="ask-photos-tile-caption">{img.caption}</p> : null}
            <span className="ask-photos-tile-attr">[{img.sourceIndex}]</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
