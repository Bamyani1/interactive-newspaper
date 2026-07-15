"use client";

import React, { useMemo, useState } from "react";
import { ImageGallery, Lightbox, type LightboxImage } from "@/src/components/ui/lightbox";

interface SourcePhotosStripProps {
    urls: string[];
    captions: (string | null)[];
    alt: string;
}

/**
 * Row of all photos from a source, displayed inside the reader drawer.
 * Reuses ImageGallery (4:3 tiles + captions) and Lightbox (full-screen
 * gallery with prev/next) so the aesthetic matches the print edition.
 */
export const SourcePhotosStrip: React.FC<SourcePhotosStripProps> = ({
    urls,
    captions,
    alt,
}) => {
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    const images = useMemo<LightboxImage[]>(
        () =>
            urls.map((src, i) => ({
                src,
                caption: captions[i] ?? null,
            })),
        [urls, captions],
    );

    if (images.length === 0) return null;

    return (
        <div className="ask-reader-photos">
            <ImageGallery
                images={images}
                alt={alt}
                startIndex={1}
                onClick={(src) => {
                    const i = images.findIndex((img) => img.src === src);
                    if (i >= 0) setOpenIndex(i);
                }}
            />
            <Lightbox
                images={openIndex !== null ? images : []}
                initialIndex={openIndex ?? 0}
                onClose={() => setOpenIndex(null)}
            />
        </div>
    );
};
