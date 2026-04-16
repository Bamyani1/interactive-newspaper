"use client";

import React from "react";
import type { AskResponse } from "@/src/types";

interface ResearchSummaryProps {
  response: AskResponse;
}

const CONFIDENCE_LABELS: Record<string, (count: number) => string> = {
  high: (n) => `High confidence \u2014 ${n} source${n === 1 ? "" : "s"} corroborate`,
  medium: (n) => `Medium confidence \u2014 ${n} source${n === 1 ? "" : "s"} found`,
  low: () => "Limited sources \u2014 answer may be incomplete",
};

export const ResearchSummary: React.FC<ResearchSummaryProps> = ({ response }) => {
  const citationCount = response.citations.length;
  const confidenceLabel =
    CONFIDENCE_LABELS[response.confidence]?.(citationCount) ?? "Limited sources";
  const timeStr = (response.meta.totalTimeMs / 1000).toFixed(1);
  const isComplex = response.meta.complexity === "complex";

  return (
    <div className="ask-summary mt-4">
      <span className="ask-summary-segment">
        <span className={`ask-confidence-dot ask-confidence-dot--${response.confidence}`} />
        {confidenceLabel}
      </span>
      <span className="ask-summary-separator" aria-hidden="true">&middot;</span>
      <span className="ask-summary-segment">
        {response.meta.articlesSearched.toLocaleString()} articles searched in {timeStr}s
      </span>
      {isComplex && response.meta.agentSteps != null && (
        <>
          <span className="ask-summary-separator" aria-hidden="true">&middot;</span>
          <span className="ask-summary-segment">
            Multi-step research: {response.meta.agentSteps} round{response.meta.agentSteps === 1 ? "" : "s"}, {response.meta.agentToolCalls ?? 0} tool call{(response.meta.agentToolCalls ?? 0) === 1 ? "" : "s"}
          </span>
        </>
      )}
    </div>
  );
};
