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
 * to a clickable <figure> with caption + source attribution; otherwise
 * we degrade to the same lazy <img> the old renderer produced.
 */
export const InlineAnswerImage: React.FC<InlineAnswerImageProps> = ({
  src,
  alt,
  ...rest
}) => {
  const ctx = useAnswerImages();
  const meta = ctx?.metaByUrl.get(src);

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      src={src}
      alt={alt ?? meta?.caption ?? ""}
      loading="lazy"
      decoding="async"
      className="ask-answer-image"
    />
  );

  if (!ctx || !meta) return img;

  const onAttrClick: React.MouseEventHandler<HTMLAnchorElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const n = meta.sourceIndex;
    const target = document.getElementById(`ask-source-${n}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.setAttribute("data-highlighted", "true");
      window.setTimeout(
        () => target.removeAttribute("data-highlighted"),
        1200,
      );
      return;
    }
    // Sources are collapsed — expand them, then retry after React flushes.
    document
      .querySelectorAll<HTMLButtonElement>(
        '.ask-source-toggle[aria-expanded="false"]',
      )
      .forEach((btn) => btn.click());
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const retry = document.getElementById(`ask-source-${n}`);
        if (!retry) return;
        retry.scrollIntoView({ behavior: "smooth", block: "center" });
        retry.setAttribute("data-highlighted", "true");
        window.setTimeout(
          () => retry.removeAttribute("data-highlighted"),
          1200,
        );
      });
    });
  };

  return (
    <figure className="ask-answer-figure">
      <button
        type="button"
        className="ask-answer-image-btn"
        aria-label={
          meta.caption
            ? `Expand photo: ${meta.caption}`
            : "Expand photo"
        }
        onClick={() => ctx.openLightbox(src)}
      >
        {img}
      </button>
      {meta.caption ? (
        <figcaption className="ask-answer-figcaption">
          {meta.caption}
        </figcaption>
      ) : null}
      <a
        className="ask-citation-link ask-answer-image-attr"
        href={`#ask-source-${meta.sourceIndex}`}
        onClick={onAttrClick}
      >
        from [{meta.sourceIndex}]
      </a>
    </figure>
  );
};
