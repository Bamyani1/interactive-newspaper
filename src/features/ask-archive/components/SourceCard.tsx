import React from "react";
import Image from "next/image";
import type { AskResponse } from "@/src/types";

type SourceArticle = AskResponse["sourceArticles"][number];

interface SourceCardProps {
  source: SourceArticle;
  index: number;
  onOpen?: () => void;
}

export const SourceCard: React.FC<SourceCardProps> = ({
  source,
  index,
  onOpen,
}) => {
  const hasImage = source.imageUrls.length > 0;

  return (
    <article
      className="ask-source-card"
      id={`ask-source-${index + 1}`}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (!onOpen) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="ask-source-card-inner">
        <div className="ask-source-card-text">
          <div className="ask-source-card-meta">
            <span className="ask-source-card-category">
              {source.category}
            </span>
            <span className="ask-source-card-date">
              {source.editionDate}
            </span>
          </div>

          <h4 className="ask-source-card-headline">
            <span className="ask-source-card-num">[{index + 1}]</span>{" "}
            {source.headline || "Untitled"}
          </h4>

          {source.byline ? (
            <p className="ask-source-card-byline">{source.byline}</p>
          ) : null}

          {source.bodySnippet ? (
            <p className="ask-source-card-snippet">{source.bodySnippet}</p>
          ) : null}

          {onOpen ? (
            <span className="ask-source-card-hint" aria-hidden="true">
              Read →
            </span>
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
