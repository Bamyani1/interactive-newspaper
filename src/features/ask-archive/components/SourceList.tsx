"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AskResponse } from "@/src/types";
import { SourceCard } from "./SourceCard";
import { SourceReader } from "./SourceReader";

type SourceArticle = AskResponse["sourceArticles"][number];

interface SourceListProps {
  sources: AskResponse["sourceArticles"];
  /** Scopes each card's element id to this turn — see SourceCard. */
  turnId: string;
  defaultExpanded?: boolean;
  interactive?: boolean;
}

export const SourceList: React.FC<SourceListProps> = ({
  sources,
  turnId,
  defaultExpanded = true,
  interactive = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [selected, setSelected] = useState<SourceArticle | null>(null);

  if (sources.length === 0) return null;

  const count = sources.length;
  const labelText = `Sources — ${count} ${count === 1 ? "article" : "articles"}`;

  return (
    <section className="ask-source-list">
      <h3 className="ask-source-list-heading">
        <button
          type="button"
          className="ask-source-toggle"
          onClick={interactive ? () => setIsExpanded((prev) => !prev) : undefined}
          aria-expanded={isExpanded}
          tabIndex={interactive ? undefined : -1}
          disabled={!interactive}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{labelText}</span>
        </button>
      </h3>

      {isExpanded && (
        <div className="ask-source-list-content">
          {sources.map((source, i) => (
            <SourceCard
              key={source.id}
              source={source}
              index={i}
              turnId={turnId}
              onOpen={interactive ? () => setSelected(source) : undefined}
            />
          ))}
        </div>
      )}

      {interactive ? <SourceReader source={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  );
};
