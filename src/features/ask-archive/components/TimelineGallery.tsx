"use client";

import React from "react";
import Image from "next/image";
import type { AskResponse } from "@/src/types";

interface TimelineGalleryProps {
  response: AskResponse;
}

export const TimelineGallery: React.FC<TimelineGalleryProps> = ({ response }) => {
  const visualArticles = response.sourceArticles
    .filter((a) => a.imageUrls.length > 0)
    .sort((a, b) => a.editionDate.localeCompare(b.editionDate));

  if (visualArticles.length === 0) {
    return null;
  }

  return (
    <section className="ask-timeline-section">
      <div className="ask-timeline-label">
        {visualArticles.length} {visualArticles.length === 1 ? "Photo" : "Photos"} from the Archive
      </div>
      <div className="ask-timeline-grid">
        {visualArticles.map((article, index) => (
          <a
            key={article.id}
            href={`/edition/${article.editionDate}`}
            className="ask-timeline-card"
          >
            <div className="ask-timeline-image-wrapper">
              <Image
                src={article.imageUrls[0]}
                alt={article.headline || "Archive photo"}
                fill
                sizes="(max-width: 480px) 50vw, (max-width: 768px) 33vw, 256px"
                style={{ objectFit: "cover", objectPosition: "center" }}
                priority={index < 2}
              />
            </div>
            <div className="ask-timeline-caption">
              <span className="ask-timeline-date">{article.editionDate}</span>
              <span className="ask-timeline-headline">
                {article.headline || "Untitled"}
              </span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
};
