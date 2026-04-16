"use client";

import React from "react";
import type { FeedEntry } from "../hooks/useAskArchive";

interface ResearchFeedProps {
  entries: FeedEntry[];
  isActive: boolean;
}

export const ResearchFeed: React.FC<ResearchFeedProps> = ({ entries, isActive }) => {
  if (entries.length === 0 || !isActive) return null;

  return (
    <div className="ask-feed mt-8" role="status" aria-label="Research progress">
      {entries.map((entry, i) => (
        <p
          key={entry.id}
          className={`ask-feed-entry ask-feed-entry--${entry.type}${i === entries.length - 1 ? " ask-feed-entry--last" : ""}`}
        >
          {entry.text}
        </p>
      ))}
    </div>
  );
};
