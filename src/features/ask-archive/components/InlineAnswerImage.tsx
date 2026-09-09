"use client";

import React from "react";
import { useAnswerImages } from "./AnswerImageContext";

interface InlineAnswerImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt?: string;
}

/**
 * Wrapped `<img>` used as the `img` renderer for answer markdown.
 * When a matching `AnswerImageContext` is present we upgrade the image
 * to a clickable caption + attribution block; otherwise we degrade to
 * the same lazy <img> the old renderer produced.
 *
 * Everything here is phrasing content (spans) so it can nest inside
 * the <p> that react-markdown always wraps around inline content —
 * real <figure>/<figcaption> would trigger HTML validation + React
 * hydration errors when the LLM emits an image in the middle of a
 * sentence with a citation.
 */
export const InlineAnswerImage: React.FC<InlineAnswerImageProps> = ({ src, alt, ...rest }) => {
  const ctx = useAnswerImages();
  const meta = ctx?.metaByUrl.get(src);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">("loading");

  // Reset on src so a re-keyed render never shows the previous photo's
  // resolved state under a new URL — and then re-check, because an image
  // served from cache can be complete before React attaches onLoad, which
  // would otherwise leave the placeholder up for a photo already decoded.
  React.useEffect(() => {
    const el = imgRef.current;
    if (el?.complete) {
      setStatus(el.naturalWidth > 0 ? "loaded" : "error");
      return;
    }
    setStatus("loading");
  }, [src]);

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      ref={imgRef}
      src={src}
      alt={alt ?? meta?.caption ?? ""}
      loading="lazy"
      decoding="async"
      className="ask-answer-image"
      onLoad={() => setStatus("loaded")}
      onError={() => setStatus("error")}
    />
  );

  if (!ctx || !meta) return img;

  // A photo that will not load has nothing to caption and nothing to
  // expand — leaving the figure behind would put an italic caption and a
  // "from [3]" chip under an empty box, which is the one state that reads
  // as broken rather than as loading.
  if (status === "error") return null;

  const onAttrClick: React.MouseEventHandler<HTMLAnchorElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const n = meta.sourceIndex;
    const flash = () => {
      const target = document.getElementById(`ask-source-${n}`);
      if (!target) return false;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.setAttribute("data-highlighted", "true");
      window.setTimeout(() => target.removeAttribute("data-highlighted"), 1200);
      return true;
    };
    if (flash()) return;
    document
      .querySelectorAll<HTMLButtonElement>('.ask-source-toggle[aria-expanded="false"]')
      .forEach((btn) => btn.click());
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        flash();
      });
    });
  };

  // Until the photo is on screen the caption and the source chip describe
  // nothing. They used to render the instant the markdown arrived, so a
  // mid-stream answer showed an italic caption and "FROM [1]" floating
  // under blank space — the thing that reads as "the pictures aren't
  // loading". The box holds the space; the wording waits for the photo.
  const isLoading = status === "loading";

  return (
    <span
      className="ask-answer-figure"
      data-loading={isLoading ? "true" : undefined}
      role="figure"
      aria-label={meta.caption ?? "Photo from the archive"}
    >
      <button
        type="button"
        className="ask-answer-image-btn"
        aria-label={meta.caption ? `Expand photo: ${meta.caption}` : "Expand photo"}
        onClick={() => ctx.openLightbox(src)}
        disabled={isLoading}
      >
        {img}
      </button>
      {meta.caption && !isLoading ? (
        <span className="ask-answer-figcaption">{meta.caption}</span>
      ) : null}
      {isLoading ? null : (
        <a
          className="ask-citation-link ask-answer-image-attr"
          href={`#ask-source-${meta.sourceIndex}`}
          onClick={onAttrClick}
        >
          from [{meta.sourceIndex}]
        </a>
      )}
    </span>
  );
};
