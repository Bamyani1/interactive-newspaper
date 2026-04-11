"use client";

import React from "react";
import Image from "next/image";
import type { AskResponse } from "@/src/types";
import { ConfidenceBadge } from "./ConfidenceBadge";

interface TimelineGalleryProps {
  response: AskResponse;
}

export const TimelineGallery: React.FC<TimelineGalleryProps> = ({ response }) => {
  // Filter to articles with images, sorted chronologically
  const visualArticles = response.sourceArticles
    .filter((a) => a.imageUrls.length > 0)
    .sort((a, b) => a.editionDate.localeCompare(b.editionDate));

  return (
    <div className="mt-8">
      {/* Compact text summary */}
      <p className="ask-answer text-sm opacity-80 mb-6" style={{ color: "var(--color-text-primary)" }}>
        {response.answer.split("\n").slice(0, 3).join(" ").slice(0, 300)}
        {response.answer.length > 300 ? "..." : ""}
      </p>

      <div className="ask-meta mb-6">
        <ConfidenceBadge confidence={response.confidence} />
        <span>{response.meta.articlesSearched} articles searched</span>
        <span>{(response.meta.totalTimeMs / 1000).toFixed(1)}s</span>
      </div>

      {visualArticles.length === 0 ? (
        <p className="text-sm opacity-60" style={{ color: "var(--color-text-primary)" }}>
          No photos found for this query. Try a different search.
        </p>
      ) : (
        <div className="ask-timeline-grid">
          {visualArticles.map((article) => (
            <a
              key={article.id}
              href={`/edition/${article.editionDate}`}
              className="ask-timeline-card group"
            >
              <div className="ask-timeline-image-wrapper">
                <Image
                  src={article.imageUrls[0]}
                  alt={article.headline || "Archive photo"}
                  fill
                  sizes="(max-width: 640px) 100vw, 50vw"
                  className="object-cover"
                />
              </div>
              <div className="ask-timeline-caption">
                <span className="ask-timeline-date">{article.editionDate}</span>
                <span className="ask-timeline-headline group-hover:underline">
                  {article.headline || "Untitled"}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
};
