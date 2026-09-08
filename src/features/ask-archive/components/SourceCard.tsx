import React from "react";
import Image from "next/image";
import type { AskResponse } from "@/src/types";

type SourceArticle = AskResponse["sourceArticles"][number];

interface SourceCardProps {
  source: SourceArticle;
  index: number;
  /**
   * The turn this card belongs to. Required, and part of the element id:
   * `ask-source-3` alone repeated across every turn in the transcript, so
   * a citation in the fourth answer scrolled to the first answer's third
   * source. `getElementById` returns the first match in the document.
   */
  turnId: string;
  onOpen?: () => void;
}

export const SourceCard: React.FC<SourceCardProps> = ({ source, index, turnId, onOpen }) => {
  const hasImage = source.imageUrls.length > 0;

  return (
    // Not itself a button. `role="button"` on an article flattens
    // everything inside it into one accessible name — the index, the
    // headline, the byline, the snippet and the photo count read as a
    // single unbroken label, and the heading stops being a heading. The
    // "Read" affordance below is a real button instead.
    <article className="ask-source-card" id={`ask-source-${turnId}-${index + 1}`}>
      <div className="ask-source-card-inner">
        <div className="ask-source-card-text">
          <div className="ask-source-card-meta">
            <span className="ask-source-card-category">{source.category}</span>
            <span className="ask-source-card-date">{source.editionDate}</span>
          </div>

          <h4 className="ask-source-card-headline">
            <span className="ask-source-card-num">[{index + 1}]</span>{" "}
            {source.headline || "Untitled"}
          </h4>

          {source.byline ? <p className="ask-source-card-byline">{source.byline}</p> : null}

          {source.bodySnippet ? (
            <p className="ask-source-card-snippet">{source.bodySnippet}</p>
          ) : null}

          {onOpen ? (
            <button
              type="button"
              className="ask-source-card-hint"
              onClick={onOpen}
              aria-label={`Read: ${source.headline || "Untitled"}`}
            >
              Read →
            </button>
          ) : null}
        </div>

        {hasImage ? (
          <div className="ask-source-card-thumb">
            <div className="ask-source-thumb-wrapper">
              <Image
                src={source.imageUrls[0]}
                alt={source.headline || "Source image"}
                fill
                sizes="80px"
                className="object-cover"
                style={{ objectPosition: "center 20%" }}
              />
              {source.imageUrls.length > 1 ? (
                <span
                  className="ask-source-thumb-count"
                  aria-label={`${source.imageUrls.length} photos in this article`}
                >
                  +{source.imageUrls.length - 1}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
};
