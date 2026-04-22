"use client";

import React from "react";
import sanitizeHtml from "sanitize-html";
import type { SearchResult } from "@/src/types";

// Whitelist only the <mark> tags that PostgreSQL ts_headline() emits.
// Everything else in the OCR'd body gets escaped, preventing raw HTML
// from reaching the browser via the search snippet.
const SNIPPET_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["mark"],
  allowedAttributes: {},
  disallowedTagsMode: "escape",
};

interface SearchResultCardProps {
  result: SearchResult;
}

export const SearchResultCard: React.FC<SearchResultCardProps> = ({ result }) => {
  return (
    <article className="py-4 border-b border-dashed border-[var(--stroke-accent-soft)]">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-xs uppercase tracking-label-md text-[var(--color-accent)]">
          {result.category}
        </span>
        <span className="text-xs opacity-50 text-[var(--color-text-primary)]">
          {result.editionDate}
        </span>
      </div>

      <a href={`/edition/${result.editionDate}`} className="block group">
        <h3 className="text-lg font-semibold transition-colors group-hover:underline text-[var(--color-text-primary)]">
          {result.headline || "Untitled"}
        </h3>
      </a>

      {result.byline && (
        <p className="text-sm italic opacity-70 mt-0.5 text-[var(--color-text-primary)]">
          {result.byline}
        </p>
      )}

      {result.snippet && (
        <p
          className="text-sm mt-2 leading-relaxed opacity-80 text-[var(--color-text-primary)]"
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml(result.snippet, SNIPPET_SANITIZE_OPTIONS),
          }}
        />
      )}
    </article>
  );
};
