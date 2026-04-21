"use client";
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";

// Gallery-image tiles occupy a ~90% feed-area row of N columns.
const GALLERY_IMAGE_SIZES = "(max-width: 768px) 90vw, (max-width: 1280px) 40vw, 30vw";

/** Row of article images displayed as 4:3 tiles with optional captions. */
export function ImageGallery({
  images,
  alt,
  onClick,
}: {
  images: { src: string; caption?: string | null }[];
  alt: string;
  onClick: (src: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="flex gap-4 mt-4" style={{ width: "90%", margin: "0 auto" }}>
      {images.map((img, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0 }}>
          <div
            className="relative border-3 border-[var(--color-text-primary)] overflow-hidden cursor-pointer"
            style={{ width: "100%", aspectRatio: "4/3" }}
            onClick={() => onClick(img.src)}
          >
            <Image
              src={img.src}
              alt={`${alt} — image ${i + 2}`}
              fill
              sizes={GALLERY_IMAGE_SIZES}
              className="object-cover"
              style={{ objectPosition: "center 20%" }}
            />
          </div>
          {img.caption && (
            <p
              className="mt-1"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                fontStyle: "italic",
                color: "var(--color-text-secondary)",
              }}
            >
              {img.caption}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export type LightboxImage = { src: string; caption?: string | null };

type LightboxProps =
  | { src: string | null; onClose: () => void }
  | { images: LightboxImage[]; initialIndex?: number; onClose: () => void };

/**
 * Full-screen overlay for image viewing. Supports two call shapes:
 *   - `{ src, onClose }` — single image (legacy).
 *   - `{ images, initialIndex, onClose }` — gallery with prev/next + keyboard nav.
 */
export function Lightbox(props: LightboxProps) {
  const isGallery = "images" in props;
  const images: LightboxImage[] = isGallery
    ? props.images
    : props.src
    ? [{ src: props.src }]
    : [];
  const open = images.length > 0;

  const [index, setIndex] = React.useState(
    isGallery ? props.initialIndex ?? 0 : 0,
  );

  // Re-anchor the index whenever the gallery opens with a new initialIndex
  // or the images array changes identity (new lightbox session).
  React.useEffect(() => {
    if (!open) return;
    setIndex(isGallery ? props.initialIndex ?? 0 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isGallery ? props.images : props.src]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
      } else if (isGallery && images.length > 1) {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setIndex((i) => (i + 1) % images.length);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setIndex((i) => (i - 1 + images.length) % images.length);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, isGallery, images.length, props]);

  const current = images[Math.min(index, images.length - 1)];
  const total = images.length;

  return (
    <AnimatePresence>
      {open && current && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={props.onClose}
        >
          <motion.div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={current.src}
              src={current.src}
              alt={current.caption ?? "Full-size view"}
              className="max-w-[90vw] max-h-[80vh] object-contain border-4 border-[var(--color-border-default)] shadow-2xl"
            />

            {current.caption ? (
              <p
                className="mt-2 text-center"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  fontStyle: "italic",
                  color: "rgba(255,255,255,0.88)",
                  maxWidth: "80ch",
                }}
              >
                {current.caption}
              </p>
            ) : null}

            {total > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={() =>
                    setIndex((i) => (i - 1 + total) % total)
                  }
                  className="absolute left-[-3rem] top-1/2 -translate-y-1/2 text-white text-3xl font-serif opacity-80 hover:opacity-100 cursor-pointer select-none"
                  style={{ background: "none", border: "none" }}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={() => setIndex((i) => (i + 1) % total)}
                  className="absolute right-[-3rem] top-1/2 -translate-y-1/2 text-white text-3xl font-serif opacity-80 hover:opacity-100 cursor-pointer select-none"
                  style={{ background: "none", border: "none" }}
                >
                  ›
                </button>
                <span
                  className="absolute top-[-2rem] right-0 text-white"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    letterSpacing: "0.12em",
                    opacity: 0.75,
                  }}
                >
                  {index + 1} / {total}
                </span>
              </>
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
