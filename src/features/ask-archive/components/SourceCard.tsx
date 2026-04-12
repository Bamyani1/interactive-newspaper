import React from "react";
import Image from "next/image";
import type { AskResponse } from "@/src/types";

type SourceArticle = AskResponse["sourceArticles"][number];

interface SourceCardProps {
  source: SourceArticle;
  index: number;
}

export const SourceCard: React.FC<SourceCardProps> = ({ source, index }) => {
  const hasImage = source.imageUrls.length > 0;

  return (
    <article className="ask-source-card" id={`ask-source-${index + 1}`}>
      <div className="ask-source-card-inner">
        <div className="ask-source-card-text">
          <div className="flex items-baseline gap-3 mb-1">
            <span
              className="text-xs uppercase tracking-widest"
              style={{ color: "var(--color-accent)" }}
            >
              {source.category}
            </span>
            <span
              className="text-xs opacity-50"
              style={{ color: "var(--color-text-primary)" }}
            >
              {source.editionDate}
            </span>
          </div>

          <a href={`/edition/${source.editionDate}`} className="block group">
            <h4
              className="text-base font-semibold transition-colors group-hover:underline"
              style={{ color: "var(--color-text-primary)" }}
            >
              [{index + 1}] {source.headline || "Untitled"}
            </h4>
          </a>

          {source.byline && (
            <p
              className="text-sm italic opacity-70 mt-0.5"
              style={{ color: "var(--color-text-primary)" }}
            >
              {source.byline}
            </p>
          )}

          {source.bodySnippet && (
            <p
              className="text-sm mt-2 leading-relaxed opacity-80"
              style={{ color: "var(--color-text-primary)" }}
            >
              {source.bodySnippet}
            </p>
          )}
        </div>

        {hasImage && (
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
            </div>
          </div>
        )}
      </div>
    </article>
  );
};
