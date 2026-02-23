"use client";

import React from "react";
import type { SearchResult } from "@/src/types";

interface SearchResultCardProps {
  result: SearchResult;
}

export const SearchResultCard: React.FC<SearchResultCardProps> = ({ result }) => {
  return (
    <article
      className="py-4"
      style={{ borderBottom: "1px dashed var(--stroke-accent-soft)" }}
    >
      <div className="flex items-baseline gap-3 mb-1">
        <span
          className="text-xs uppercase tracking-widest"
          style={{ color: "var(--color-accent)" }}
        >
          {result.category}
        </span>
        <span className="text-xs opacity-50" style={{ color: "var(--color-text-primary)" }}>
          {result.editionDate}
        </span>
      </div>

      <a
        href={`/edition/${result.editionDate}`}
        className="block group"
      >
        <h3
          className="text-lg font-semibold transition-colors group-hover:underline"
          style={{ color: "var(--color-text-primary)" }}
        >
          {result.headline || "Untitled"}
        </h3>
      </a>

      {result.byline && (
        <p className="text-sm italic opacity-70 mt-0.5" style={{ color: "var(--color-text-primary)" }}>
          {result.byline}
        </p>
      )}

      {result.snippet && (
        <p
          className="text-sm mt-2 leading-relaxed opacity-80"
          style={{ color: "var(--color-text-primary)" }}
          dangerouslySetInnerHTML={{ __html: result.snippet }}
        />
      )}
    </article>
  );
};
