"use client";

import React from "react";
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
 */
export const PhotosPanel: React.FC<PhotosPanelProps> = ({
    images,
    onOpenUrl,
}) => {
    if (images.length === 0) return null;
    const visible = images.slice(0, TILE_CAP);
    const overflow = images.length - visible.length;

    return (
        <section
            className="ask-photos-panel"
            aria-label="More photos from this research"
        >
            <div className="ask-photos-panel-head">
                <h3 className="ask-photos-panel-label">
                    More pictures — {images.length}
                </h3>
                {overflow > 0 ? (
                    <span className="ask-photos-panel-overflow">
                        showing first {TILE_CAP}
                    </span>
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
                        {img.caption ? (
                            <p className="ask-photos-tile-caption">
                                {img.caption}
                            </p>
                        ) : null}
                        <span className="ask-photos-tile-attr">
                            [{img.sourceIndex}]
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
};
