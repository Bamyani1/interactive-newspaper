"use client";
import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useModalDialog } from "./useModalDialog";

// Gallery-image tiles occupy a ~90% feed-area row of N columns.
const GALLERY_IMAGE_SIZES = "(max-width: 768px) 90vw, (max-width: 1280px) 40vw, 30vw";

/** Row of article images displayed as 4:3 tiles with optional captions. */
export function ImageGallery({
  images,
  alt,
  startIndex,
  onClick,
}: {
  images: { src: string; caption?: string | null }[];
  alt: string;
  /** One-based number of the first tile within the article/source gallery. */
  startIndex: number;
  onClick: (src: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="flex gap-4 mt-4" style={{ width: "90%", margin: "0 auto" }}>
      {images.map((img, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0 }}>
          <button
            type="button"
            className="relative block w-full border-3 border-[var(--color-text-primary)] overflow-hidden cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
            style={{ width: "100%", aspectRatio: "4/3" }}
            onClick={() => onClick(img.src)}
            aria-label={`Expand ${alt} — image ${startIndex + i}`}
          >
            <Image
              src={img.src}
              alt={`${alt} — image ${startIndex + i}`}
              fill
              sizes={GALLERY_IMAGE_SIZES}
              className="object-cover"
              style={{ objectPosition: "center 20%" }}
            />
          </button>
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
  const [mounted, setMounted] = React.useState(false);
  const isGallery = "images" in props;
  const images: LightboxImage[] = isGallery
    ? props.images
    : props.src
    ? [{ src: props.src }]
    : [];
  const open = images.length > 0;
  const initialIndex = isGallery ? props.initialIndex ?? 0 : 0;

  // Hold the latest onClose in a ref so the keyboard effect doesn't
  // tear down + re-register on every parent render. Passing `props`
  // in the dep array used to re-run the effect each render (new
  // object identity) and could fire a stale onClose between the
  // register/unregister pair.
  const onCloseRef = React.useRef(props.onClose);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  React.useLayoutEffect(() => {
    onCloseRef.current = props.onClose;
  });

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const { portalRef, dialogRef } = useModalDialog({
    isOpen: mounted && open,
    onDismiss: props.onClose,
    initialFocusRef: closeButtonRef,
  });

  const [index, setIndex] = React.useState(initialIndex);

  // Re-anchor the index whenever the gallery opens with a new
  // initialIndex or the underlying image set changes identity.
  const imagesKey = isGallery ? props.images : props.src;
  React.useEffect(() => {
    if (!open) return;
    setIndex(initialIndex);
  }, [open, imagesKey, initialIndex]);

  const total = images.length;
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (total > 1) {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setIndex((i) => (i + 1) % total);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          setIndex((i) => (i - 1 + total) % total);
        }
      }
    };
    // Capture phase so we fire before parent bubble-phase listeners.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, total]);

  const current = images[Math.min(index, images.length - 1)];

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && current && (
        <motion.div
          ref={portalRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => onCloseRef.current()}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center cursor-default"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={titleId} className="sr-only">
              Photo viewer
            </h2>
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="Close photo viewer"
              onClick={() => onCloseRef.current()}
              className="absolute right-2 top-2 z-10 min-h-[44px] min-w-[44px] rounded-full border border-white/25 bg-black/65 px-3 text-xl leading-none text-white focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
            >
              <span aria-hidden="true">×</span>
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={current.src}
              src={current.src}
              alt={current.caption ?? "Full-size view"}
              className="max-w-[90vw] max-h-[80vh] object-contain border-4 border-[var(--color-border-default)] shadow-2xl"
            />

            {current.caption ? (
              <p
                className="mx-auto mt-2 max-w-[80ch] rounded-sm bg-inverse px-3 py-2 text-center font-body text-sm italic text-text-inverse"
              >
                {current.caption}
              </p>
            ) : null}

            {total > 1 ? (
              <>
                {/* Chevrons sit inside the image frame so they stay on
                    screen for narrow viewports (left-[-3rem] used to
                    push the left chevron off-screen below ~420px). */}
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={() =>
                    setIndex((i) => (i - 1 + total) % total)
                  }
                  className="absolute left-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-white text-3xl font-serif leading-none cursor-pointer select-none rounded-full bg-black/55 border border-white/25 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={() => setIndex((i) => (i + 1) % total)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-white text-3xl font-serif leading-none cursor-pointer select-none rounded-full bg-black/55 border border-white/25 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
                >
                  ›
                </button>
                <span
                  className="absolute top-2 left-2 text-white font-mono text-xs tracking-label-md px-2 py-1 rounded-sm bg-black/55 border border-white/25"
                  aria-live="polite"
                >
                  {index + 1} / {total}
                </span>
              </>
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
