"use client";

import React from "react";
import Link from "next/link";
import sanitizeHtml from "sanitize-html";
import type { SearchResult } from "@/src/types";
import { markExplicitEditionNavigation } from "@/shared/navigation/editionNavigation";

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
        <span className="text-xs uppercase tracking-label-md text-[var(--color-accent-text)]">
          {result.category}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)]">
          {result.editionDate}
        </span>
      </div>

      <Link
        href={`/edition/${result.editionDate}`}
        className="group flex min-h-[44px] items-center"
        onClick={(event) => {
          if (
            event.button === 0 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey
          ) {
            markExplicitEditionNavigation(result.editionDate);
          }
        }}
      >
        <h3 className="text-lg font-semibold transition-colors group-hover:underline text-[var(--color-text-primary)]">
          {result.headline || "Untitled"}
        </h3>
      </Link>

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
