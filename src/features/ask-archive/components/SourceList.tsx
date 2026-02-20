"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AskResponse } from "@/src/types";
import { SourceCard } from "./SourceCard";

interface SourceListProps {
  sources: AskResponse["sourceArticles"];
}

export const SourceList: React.FC<SourceListProps> = ({ sources }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (sources.length === 0) return null;

  return (
    <section className="mt-8">
      <button
        className="ask-source-toggle"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
      >
        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Sources ({sources.length} {sources.length === 1 ? "article" : "articles"})
      </button>

      {isExpanded && (
        <div className="mt-3">
          {sources.map((source, i) => (
            <SourceCard key={source.id} source={source} index={i} />
          ))}
        </div>
      )}
    </section>
  );
};
