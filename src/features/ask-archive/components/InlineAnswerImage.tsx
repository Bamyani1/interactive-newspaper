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
        const flash = () => {
            const target = document.getElementById(`ask-source-${n}`);
            if (!target) return false;
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            target.setAttribute("data-highlighted", "true");
            window.setTimeout(
                () => target.removeAttribute("data-highlighted"),
                1200,
            );
            return true;
        };
        if (flash()) return;
        document
            .querySelectorAll<HTMLButtonElement>(
                '.ask-source-toggle[aria-expanded="false"]',
            )
            .forEach((btn) => btn.click());
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                flash();
            });
        });
    };

    return (
        <span
            className="ask-answer-figure"
            role="figure"
            aria-label={meta.caption ?? "Photo from the archive"}
        >
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
                <span className="ask-answer-figcaption">{meta.caption}</span>
            ) : null}
            <a
                className="ask-citation-link ask-answer-image-attr"
                href={`#ask-source-${meta.sourceIndex}`}
                onClick={onAttrClick}
            >
                from [{meta.sourceIndex}]
            </a>
        </span>
    );
};
